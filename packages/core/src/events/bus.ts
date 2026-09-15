/**
 * Typed event bus.
 *
 * Two delivery modes, both needed:
 *
 * - `emit`   — synchronous. For things that must be observed in the same tick
 *              (a move landing, a quest flag flipping).
 * - `queue`  — deferred to the next `drain()`. For things that must NOT run
 *              inside another system's iteration, like "Ultra Beast spawned",
 *              which rewrites the weather, the music and half the NPCs.
 *
 * Handlers are stored in arrays copied on dispatch, so a handler may safely
 * unsubscribe itself or others during dispatch.
 */

export type EventHandler<T> = (payload: T) => void;
export type Unsubscribe = () => void;

/** Declares an event name and its payload type. */
export interface EventType<T> {
  readonly name: string;
  /** Phantom field — carries the payload type, never populated at runtime. */
  readonly __payload?: T;
}

export function defineEvent<T>(name: string): EventType<T> {
  return { name };
}

interface Subscription {
  handler: EventHandler<unknown>;
  once: boolean;
  priority: number;
}

export class EventBus {
  private handlers = new Map<string, Subscription[]>();
  private pending: Array<{ name: string; payload: unknown }> = [];
  private draining = false;

  /** Set to log every dispatch. Wired to the `--trace-events` dev flag. */
  trace: ((name: string, payload: unknown) => void) | null = null;

  /**
   * Subscribe. Higher `priority` runs first; equal priorities preserve
   * registration order. Priority exists so that, for example, the save system
   * can observe `PokemonCaught` *after* the Pokédex has recorded it.
   */
  on<T>(type: EventType<T>, handler: EventHandler<T>, priority = 0): Unsubscribe {
    return this.subscribe(type.name, handler as EventHandler<unknown>, false, priority);
  }

  once<T>(type: EventType<T>, handler: EventHandler<T>, priority = 0): Unsubscribe {
    return this.subscribe(type.name, handler as EventHandler<unknown>, true, priority);
  }

  private subscribe(name: string, handler: EventHandler<unknown>, once: boolean, priority: number): Unsubscribe {
    const list = this.handlers.get(name) ?? [];
    const sub: Subscription = { handler, once, priority };
    // Insert maintaining descending priority, stable within equal priority.
    let i = list.length;
    while (i > 0 && list[i - 1].priority < priority) i--;
    list.splice(i, 0, sub);
    this.handlers.set(name, list);

    return () => {
      const current = this.handlers.get(name);
      if (!current) return;
      const idx = current.indexOf(sub);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  off<T>(type: EventType<T>, handler: EventHandler<T>): void {
    const list = this.handlers.get(type.name);
    if (!list) return;
    const idx = list.findIndex((s) => s.handler === handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  /** Dispatch immediately, in the current call stack. */
  emit<T>(type: EventType<T>, payload: T): void {
    this.trace?.(type.name, payload);
    const list = this.handlers.get(type.name);
    if (!list || list.length === 0) return;

    // Copy: handlers may mutate the subscription list.
    const snapshot = list.slice();
    for (const sub of snapshot) {
      if (sub.once) {
        const idx = list.indexOf(sub);
        if (idx >= 0) list.splice(idx, 1);
      }
      sub.handler(payload);
    }
  }

  /** Enqueue for the next drain(). */
  queue<T>(type: EventType<T>, payload: T): void {
    this.pending.push({ name: type.name, payload });
  }

  /**
   * Dispatch everything queued. Events queued *during* the drain are processed
   * in the same drain, up to `maxPasses` — enough for a cascade, bounded so a
   * feedback loop surfaces as a clear error instead of a hang.
   */
  drain(maxPasses = 8): void {
    if (this.draining) return;
    this.draining = true;
    try {
      let pass = 0;
      while (this.pending.length > 0) {
        if (++pass > maxPasses) {
          throw new Error(
            `EventBus.drain exceeded ${maxPasses} passes — likely an event feedback loop. ` +
              `Pending: ${[...new Set(this.pending.map((p) => p.name))].join(', ')}`,
          );
        }
        const batch = this.pending;
        this.pending = [];
        for (const { name, payload } of batch) {
          this.trace?.(name, payload);
          const list = this.handlers.get(name);
          if (!list || list.length === 0) continue;
          for (const sub of list.slice()) {
            if (sub.once) {
              const idx = list.indexOf(sub);
              if (idx >= 0) list.splice(idx, 1);
            }
            sub.handler(payload);
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }

  clear(): void {
    this.handlers.clear();
    this.pending.length = 0;
  }

  listenerCount(type: EventType<unknown>): number {
    return this.handlers.get(type.name)?.length ?? 0;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
