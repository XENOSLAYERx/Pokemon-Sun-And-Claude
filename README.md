# Project Alola

An open-world 3D reimagining of Alola — the region of *Pokémon Sun & Moon* —
rebuilt as a seamless, streaming, living archipelago.

This repository is a **working simulation**, not a slide deck. Five islands are
generated, streamed and classified into biomes; Pokémon spawn from weighted
tables and then live their own lives — hunting, fleeing, flocking, sleeping,
defending territory; weather evolves per island and drives the ocean; a
deterministic battle engine resolves fights that can be replayed exactly. It
runs in a browser, it runs headless on a server, and 430 tests run in Node with
no browser and no build step.

📚 **[Full documentation index →](docs/README.md)** — twenty design documents,
seven technical design documents, a production roadmap and a world design bible.

---

## Quick start

```bash
npm install

npm test                  # 430 tests, ~1.7s, no browser required
npm run typecheck         # tsc --noEmit, strict
npm run validate:content  # referential integrity across every content table

npm run dev               # browser client  (Vite)
npm run dev:server        # authoritative server
npm run sim               # headless simulation harness with per-system timings
```

Node ≥ 20.11. **There is no build step.** `erasableSyntaxOnly` is enabled, so
every source file executes directly under `node --experimental-strip-types` —
no enums, no parameter properties, nothing that survives type erasure.

---

## What is actually implemented

### The world
- **Five islands** — Melemele, Akala, Ula'ula, Poni, Aether Paradise — in a
  40km × 40km ocean, each substantially larger than its original. Verified
  non-overlapping, with open water between every pair.
- **Terrain is a pure function** of `(worldSeed, x, z)`: ridged and billow
  multifractals, domain warping, Worley cells, with authored features
  composited on top. Nothing is stored; the same coordinate always returns the
  same height, on any machine.
- **Seamless streaming** — 256m chunks in four LOD rings out to 3.6km, then a
  single far-terrain mesh to 20km. Temporal hysteresis stops boundary thrash;
  skirts hide LOD cracks without coupling a chunk to its neighbours.
- **28 biomes** classified from elevation, moisture, temperature and slope.
- **Per-island weather** as a Markov chain with persistence bias, diurnal bias
  and forbidden transitions, cross-faded rather than snapped.
- **Gerstner ocean** with the real deep-water dispersion relation `√(gL/2π)`,
  evaluated identically on CPU and GPU — so a Lapras floats on the surface the
  player can see. A thunderstorm takes significant wave height from 0.66m to
  5.58m.

### The Pokémon
- **No random encounters.** Every Pokémon is a simulated entity in the world.
- **Utility AI** — weighted response curves over 14 goals, multiplicatively
  scored with per-consideration complexity compensation and a commitment bonus
  so a decision does not flicker — driving resumable behaviour trees.
- **Species behave like themselves**, from data rather than from special cases:
  Pikachu is curious, playful and social; Bewear is protective and will not
  break off; Sharpedo is an aggressive predator with *no flee goal at all*;
  Lapras has neither flee nor attack; Wingull flocks; Growlithe holds territory.
- **Memory, needs, fear, aggression and curiosity** per individual, with
  relationships that persist.
- **Predator–prey ecology** on a Lotka–Volterra model with explicit
  harvest → predation → growth → migration ordering, so populations move rather
  than oscillate.
- **Flocking** via Reynolds boids with priority truncation.
- **Four-tier simulation LOD** (Full / Reduced / Coarse / Dormant) with
  per-agent tick stagger, so distant wildlife stays alive for free.
- Spawning weighted by biome, hour, weather and progression flags, with alphas
  and visible shinies at an exact 1/4096 via `odds(1, 4096)` — not a float
  comparison that drifts.

### Combat
- **Deterministic engine**: a pure function over `(state, actions, seed)` that
  emits a typed event stream. The renderer, audio, battle log and netcode all
  read the same events, so they cannot disagree.
- **The mainline damage formula**, with its integer truncations in the correct
  order — the order *is* the specification.
- **Formats**: single, double, multi, royale, totem, raid.
- **Z-Moves** with player-performed poses scored for timing, camera beat lists,
  VFX and environmental reactions resolved against the actual arena surface.
- **Totem bosses** with HP-threshold phases that change weather and terrain,
  call SOS allies, and swap movesets mid-fight.
- **Arenas generated from wherever the player is standing**, nudged toward
  flatter ground, with biome-appropriate surfaces and camera framing that keeps
  both combatants in shot whatever their size.

### Systems
- **Quests** with branching objectives, an acyclic and fully reachable
  objective graph, and NPC reputation across 10 factions.
- **Saves** versioned with contiguous migrations and a
  temp-write → verify → swap → backup-fallback commit.
- **Netcode**: server-authoritative with client prediction and reconciliation,
  interpolated remote entities, distance-banded interest management with
  budgets, delta encoding (measured: 28.5 entities/snapshot at **51.6 KB/s per
  client** as uncompressed JSON — the binary codec that would cut that is not
  written), and **lockstep battles** where only inputs cross the wire.
- **Character creator**, HUD, menu navigation, audio director, five graphics
  quality presets with software-renderer detection and adaptive fallback.

---

## Architecture in one paragraph

Eleven packages under `packages/`, with one rule that shapes everything: **no
package below the presentation boundary may import Three.js, the DOM or Node.**
`core`, `data`, `world`, `ai`, `battle`, `quest`, `save`, `net` and `audio` are
pure simulation; only `render`, `ui` and the apps above them touch a renderer.
That is why the same code runs in a browser, on a headless server and inside
`node --test`, and why 430 tests need no browser. See
[`docs/01-architecture.md`](docs/01-architecture.md).

```
packages/
  core     deterministic RNG, noise, ECS, scheduler, clock, spatial hash
  data     species, moves, Z-Moves, biomes, islands, spawns, items, quests
  world    terrain, streaming, biomes, weather, time of day, ocean, ecology
  ai       perception, utility scoring, behaviour trees, memory, flocking
  battle   damage, engine, Totems, Z-Move cinematics, arenas, trainer AI
  quest    objective graphs, branching, reputation
  save     schema, migrations, atomic commit
  net      protocol, interest management, prediction, interpolation
  audio    music director, ambience, stingers
  render   terrain meshes, far terrain, shaders, instancing, camera, quality
  ui       character creator, HUD, menus
apps/      client (Vite + Three.js), server (headless authority)
tools/     headless simulation harness, content validator, content baker
```

---

## Performance: what was measured, and what was not

**Simulation is effectively free.** Measured in the headless harness:

```
AI cost per tick
  mean        0.068ms for 208 agents
  peak        3.085ms
  per agent   0.33µs
✓ All systems stable. No NaN, no deadlock, no runaway populations.
```

Across six runs the mean sits between 0.060ms and 0.068ms (0.29–0.33µs per
agent); the slower figure is the one quoted, here and in the documents.

**Rendering in this container is not.** The browser client runs at 2–3 FPS here
because there is no GPU and Chromium falls back to SwiftShader. Hiding the 159
terrain meshes — changing nothing else — takes the same scene from **2.3 FPS to
36.3 FPS**, which locates the cost exactly: software rasterisation, not
simulation.

So: **no claim of 60 FPS on measured hardware appears anywhere in this
repository**, because no such hardware was available. What *was* measured and
improved:

| Change | Result |
|--------|--------|
| Streaming radius cap + far terrain | 3,068 → **621 chunks** (−80%) |
| Far terrain mesh | 5 draw calls, 242k triangles, built once |
| Coast-warp early-out + grid normals | `terrain.sample` 13.5µs → **6.15µs** |
| Streaming moved per-frame, not per-tick | up to 8 × 225ms builds/frame → 2 |

Full breakdown in [`docs/tdd/tdd-07-performance.md`](docs/tdd/tdd-07-performance.md).

---

## Verification

```
npm test                 430 passing   core 42 · data 42 · world 60 · ai 66
                                       battle 63 · quest 18 · save 18 · net 29
                                       audio 17 · render 43 · ui 32
npm run typecheck        clean
npm run validate:content referential integrity across every content table
npm run sim              long-run stability, no NaN, no runaway populations
node --experimental-strip-types apps/server/src/main.ts --selftest
                         boots the world headless and asserts wildlife spawned
```

The client was additionally driven in a real browser (Playwright + SwiftShader):
zero page errors, 430 chunks resident, 40 Pokémon pursuing distinct goals, and
weather visibly driving the ocean.

---

## Documentation

| | |
|---|---|
| [Index](docs/README.md) | All documents, with reading orders |
| [Vision](docs/00-vision.md) | What this game is and what it is for |
| [Architecture](docs/01-architecture.md) | The presentation boundary and why it holds |
| [World design bible](docs/20-world-design-bible.md) | All five islands, POI by POI |
| [Code examples](docs/17-code-examples.md) | 22 real excerpts, with the reasoning behind each |
| [Roadmap](docs/production/18-roadmap.md) · [Milestones](docs/production/19-milestones.md) | Production plan |
| [TDDs](docs/README.md#technical-design-documents) | Determinism, terrain, ocean, ECS, battle, netcode, performance |

---

## Status

This is a deep vertical slice of the simulation layer, not a finished game. Each
document's **Not done** section is accurate and specific: there is no transport
layer under the netcode, no GPU profiling, no occlusion culling, no art assets,
and ability coverage in battle is partial. What exists, works, is tested, and is
honest about its edges.

*Not affiliated with or endorsed by Nintendo, Game Freak or The Pokémon Company.
A technical and design exercise.*
