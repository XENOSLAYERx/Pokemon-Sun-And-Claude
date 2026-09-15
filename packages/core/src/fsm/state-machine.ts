/**
 * Hierarchical-ish finite state machine used for anything with clear discrete
 * modes: player locomotion (ground/swim/ride/fly), weather, battle flow,
 * Ultra Beast encounter phases.
 *
 * AI *behaviour* uses behaviour trees + utility scoring instead (see
 * @alola/ai) — FSMs get unmanageable past ~8 states. But for genuinely
 * discrete modes an FSM is clearer and cheaper, so both exist by design.
 */

export interface StateDefinition<C> {
  readonly name: string;
  onEnter?(ctx: C, from: string | null): void;
  onUpdate?(ctx: C, dt: number): void;
  onExit?(ctx: C, to: string): void;
  /** Guard: may this state be entered right now? */
  canEnter?(ctx: C): boolean;
}

export interface TransitionDefinition<C> {
  readonly from: string | '*';
  readonly to: string;
  /** Evaluated every update while in `from`. */
  condition(ctx: C): boolean;
  /** Lower numbers evaluated first. */
  readonly priority?: number;
}

export class StateMachine<C> {
  private states = new Map<string, StateDefinition<C>>();
  private transitions: TransitionDefinition<C>[] = [];
  private current: StateDefinition<C> | null = null;
  private previousName: string | null = null;

  /** Seconds spent in the current state. Frequently used by transition guards. */
  timeInState = 0;
  /** Fired on every transition — the hook animation and audio listen to. */
  onTransition: ((from: string | null, to: string) => void) | null = null;

  private readonly ctx: C;

  constructor(ctx: C) {
    this.ctx = ctx;
  }

  addState(state: StateDefinition<C>): this {
    this.states.set(state.name, state);
    return this;
  }

  addTransition(t: TransitionDefinition<C>): this {
    this.transitions.push(t);
    this.transitions.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    return this;
  }

  /** Force a state change, bypassing transition conditions but not `canEnter`. */
  setState(name: string): boolean {
    const next = this.states.get(name);
    if (!next) throw new Error(`Unknown state "${name}". Registered: ${[...this.states.keys()].join(', ')}`);
    if (this.current?.name === name) return false;
    if (next.canEnter && !next.canEnter(this.ctx)) return false;

    const fromName = this.current?.name ?? null;
    this.current?.onExit?.(this.ctx, name);
    this.previousName = fromName;
    this.current = next;
    this.timeInState = 0;
    next.onEnter?.(this.ctx, fromName);
    this.onTransition?.(fromName, name);
    return true;
  }

  update(dt: number): void {
    this.timeInState += dt;

    // Evaluate transitions before the state update so a state never runs a
    // frame after its exit condition became true.
    for (const t of this.transitions) {
      if (t.from !== '*' && t.from !== this.current?.name) continue;
      if (t.to === this.current?.name) continue;
      if (t.condition(this.ctx)) {
        if (this.setState(t.to)) break;
      }
    }

    this.current?.onUpdate?.(this.ctx, dt);
  }

  get stateName(): string | null {
    return this.current?.name ?? null;
  }

  get previous(): string | null {
    return this.previousName;
  }

  is(name: string): boolean {
    return this.current?.name === name;
  }
}
