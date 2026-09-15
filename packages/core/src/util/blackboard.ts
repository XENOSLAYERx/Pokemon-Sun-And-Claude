/**
 * A typed key/value store shared between AI subsystems.
 *
 * The blackboard is how perception, memory, needs and the behaviour tree talk
 * without knowing about each other: perception writes `nearestThreat`, the
 * tree reads it. Keys are typed handles so a typo is a compile error rather
 * than a silent `undefined` that makes a Bewear stand still forever.
 */

export interface BlackboardKey<T> {
  readonly name: string;
  readonly defaultValue: T;
}

export function defineKey<T>(name: string, defaultValue: T): BlackboardKey<T> {
  return { name, defaultValue };
}

export class Blackboard {
  private data = new Map<string, unknown>();
  /** Per-key expiry in simulation seconds. Lets perception data go stale naturally. */
  private expiry = new Map<string, number>();

  get<T>(key: BlackboardKey<T>, now?: number): T {
    if (now !== undefined) {
      const exp = this.expiry.get(key.name);
      if (exp !== undefined && now > exp) {
        this.data.delete(key.name);
        this.expiry.delete(key.name);
        return key.defaultValue;
      }
    }
    const v = this.data.get(key.name);
    return v === undefined ? key.defaultValue : (v as T);
  }

  set<T>(key: BlackboardKey<T>, value: T, expiresAt?: number): void {
    this.data.set(key.name, value);
    if (expiresAt !== undefined) this.expiry.set(key.name, expiresAt);
    else this.expiry.delete(key.name);
  }

  has<T>(key: BlackboardKey<T>): boolean {
    return this.data.has(key.name);
  }

  delete<T>(key: BlackboardKey<T>): void {
    this.data.delete(key.name);
    this.expiry.delete(key.name);
  }

  clear(): void {
    this.data.clear();
    this.expiry.clear();
  }

  /** Drop everything past its expiry. Called on the AI's slow tick. */
  prune(now: number): void {
    for (const [name, exp] of this.expiry) {
      if (now > exp) {
        this.data.delete(name);
        this.expiry.delete(name);
      }
    }
  }

  /** Debug view for the AI inspector overlay. */
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.data);
  }
}
