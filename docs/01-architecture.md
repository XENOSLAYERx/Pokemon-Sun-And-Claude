# Game Architecture

**Document owner:** Lead Gameplay Programmer
**Status:** Implemented — this describes the code in this repository.

---

## 1. The organising principle

> **The simulation does not know that rendering exists.**

Every gameplay system lives in a package that cannot import Three.js, the DOM,
or any Node API. This is enforced structurally — those packages simply do not
list them as dependencies — and it is the single decision that everything else
in this document follows from.

It buys four things that are otherwise very expensive to retrofit:

1. **The server runs the real game.** `apps/server` imports the same
   `@alola/world` and `@alola/ai` the client does. There is no second,
   drifting implementation of movement or spawning to keep in sync.
2. **The simulation is testable.** 553 tests run in Node with no browser, no
   GPU and no mocking layer. Ecosystem behaviour over 1,000 ticks is a unit
   test, not a play session.
3. **It can move to a Worker.** Nothing in the simulation touches the main
   thread's globals, so relocating it is a plumbing change, not a rewrite.
4. **Determinism is achievable.** With no rendering in the loop there is no
   frame-rate-dependent state, which is what makes replays and lockstep
   battles possible at all.

## 2. Package graph

```
                         ┌──────────────┐
                         │  @alola/core │  ECS · math · RNG · noise
                         │  (no deps)   │  events · time · spatial
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │  @alola/data │  species · moves · Z-Moves
                         │              │  biomes · islands · spawns
                         └──────┬───────┘  items · trials · quests
                                │
        ┌───────────────┬───────┴───────┬──────────────┬─────────────┐
        │               │               │              │             │
 ┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐ ┌──────▼────┐ ┌──────▼────┐
 │@alola/world│  │@alola/battle│ │@alola/quest│ │@alola/save│ │ @alola/net│
 │ terrain    │  │ turn engine │ │ graph      │ │ migrations│ │ protocol  │
 │ streaming  │  │ damage      │ │ reputation │ │ storage   │ │ interest  │
 │ weather    │  │ Z-Moves     │ └────────────┘ └───────────┘ │ prediction│
 │ ocean      │  │ Totems      │                              └───────────┘
 │ ecology    │  │ arena · AI  │
 └──────┬─────┘  └─────────────┘
        │
 ┌──────▼─────┐
 │ @alola/ai  │  perception · needs · memory
 │            │  utility goals · behaviour trees · flocking
 └────────────┘

 ── presentation boundary ──────────────────────────────────────────────

 ┌─────────────┐  ┌────────────┐            ┌──────────────┐
 │@alola/render│  │@alola/audio│            │  @alola/ui   │
 │ Three.js    │  │ mix state  │            │ HUD · menus  │
 └─────────────┘  └────────────┘            └──────────────┘
        │                │                          │
        └────────────────┴──────────┬───────────────┘
                                    │
                         ┌──────────▼──────────┐    ┌──────────────┐
                         │   apps/client       │    │ apps/server  │
                         │   Vite + Three.js   │    │ headless     │
                         └─────────────────────┘    └──────────────┘
```

`@alola/audio` is above the presentation line in spirit — it computes *what
should be heard* as pure state and has no Web Audio dependency — but it is
grouped with presentation because nothing below it consumes its output.

## 3. Frame and tick structure

Two clocks, deliberately separated.

**Simulation: fixed 60Hz.** Battles, AI and netcode all require that a given
tick produces a given result. A variable delta makes replays drift and makes
client/server reconciliation impossible.

**Rendering: display rate.** Presentation interpolates between the two most
recent simulation states using the clock's `alpha`.

```
requestAnimationFrame
  │
  ├─ adaptiveQuality.update(frameMs)      ← may change the preset
  │
  ├─ clock.advance(now, simulate)         ← 0..4 fixed steps
  │     └─ simulate(dt):
  │          Phase.Input        sample devices / network commands
  │          Phase.Environment  time of day, weather, ocean
  │          Phase.Perception   who can see whom
  │          Phase.Decision     AI goal selection
  │          Phase.Movement     steering, locomotion integration
  │          Phase.PostPhysics  ground clamp, water snap
  │          Phase.Gameplay     triggers, encounters, quests, battle
  │          Phase.Cleanup      deferred destruction
  │
  ├─ updateStreaming(frameDt)             ← ONCE PER FRAME, not per tick
  │
  └─ render(alpha, frameDt)
```

### Why streaming is outside the fixed loop

This is a real bug we shipped and then fixed, and the reasoning generalises.

The clock runs up to four catch-up steps per frame. Streaming was originally
called from inside `simulate`, with a budget of "2 chunk builds per tick". On a
frame where the clock caught up four steps, that became **eight synchronous
chunk builds in one frame**.

A budget that exists to protect frame time has to be enforced per frame. The
same rule applies to anything else whose cost is measured in milliseconds of
frame budget rather than in simulation correctness.

## 4. Determinism

Determinism is load-bearing for four systems, and the mechanisms differ:

| System | What must be reproducible | Mechanism |
|---|---|---|
| Netcode | Client and server agree on battle outcomes | Shared engine, shared seed |
| Replays | A battle replays from a log | Seed + input log, no state dump |
| World identity | A chunk regenerates identically | Pure function of (seed, position) |
| Shiny hunting | Players trust that a reset re-rolls | Isolated per-individual RNG stream |

The critical mechanism is **stream forking**. Every subsystem draws from its
own forked RNG stream rather than a shared sequence:

```ts
const chunkRng = rngForCell(worldSeed, cx, cz, 'spawn');
const shinyRng = new Rng(hashCombine(personality, 0x5417, cx, cz));
```

Without forking, adding a single new random call to the weather system shifts
every subsequent spawn roll in the game. With it, systems evolve independently.

Enforced by `packages/core/test/core.test.ts`: identical seeds produce
identical sequences; sibling forks diverge; neighbouring chunks do not
correlate.

## 5. Entity model

An archetype-flavoured ECS over sparse sets (`packages/core/src/ecs/world.ts`).

**Generational handles.** An entity id packs a 20-bit index and a 12-bit
generation. Destroying an entity bumps its generation, so a retained handle is
*detectably* stale rather than silently aliasing a recycled entity — the
classic source of "my Pokémon attacked a fainted target".

**Sparse sets, not full SoA archetypes.** A pure archetype engine iterates
faster but makes structural change expensive, and our AI mutates component sets
constantly: a Pokémon gains `Fleeing`, loses `Grazing`, gains `Airborne`.
Sparse sets give O(1) add/remove and cache-coherent iteration over the dense
array, which is the right trade for this workload.

**Deferred structural change.** `world.each()` defers adds and destroys to a
command buffer flushed at a phase boundary, so systems can spawn and destroy
freely while iterating.

## 6. Simulation level of detail

The single most important optimisation in the world simulation. A Pokémon 800m
away does not need perception, pathfinding or animation.

| Tier | Distance | Behaviour |
|---|---|---|
| Full | < 60m | Full perception, decisions, steering, every tick |
| Reduced | 60–180m | Perceives and decides at ⅓ rate, simplified steering |
| Coarse | 180–500m | No perception; drifts toward home on a 2s cadence |
| Dormant | > 500m | Nothing at all |

**Dormant agents are fully paused, including their needs.** This is
deliberate: advancing hunger for the twenty minutes a player spends on another
island would have every distant Pokémon starving when they return.

Agents carry a per-agent tick offset so they do not all re-decide on the same
frame. Without the stagger, LOD gives you the same total work arriving as a
periodic spike instead of a flat cost.

Measured: 0.068ms per tick for 208 agents (0.33µs/agent) in the headless
harness; 0.01ms per full AI tick for 41 agents in-browser.

## 7. Threading model

Currently single-threaded; designed so that is a plumbing change.

| Work | Thread today | Thread at ship |
|---|---|---|
| Simulation tick | Main | Worker (SharedArrayBuffer state) |
| Chunk mesh generation | Main | Worker pool (2–4) |
| Foliage scatter | Main | Same pool as chunk gen |
| Far terrain | Main, at boot | Baked offline by the content pipeline |
| Rendering | Main | Main (unavoidable) |
| Audio mixing | — | Audio worklet |

Chunk generation is the first candidate: it takes only `(seed, cx, cz, lod)`
and returns buffers, so it transfers cleanly with no shared state.

## 8. Error handling

Three rules, all visible in the code:

1. **Fail loudly at the boundary, gracefully in the loop.** `getSpecies()`
   throws with a suggestion; the ecosystem tick clamps a NaN and continues.
2. **Invariants are runtime-checked where a silent failure is worse than a
   crash.** The LOD table length check exists because a mismatch silently
   disabled streaming entirely, which the headless harness caught only by
   reporting zero chunks built.
3. **Never lose player data.** Saves write to a temp key, verify by read-back,
   then swap; a corrupt primary falls back to a backup.

## 9. Where the bodies are buried

Honest notes on what is prototype-grade in this repository:

- **Pokémon and the player are procedural models**, built in code and animated
  in the vertex shader. They read well and cost little, but they are not
  authored art; the art pipeline (`15-art-pipeline.md`) is specified, not built.
  Authored `.glb` files can replace any of them without code changes.
- **The terrain shader is written but not wired.** The client uses a
  vertex-coloured standard material because the full shader needs texture
  arrays the content pipeline would bake. The shader compiles and is tested for
  uniform completeness.
- **No navmesh.** Steering handles avoidance; there is no pathfinding around
  large obstacles. Fine for open terrain, insufficient for town interiors.
- **Battles are not yet wired into the client.** The engine is complete and
  tested in isolation (62 tests); the client does not yet trigger encounters.
- **Netcode has no transport.** `WorldServer` is complete and self-tested; a
  WebSocket layer is not written.
