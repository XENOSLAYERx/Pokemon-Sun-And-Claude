# TDD-04 — Entity Model and Simulation Scheduling

**Author:** Lead Gameplay Programmer
**Status:** Implemented in `packages/core/src/ecs/world.ts`,
`packages/core/src/ecs/scheduler.ts`, `packages/core/src/time/clock.ts`.

---

## Requirement

An Alola with thousands of simultaneously simulated Pokémon, NPCs, quest
volumes, weather emitters and streamed props needs an entity model that:

1. Survives references outliving their target. A Bewear that has been unloaded
   while a Growlithe was pursuing it must not silently become whatever entity
   recycled its slot.
2. Lets any system spawn or destroy entities at any point without invalidating
   an iteration already in flight.
3. Keeps query cost proportional to the *matching* set, not the world size.
4. Runs in a declared order, because a 60-system simulation ordered by
   registration accident is not debuggable.

## Design: generational handles in a single 32-bit word

```
 31          20 19            0
┌──────────────┬───────────────┐
│ generation   │ index         │
│ 12 bits      │ 20 bits       │
└──────────────┴───────────────┘
```

- **1,048,575** live entities addressable — two orders of magnitude above
  anything Alola needs, which leaves room for particles and props to be
  entities too rather than a parallel system.
- **4,096 generations** before wraparound. `destroyImmediate` increments the
  slot's generation, so every outstanding handle to that slot fails `isAlive`
  from that moment.

An entity is a plain `number`. No allocation, no `Map` lookup for identity,
trivially serialisable in save files and network messages.

The critical property is that a stale handle is **detectable**:

```ts
isAlive(entity: Entity): boolean {
  const idx = entityIndex(entity);
  if (idx >= this.capacity || this.alive[idx] === 0) return false;
  return this.generations[idx] === entityGeneration(entity);
}
```

Without the generation field, a recycled slot makes a stale handle *valid but
wrong* — the bug class that produces "my Pokémon attacked a fainted target" and
takes a week to find. With it, the failure is a clean `false`.

## Storage: sparse sets, not archetypes

Each component type owns a `ComponentStore`:

- `values[]` and `entities[]` — dense, parallel, cache-coherent to iterate.
- `sparse: Int32Array` — entity index → dense slot, or `-1`.
- Removal is swap-with-last, O(1), with the moved entity's sparse entry
  repaired.

An archetype/SoA engine iterates faster. It was rejected because **structural
change is our common case, not our rare case**. A single Pokémon transitions
`Grazing → Alert → Fleeing → Airborne → Resting` in a few seconds of play; under
archetypes each of those is a chunk migration copying every component. Sparse
sets make the transition a bitmask flip and the iteration slightly slower, which
is the right trade for this workload.

## Queries: iterate the smallest store

```ts
let smallest: ComponentType<unknown> | null = null;
let smallestSize = Infinity;
for (const t of this.all) {
  const size = this.world.storeSize(t);
  if (size < smallestSize) { smallestSize = size; smallest = t; }
}
```

A query for `{ all: [Transform, TotemAura] }` in a world of 4,000 entities
iterates the *one* Totem, not 4,000 transforms. This is the single trick that
makes sparse sets competitive with archetypes for our query shapes.

Results are cached and invalidated by `structuralVersion`, a counter bumped on
every entity or component add/remove. A system that runs every frame against a
structurally stable world pays one integer compare.

## Deferred structural change

`world.each()` raises `iterationDepth`. While it is non-zero, `create`,
`destroy`, `add` and `remove` push onto a command buffer instead of mutating.
`flush()` drains it — and re-drains, because a destroy can cascade:

```ts
flush(): void {
  if (this.deferred.length === 0) return;
  const ops = this.deferred;
  this.deferred = [];          // take ownership before applying
  for (const op of ops) { /* apply */ }
  if (this.deferred.length > 0) this.flush();
}
```

Taking ownership of the array before iterating is what makes the cascade safe;
mutating the array being iterated is the obvious version of this code and it is
wrong.

## Scheduling: declared phases, topological order within them

Ten phases run in a fixed order every tick:

| # | Phase | Contract |
|---|-------|----------|
| 0 | `Input` | Sample devices and network commands |
| 1 | `Environment` | Time of day, weather, tides — everything downstream reads these |
| 2 | `Perception` | Who can see whom |
| 3 | `Decision` | AI. **Writes intents, never transforms** |
| 4 | `Movement` | Steering and locomotion. Writes transforms |
| 5 | `PostPhysics` | Ground clamp, collision, water snapping |
| 6 | `Gameplay` | Encounters, triggers, quests, battle ticks |
| 7 | `Streaming` | Chunk load/unload, spawn/despawn, LOD budget |
| 8 | `Presentation` | Animation, audio emitters, VFX — read-only |
| 9 | `Cleanup` | Deferred destruction, metrics |

The `Decision`/`Movement` split is the load-bearing one: an AI system that moves
an entity directly makes perception order-dependent, and order-dependent
perception is how you get Pokémon that react to where something *will* be.

Within a phase, systems declare `after: string[]` names and are topologically
sorted. A cycle throws at rebuild time, naming the chain:

```
Cyclic system dependency in phase Decision: senses -> utility -> senses
```

`world.flush()` runs at every **phase boundary**, so systems inside a phase
always observe a consistent world, and a spawn in `Gameplay` is visible to
`Streaming` in the same tick.

`interval: N` runs a system every N ticks — used for ecology, migration and
population rebalancing, which are meaningless at 60Hz and expensive.

## The clock

Simulation is a fixed 60Hz step. Rendering runs at display rate and receives an
interpolation `alpha` in `[0,1)`. A frame that took too long is bounded:

```ts
const maxStepsPerFrame = 5;
```

Past that the accumulator is drained without running steps. A hitch therefore
costs a small time discontinuity instead of a death spiral where each frame
takes longer than the one before because it is running more catch-up steps.

## Profiling

The scheduler keeps an exponential moving average (α = 0.1) of per-system
milliseconds and exposes `getTimings()` sorted slowest-first. `profiling = false`
on the server and in headless runs. This is how the AI cost numbers in
`docs/17-code-examples.md` were measured — from the shipping scheduler, not from
a benchmark harness that flatters it.

## Verification

Covered in `packages/core/test/core.test.ts` (42 assertions in this package):

| Test | What it pins |
|------|--------------|
| `entity lifecycle and generational safety` | A destroyed handle fails `isAlive` even after its slot is recycled |
| `queries match all/none constraints` | `all` / `any` / `none` semantics |
| `query cache invalidates on structural change` | The `structuralVersion` fast path cannot go stale |
| `structural changes during iteration are deferred, not lost` | `each` + destroy neither skips nor double-visits |
| `getOrThrow names the missing component` | Failures name the component and entity, not `undefined` downstream |
| `capacity exhaustion raises a clear error` | An entity leak is diagnosable |
| `phases run in declared order` | The ten-phase contract |
| `after-dependencies sort within a phase` | Topological sort inside a phase |
| `cyclic dependencies are reported, not hung` | A cycle throws with the chain in the message |
| `interval systems run only on matching ticks` | `interval: N` gating |
| `produces a stable number of ticks per second` | Fixed 60Hz step |
| `does not spiral after a long stall` | The `maxStepsPerFrame = 5` guard |
| `timeScale zero pauses the simulation` | Time scaling without drift |

## Not done

- **No parallelism.** Everything is single-threaded. The phase contract is
  already the dependency information a job system would need, so this is a
  deliberate deferral rather than a design dead end.
- **No archetype fast path** for the few genuinely hot, structurally stable
  queries (transform integration).
- **Component storage is `T[]`, not typed arrays.** Cache behaviour would
  improve measurably for `Transform` and `Velocity`; it has not been the
  bottleneck, so it has not been done.
