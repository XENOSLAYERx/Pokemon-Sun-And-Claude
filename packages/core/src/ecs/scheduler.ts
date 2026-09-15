/**
 * System scheduler with explicit phases and per-system profiling.
 *
 * Ordering bugs in a simulation this size are brutal to debug, so ordering is
 * declared rather than implied by registration order: a system names its phase,
 * and may declare `after` dependencies that are topologically sorted within it.
 */
import type { World } from './world.ts';

/**
 * Phases run in this fixed order every tick. The split matters:
 * input -> AI decisions -> movement -> collision -> gameplay reactions ->
 * streaming -> presentation. Anything that reads transforms must run after
 * `Movement`; anything that writes them must run before `PostPhysics`.
 */
export const Phase = {
  /** Sample input devices and network commands. */
  Input: 0,
  /** Time of day, weather, tides — everything downstream reads these. */
  Environment: 1,
  /** Perception updates: who can see whom. */
  Perception: 2,
  /** AI decisions. Writes intents, never transforms. */
  Decision: 3,
  /** Steering and locomotion integration. Writes transforms. */
  Movement: 4,
  /** Ground clamping, collision resolution, water surface snapping. */
  PostPhysics: 5,
  /** Gameplay reactions: encounters, triggers, quests, battle ticks. */
  Gameplay: 6,
  /** Chunk load/unload, spawn/despawn, LOD budget. */
  Streaming: 7,
  /** Animation state, audio emitters, VFX — read-only over simulation state. */
  Presentation: 8,
  /** Cleanup, deferred destruction, metric collection. */
  Cleanup: 9,
} as const;

export type Phase = (typeof Phase)[keyof typeof Phase];

/** Reverse lookup for diagnostics — replaces the enum's implicit reverse map. */
export const PHASE_NAMES: Readonly<Record<Phase, string>> = Object.freeze({
  [Phase.Input]: 'Input',
  [Phase.Environment]: 'Environment',
  [Phase.Perception]: 'Perception',
  [Phase.Decision]: 'Decision',
  [Phase.Movement]: 'Movement',
  [Phase.PostPhysics]: 'PostPhysics',
  [Phase.Gameplay]: 'Gameplay',
  [Phase.Streaming]: 'Streaming',
  [Phase.Presentation]: 'Presentation',
  [Phase.Cleanup]: 'Cleanup',
});

export const PHASE_ORDER: readonly Phase[] = [
  Phase.Input,
  Phase.Environment,
  Phase.Perception,
  Phase.Decision,
  Phase.Movement,
  Phase.PostPhysics,
  Phase.Gameplay,
  Phase.Streaming,
  Phase.Presentation,
  Phase.Cleanup,
];

export interface SystemContext {
  world: World;
  /** Fixed simulation delta in seconds. */
  dt: number;
  /** Total elapsed simulation time in seconds. */
  elapsed: number;
  /** Monotonic tick counter. Deterministic across machines. */
  tick: number;
  /** Interpolation alpha for presentation systems: 0..1 between fixed steps. */
  alpha: number;
}

export interface SystemDefinition {
  readonly name: string;
  readonly phase: Phase;
  /** Names of systems that must run before this one, within the same phase. */
  readonly after?: readonly string[];
  /** Run only every N ticks. Used to spread expensive work (ecology, migration). */
  readonly interval?: number;
  /** Optional one-time setup. */
  init?(ctx: SystemContext): void;
  update(ctx: SystemContext): void;
}

export interface SystemTiming {
  name: string;
  /** Exponential moving average of milliseconds per run. */
  avgMs: number;
  lastMs: number;
  runs: number;
}

export class Scheduler {
  private byPhase = new Map<Phase, SystemDefinition[]>();
  private sorted = new Map<Phase, SystemDefinition[]>();
  private timings = new Map<string, SystemTiming>();
  private initialized = new Set<string>();
  private dirty = true;

  /** Set false on the server or in headless tests to skip profiling overhead. */
  profiling = true;

  add(system: SystemDefinition): this {
    const list = this.byPhase.get(system.phase) ?? [];
    if (list.some((s) => s.name === system.name)) {
      throw new Error(`System "${system.name}" is already registered.`);
    }
    list.push(system);
    this.byPhase.set(system.phase, list);
    this.dirty = true;
    return this;
  }

  addAll(systems: readonly SystemDefinition[]): this {
    for (const s of systems) this.add(s);
    return this;
  }

  remove(name: string): boolean {
    for (const [phase, list] of this.byPhase) {
      const i = list.findIndex((s) => s.name === name);
      if (i >= 0) {
        list.splice(i, 1);
        this.byPhase.set(phase, list);
        this.dirty = true;
        return true;
      }
    }
    return false;
  }

  /** Topologically sort each phase by its `after` dependencies. */
  private rebuild(): void {
    this.sorted.clear();
    for (const [phase, list] of this.byPhase) {
      const byName = new Map(list.map((s) => [s.name, s]));
      const visited = new Map<string, 'visiting' | 'done'>();
      const out: SystemDefinition[] = [];

      const visit = (sys: SystemDefinition, chain: string[]): void => {
        const state = visited.get(sys.name);
        if (state === 'done') return;
        if (state === 'visiting') {
          throw new Error(
            `Cyclic system dependency in phase ${PHASE_NAMES[phase]}: ${[...chain, sys.name].join(' -> ')}`,
          );
        }
        visited.set(sys.name, 'visiting');
        for (const dep of sys.after ?? []) {
          const depSys = byName.get(dep);
          // A dependency in an earlier phase is already satisfied by phase order.
          if (depSys) visit(depSys, [...chain, sys.name]);
        }
        visited.set(sys.name, 'done');
        out.push(sys);
      };

      for (const sys of list) visit(sys, []);
      this.sorted.set(phase, out);
    }
    this.dirty = false;
  }

  tick(ctx: SystemContext): void {
    if (this.dirty) this.rebuild();

    for (const phase of PHASE_ORDER) {
      const systems = this.sorted.get(phase);
      if (!systems) continue;

      for (const sys of systems) {
        if (sys.interval && sys.interval > 1 && ctx.tick % sys.interval !== 0) continue;

        if (!this.initialized.has(sys.name)) {
          sys.init?.(ctx);
          this.initialized.add(sys.name);
        }

        if (this.profiling) {
          const t0 = performance.now();
          sys.update(ctx);
          const ms = performance.now() - t0;
          let timing = this.timings.get(sys.name);
          if (!timing) {
            timing = { name: sys.name, avgMs: ms, lastMs: ms, runs: 0 };
            this.timings.set(sys.name, timing);
          }
          timing.lastMs = ms;
          // EMA with alpha 0.1 — smooth enough to read on an overlay.
          timing.avgMs += (ms - timing.avgMs) * 0.1;
          timing.runs++;
        } else {
          sys.update(ctx);
        }
      }

      // Structural changes are applied at phase boundaries, so systems within a
      // phase always observe a consistent world.
      ctx.world.flush();
    }
  }

  /** Slowest systems first — what the profiler overlay renders. */
  getTimings(): SystemTiming[] {
    return [...this.timings.values()].sort((a, b) => b.avgMs - a.avgMs);
  }

  systemNames(): string[] {
    if (this.dirty) this.rebuild();
    const names: string[] = [];
    for (const phase of PHASE_ORDER) {
      for (const s of this.sorted.get(phase) ?? []) names.push(s.name);
    }
    return names;
  }
}
