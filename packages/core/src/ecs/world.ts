/**
 * Entity–Component–System core.
 *
 * Design notes, because the choice here shapes every gameplay system:
 *
 * - Entities are generational handles packed into a single 32-bit number
 *   (20 bits index | 12 bits generation). This makes a stale reference
 *   *detectable* rather than silently aliasing a recycled entity — the classic
 *   source of "my Pokémon attacked a fainted target" bugs.
 *
 * - Components live in sparse sets (dense array + index map). Iteration over a
 *   query is cache-coherent over the dense array, and add/remove are O(1).
 *   A full archetype/SoA engine would iterate faster still, but it makes
 *   structural changes expensive, and our AI mutates component sets constantly
 *   (a Pokémon gains `Fleeing`, loses `Grazing`, gains `Airborne`...).
 *
 * - Queries cache their matching set and are invalidated by a structural
 *   version counter, so the common case (same query, many frames, few
 *   structural changes) costs a version compare.
 *
 * - Structural changes during iteration are deferred to a command buffer and
 *   flushed at a safe point. Systems can therefore spawn and destroy freely.
 */

export type Entity = number;

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1; // 1,048,575 live entities max
const GENERATION_MASK = 0xfff; // 4096 generations before wraparound

export const NULL_ENTITY: Entity = 0xffffffff;

export function entityIndex(e: Entity): number {
  return e & INDEX_MASK;
}

export function entityGeneration(e: Entity): number {
  return (e >>> INDEX_BITS) & GENERATION_MASK;
}

function makeEntity(index: number, generation: number): Entity {
  return ((generation & GENERATION_MASK) << INDEX_BITS) | (index & INDEX_MASK);
}

/**
 * A typed component handle. Created once at module scope, e.g.
 *   export const Transform = defineComponent<TransformData>('Transform');
 * The string name exists purely for debugging, save files and net protocol.
 */
export interface ComponentType<T> {
  readonly id: number;
  readonly name: string;
  /** Factory used by `world.add(e, Type)` when no initial value is supplied. */
  readonly create: () => T;
}

let nextComponentId = 0;
const componentRegistry = new Map<string, ComponentType<unknown>>();

export function defineComponent<T>(name: string, create: () => T = () => ({}) as T): ComponentType<T> {
  if (componentRegistry.has(name)) {
    throw new Error(`Component "${name}" is already defined. Component names must be unique.`);
  }
  const type: ComponentType<T> = { id: nextComponentId++, name, create };
  componentRegistry.set(name, type as ComponentType<unknown>);
  return type;
}

export function getComponentByName(name: string): ComponentType<unknown> | undefined {
  return componentRegistry.get(name);
}

/** Sparse-set storage for one component type. */
class ComponentStore<T> {
  /** Dense array of component values, parallel to `entities`. */
  readonly values: T[] = [];
  /** Dense array of owning entities. */
  readonly entities: Entity[] = [];
  /** entityIndex -> dense slot, or -1. */
  private sparse: Int32Array;

  constructor(capacity: number) {
    this.sparse = new Int32Array(capacity).fill(-1);
  }

  private grow(minCapacity: number): void {
    if (this.sparse.length >= minCapacity) return;
    let cap = this.sparse.length || 1024;
    while (cap < minCapacity) cap *= 2;
    const next = new Int32Array(cap).fill(-1);
    next.set(this.sparse);
    this.sparse = next;
  }

  has(index: number): boolean {
    return index < this.sparse.length && this.sparse[index] !== -1;
  }

  get(index: number): T | undefined {
    if (index >= this.sparse.length) return undefined;
    const slot = this.sparse[index];
    return slot === -1 ? undefined : this.values[slot];
  }

  set(entity: Entity, index: number, value: T): void {
    this.grow(index + 1);
    const slot = this.sparse[index];
    if (slot !== -1) {
      this.values[slot] = value;
      return;
    }
    this.sparse[index] = this.entities.length;
    this.entities.push(entity);
    this.values.push(value);
  }

  /** O(1) removal via swap-with-last. */
  remove(index: number): boolean {
    if (index >= this.sparse.length) return false;
    const slot = this.sparse[index];
    if (slot === -1) return false;

    const last = this.entities.length - 1;
    if (slot !== last) {
      const movedEntity = this.entities[last];
      this.entities[slot] = movedEntity;
      this.values[slot] = this.values[last];
      this.sparse[entityIndex(movedEntity)] = slot;
    }
    this.entities.pop();
    this.values.pop();
    this.sparse[index] = -1;
    return true;
  }

  get size(): number {
    return this.entities.length;
  }

  clear(): void {
    this.entities.length = 0;
    this.values.length = 0;
    this.sparse.fill(-1);
  }
}

type DeferredOp =
  | { kind: 'destroy'; entity: Entity }
  | { kind: 'add'; entity: Entity; type: ComponentType<unknown>; value: unknown }
  | { kind: 'remove'; entity: Entity; type: ComponentType<unknown> };

export interface QueryDescriptor {
  /** Entity must have every one of these. */
  all?: readonly ComponentType<unknown>[];
  /** Entity must have at least one of these (when non-empty). */
  any?: readonly ComponentType<unknown>[];
  /** Entity must have none of these. */
  none?: readonly ComponentType<unknown>[];
}

class Query {
  private cached: Entity[] = [];
  private cachedVersion = -1;

  private readonly world: World;
  readonly all: readonly ComponentType<unknown>[];
  readonly any: readonly ComponentType<unknown>[];
  readonly none: readonly ComponentType<unknown>[];

  constructor(
    world: World,
    all: readonly ComponentType<unknown>[],
    any: readonly ComponentType<unknown>[],
    none: readonly ComponentType<unknown>[],
  ) {
    this.world = world;
    this.all = all;
    this.any = any;
    this.none = none;
  }

  matches(entity: Entity): boolean {
    const idx = entityIndex(entity);
    for (const t of this.all) if (!this.world.hasIndex(idx, t)) return false;
    for (const t of this.none) if (this.world.hasIndex(idx, t)) return false;
    if (this.any.length > 0) {
      let ok = false;
      for (const t of this.any) {
        if (this.world.hasIndex(idx, t)) {
          ok = true;
          break;
        }
      }
      if (!ok) return false;
    }
    return true;
  }

  /**
   * Returns the matching entities. The array is reused between calls and is
   * only rebuilt when the world's structural version changed, so a system that
   * runs every frame against a stable world pays almost nothing.
   *
   * Treat the result as read-only and do not retain it across a flush.
   */
  execute(): readonly Entity[] {
    if (this.cachedVersion === this.world.structuralVersion) return this.cached;

    this.cached.length = 0;

    // Iterate the smallest required store — this is the whole trick that keeps
    // queries fast without archetypes.
    let smallest: ComponentType<unknown> | null = null;
    let smallestSize = Infinity;
    for (const t of this.all) {
      const size = this.world.storeSize(t);
      if (size < smallestSize) {
        smallestSize = size;
        smallest = t;
      }
    }

    if (smallest) {
      const candidates = this.world.entitiesWith(smallest);
      for (let i = 0; i < candidates.length; i++) {
        const e = candidates[i];
        if (this.matches(e)) this.cached.push(e);
      }
    } else {
      // No `all` constraint: fall back to scanning live entities.
      for (const e of this.world.allEntities()) {
        if (this.matches(e)) this.cached.push(e);
      }
    }

    this.cachedVersion = this.world.structuralVersion;
    return this.cached;
  }

  get count(): number {
    return this.execute().length;
  }
}

export class World {
  private stores = new Map<number, ComponentStore<unknown>>();
  private generations: Uint16Array;
  private alive: Uint8Array;
  private freeList: number[] = [];
  private nextIndex = 0;
  private deferred: DeferredOp[] = [];
  private queries = new Map<string, Query>();
  private iterationDepth = 0;

  /** Bumped on every structural change (entity or component add/remove). */
  structuralVersion = 0;

  /** Live entity count. */
  entityCount = 0;

  private readonly capacity: number;

  constructor(capacity = 65536) {
    this.capacity = capacity;
    this.generations = new Uint16Array(capacity);
    this.alive = new Uint8Array(capacity);
  }

  // ---------------------------------------------------------------- entities

  create(): Entity {
    let index: number;
    if (this.freeList.length > 0) {
      index = this.freeList.pop()!;
    } else {
      if (this.nextIndex >= this.capacity) {
        throw new Error(
          `ECS capacity of ${this.capacity} entities exhausted. ` +
            `Raise the World capacity or check for an entity leak (missing destroy()).`,
        );
      }
      index = this.nextIndex++;
    }
    this.alive[index] = 1;
    this.entityCount++;
    this.structuralVersion++;
    return makeEntity(index, this.generations[index]);
  }

  /** Is this handle still valid? False for destroyed entities, even if the slot was recycled. */
  isAlive(entity: Entity): boolean {
    const idx = entityIndex(entity);
    if (idx >= this.capacity || this.alive[idx] === 0) return false;
    return this.generations[idx] === entityGeneration(entity);
  }

  destroy(entity: Entity): void {
    if (this.iterationDepth > 0) {
      this.deferred.push({ kind: 'destroy', entity });
      return;
    }
    this.destroyImmediate(entity);
  }

  private destroyImmediate(entity: Entity): void {
    if (!this.isAlive(entity)) return;
    const idx = entityIndex(entity);
    for (const store of this.stores.values()) store.remove(idx);
    this.alive[idx] = 0;
    // Bumping the generation is what invalidates every outstanding handle.
    this.generations[idx] = (this.generations[idx] + 1) & GENERATION_MASK;
    this.freeList.push(idx);
    this.entityCount--;
    this.structuralVersion++;
  }

  *allEntities(): IterableIterator<Entity> {
    for (let i = 0; i < this.nextIndex; i++) {
      if (this.alive[i] === 1) yield makeEntity(i, this.generations[i]);
    }
  }

  // -------------------------------------------------------------- components

  private storeFor<T>(type: ComponentType<T>): ComponentStore<T> {
    let store = this.stores.get(type.id) as ComponentStore<T> | undefined;
    if (!store) {
      store = new ComponentStore<T>(this.capacity);
      this.stores.set(type.id, store as ComponentStore<unknown>);
    }
    return store;
  }

  add<T>(entity: Entity, type: ComponentType<T>, value?: T): T {
    const v = value ?? type.create();
    if (this.iterationDepth > 0) {
      this.deferred.push({ kind: 'add', entity, type: type as ComponentType<unknown>, value: v });
      return v;
    }
    return this.addImmediate(entity, type, v);
  }

  private addImmediate<T>(entity: Entity, type: ComponentType<T>, value: T): T {
    if (!this.isAlive(entity)) return value;
    const idx = entityIndex(entity);
    const store = this.storeFor(type);
    const existed = store.has(idx);
    store.set(entity, idx, value);
    if (!existed) this.structuralVersion++;
    return value;
  }

  get<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    if (!this.isAlive(entity)) return undefined;
    return this.storeFor(type).get(entityIndex(entity));
  }

  /**
   * Get a component that is required to exist. Throws a message that names the
   * component and entity rather than producing a downstream `undefined` crash.
   */
  getOrThrow<T>(entity: Entity, type: ComponentType<T>): T {
    const v = this.get(entity, type);
    if (v === undefined) {
      throw new Error(
        `Entity ${entityIndex(entity)}#${entityGeneration(entity)} has no "${type.name}" component ` +
          `(alive=${this.isAlive(entity)}).`,
      );
    }
    return v;
  }

  has<T>(entity: Entity, type: ComponentType<T>): boolean {
    if (!this.isAlive(entity)) return false;
    return this.storeFor(type).has(entityIndex(entity));
  }

  /** Internal fast path used by queries — skips the aliveness check. */
  hasIndex(index: number, type: ComponentType<unknown>): boolean {
    return this.storeFor(type).has(index);
  }

  storeSize(type: ComponentType<unknown>): number {
    return this.storeFor(type).size;
  }

  entitiesWith(type: ComponentType<unknown>): readonly Entity[] {
    return this.storeFor(type).entities;
  }

  /** Dense value array for a component — for systems that want raw iteration. */
  valuesOf<T>(type: ComponentType<T>): readonly T[] {
    return this.storeFor(type).values;
  }

  remove<T>(entity: Entity, type: ComponentType<T>): void {
    if (this.iterationDepth > 0) {
      this.deferred.push({ kind: 'remove', entity, type: type as ComponentType<unknown> });
      return;
    }
    this.removeImmediate(entity, type);
  }

  private removeImmediate<T>(entity: Entity, type: ComponentType<T>): void {
    if (!this.isAlive(entity)) return;
    if (this.storeFor(type).remove(entityIndex(entity))) this.structuralVersion++;
  }

  // ------------------------------------------------------------------ queries

  query(desc: QueryDescriptor): Query {
    const all = desc.all ?? [];
    const any = desc.any ?? [];
    const none = desc.none ?? [];
    const key = `A${all.map((t) => t.id).sort((a, b) => a - b).join(',')}` +
      `|N${any.map((t) => t.id).sort((a, b) => a - b).join(',')}` +
      `|X${none.map((t) => t.id).sort((a, b) => a - b).join(',')}`;
    let q = this.queries.get(key);
    if (!q) {
      q = new Query(this, all, any, none);
      this.queries.set(key, q);
    }
    return q;
  }

  /**
   * Iterate a query with structural changes deferred.
   * This is the safe way for a system to spawn/destroy while iterating.
   */
  each(desc: QueryDescriptor, fn: (entity: Entity) => void): void {
    const entities = this.query(desc).execute();
    this.iterationDepth++;
    try {
      // Snapshot length: entities added during iteration are handled next flush.
      for (let i = 0, n = entities.length; i < n; i++) {
        const e = entities[i];
        if (this.isAlive(e)) fn(e);
      }
    } finally {
      this.iterationDepth--;
      if (this.iterationDepth === 0) this.flush();
    }
  }

  /** Apply all deferred structural changes. Called automatically after `each`. */
  flush(): void {
    if (this.deferred.length === 0) return;
    // Take ownership: an op may enqueue more ops (e.g. a destroy cascade).
    const ops = this.deferred;
    this.deferred = [];
    for (const op of ops) {
      switch (op.kind) {
        case 'destroy':
          this.destroyImmediate(op.entity);
          break;
        case 'add':
          this.addImmediate(op.entity, op.type, op.value);
          break;
        case 'remove':
          this.removeImmediate(op.entity, op.type);
          break;
      }
    }
    if (this.deferred.length > 0) this.flush();
  }

  clear(): void {
    for (const store of this.stores.values()) store.clear();
    this.alive.fill(0);
    this.generations.fill(0);
    this.freeList.length = 0;
    this.nextIndex = 0;
    this.entityCount = 0;
    this.deferred.length = 0;
    this.structuralVersion++;
  }

  /** Diagnostics for the in-game profiler overlay. */
  stats(): { entities: number; components: Record<string, number>; version: number } {
    const components: Record<string, number> = {};
    for (const [id, store] of this.stores) {
      for (const type of componentRegistry.values()) {
        if (type.id === id) {
          components[type.name] = store.size;
          break;
        }
      }
    }
    return { entities: this.entityCount, components, version: this.structuralVersion };
  }
}
