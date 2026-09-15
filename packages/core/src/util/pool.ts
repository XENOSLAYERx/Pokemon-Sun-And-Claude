/**
 * Object pool.
 *
 * JS garbage collection is the single largest source of frame-time spikes in a
 * game like this: a hitch during a Z-Move is far worse than a slightly lower
 * average frame rate. Anything allocated per-frame in the hundreds — particles,
 * damage numbers, steering vectors, audio voices, battle events — comes from
 * a pool instead.
 */
export class Pool<T> {
  private free: T[] = [];
  private inUse = new Set<T>();
  private readonly factory: () => T;
  private readonly reset: (item: T) => void;
  private readonly maxSize: number;

  constructor(factory: () => T, reset: (item: T) => void, initialSize = 0, maxSize = Infinity) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;
    for (let i = 0; i < initialSize; i++) this.free.push(factory());
  }

  acquire(): T {
    const item = this.free.pop() ?? this.factory();
    this.inUse.add(item);
    return item;
  }

  release(item: T): void {
    if (!this.inUse.delete(item)) return; // Double-release is a no-op, not a corruption.
    this.reset(item);
    if (this.free.length < this.maxSize) this.free.push(item);
  }

  releaseAll(): void {
    for (const item of this.inUse) {
      this.reset(item);
      if (this.free.length < this.maxSize) this.free.push(item);
    }
    this.inUse.clear();
  }

  get activeCount(): number {
    return this.inUse.size;
  }

  get freeCount(): number {
    return this.free.length;
  }
}

/**
 * A fixed-capacity ring buffer.
 * Used for rolling histories: frame timings, AI memory of recent events,
 * netcode input buffers, battle logs.
 */
export class RingBuffer<T> {
  readonly capacity: number;
  private items: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.items = new Array<T | undefined>(capacity);
  }

  /** Push, overwriting the oldest entry when full. Returns the evicted item. */
  push(item: T): T | undefined {
    const evicted = this.count === this.capacity ? this.items[this.head] : undefined;
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    return evicted;
  }

  /** 0 = most recent. */
  get(indexFromNewest: number): T | undefined {
    if (indexFromNewest < 0 || indexFromNewest >= this.count) return undefined;
    const idx = (this.head - 1 - indexFromNewest + this.capacity * 2) % this.capacity;
    return this.items[idx];
  }

  /** Newest first. */
  *[Symbol.iterator](): IterableIterator<T> {
    for (let i = 0; i < this.count; i++) {
      const v = this.get(i);
      if (v !== undefined) yield v;
    }
  }

  toArray(): T[] {
    return [...this];
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  get isFull(): boolean {
    return this.count === this.capacity;
  }
}
