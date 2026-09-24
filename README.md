# Project Alola

An open-world 3D reimagining of Alola — the region of *Pokémon Sun & Moon* —
rebuilt as a seamless, streaming, living archipelago.

This repository is a **playable game**, not a slide deck. Five islands are
generated, streamed and classified into biomes; Pokémon spawn from weighted
tables and then live their own lives — hunting, fleeing, flocking, sleeping,
defending territory; weather evolves per island and drives the ocean. Walk up to
one of them, press **E**, and you are in a cinematic battle staged on the exact
ground you were standing on. Catch it, level your team, save, come back. It runs
in a browser, it runs headless on a server, and 553 tests run in Node with no
browser and no build step.

🎮 **[How to play →](PLAYING.md)** — setup, controls and troubleshooting, from a clean machine.

📚 **[Full documentation index →](docs/README.md)** — twenty design documents,
seven technical design documents, a production roadmap and a world design bible.

---

## Quick start

```bash
npm install

npm test                  # 553 tests, ~2s, no browser required
npm run typecheck         # tsc --noEmit, strict
npm run validate:content  # referential integrity across every content table

npm run dev               # browser client  (Vite)
npm run dev:server        # authoritative server
npm run sim               # headless simulation harness with per-system timings
npm run models:export     # write the built-in 3D models out as .glb files
```

Node ≥ 20.11. **There is no build step.** `erasableSyntaxOnly` is enabled, so
every source file executes directly under `node --experimental-strip-types` —
no enums, no parameter properties, nothing that survives type erasure.

### Playing it

`npm run dev`, then open <http://localhost:5173/> and pick a name and a partner.
**[PLAYING.md](PLAYING.md)** has the full setup, troubleshooting and tips.

| | |
|---|---|
| **W A S D** | move (camera-relative) · **Shift** sprint · **Space** ride |
| drag | look around |
| **E** | battle the nearest wild Pokémon |
| **Tab** | team, bag, Pokédex and save |
| **T / R / F / Q** | advance an hour · cycle weather · fly camera · quality |

In a battle: arrow keys or W/A/S/D to move the cursor, Enter to choose, Esc to
back out. A Z-Move opens a short timing minigame — perform the pose.

The world keeps running while you fight. The sun still moves, the sea still
runs, and the other Pokémon on the hillside carry on with whatever they were
doing.

`/models.html` on the same server shows every Pokémon model on a turntable
(`?walk` to see them move, `?players=6` for character-creator variety).

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

### How it looks
- **A model for every one of the 53 species**, built in code from ellipsoids,
  tapered limbs and extruded shapes: Pikachu's ears and lightning tail, Rowlet's
  leaf bow tie, Lapras's shell, the Tapus' shells, Solgaleo's mane. Toon-shaded
  with a rim light and an ink outline, sized from each species' real height, in
  two levels of detail (~2,300 and ~610 triangles).
- **Animated in the vertex shader**: legs walk, wings flap, tails sway, heads
  look around, and the pace follows how fast the simulation says each one is
  moving. In battle the attacker lunges, the target flinches and a fainted
  Pokémon collapses.
- **The player is built from the character creator** — skin, hair, eyes, body
  type, height and every clothing item — and rides Lapras on water and Tauros on
  land.
- **Instanced**: every visible Pokémon of one species is one draw call, so 36 on
  screen cost 5.
- **Replaceable without code.** Drop a `.glb` into `apps/client/public/models/`
  and list it in `manifest.json` to replace any species or the player —
  [instructions](apps/client/public/models/README.md).

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

### Playing
- **A real game loop.** Name yourself, choose a partner, explore, engage what
  you find, catch it, level your team, save, reload.
- **No encounter screens.** The prompt appears when something engageable is in
  range; the battle stages on the ground you are standing on and the camera
  eases across rather than cutting.
- **Predators engage you.** An aggressive, territorial, apex or protective
  species that has decided to hunt starts the fight itself — and an apex
  predator or a provoked Bewear cannot be run from.
- **Movesets are derived**, not authored: from the species' types, its better
  attacking stat, and a power cap by level. Deterministic, so a wild Pokémon
  met twice has the same moves.
- **Catching** with ball and status multipliers, where Dusk and Net Balls only
  earn theirs under the right conditions, and the shake count is derived from
  the same probability as the result.
- **Versioned saves to localStorage** with autosave, migration on load, and
  backup recovery — never mid-battle, because that restores into a broken state.

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

Twelve packages under `packages/`, with one rule that shapes everything: **no
package below the presentation boundary may import Three.js, the DOM or Node.**
`core`, `data`, `world`, `ai`, `battle`, `game`, `quest`, `save`, `net` and
`audio` are pure simulation; only `render`, `ui` and the apps above them touch a
renderer.
That is why the same code runs in a browser, on a headless server and inside
`node --test`, and why 553 tests need no browser. See
[`docs/01-architecture.md`](docs/01-architecture.md).

```
packages/
  core     deterministic RNG, noise, ECS, scheduler, clock, spatial hash
  data     species, moves, Z-Moves, biomes, islands, spawns, items, quests
  world    terrain, streaming, biomes, weather, time of day, ocean, ecology
  ai       perception, utility scoring, behaviour trees, memory, flocking
  battle   damage, engine, Totems, Z-Move cinematics, arenas, trainer AI
  game     movesets, party, bag, encounters, capture, battle sessions, profile
  quest    objective graphs, branching, reputation
  save     schema, migrations, atomic commit
  net      protocol, interest management, prediction, interpolation
  audio    music director, ambience, stingers
  render   terrain meshes, far terrain, shaders, creature models, camera, quality
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

**Frame rate in this container measures nothing useful.** There is no GPU, so
Chromium falls back to SwiftShader. Hiding the 159 terrain meshes — changing
nothing else — took the same scene from **2.3 FPS to 36.3 FPS**, which locates
the cost exactly: software rasterisation, not the game.

So: **no claim of 60 FPS on measured hardware appears anywhere in this
repository**, because no such hardware was available. What decides whether a
frame is late on real hardware is main-thread time, and that *can* be measured
here. The client profiles it per phase; running at 28m per frame (far faster
than any mount, so streaming has to keep up), in milliseconds, p50 / p95 / worst:

| | standing | moving |
|---|---|---|
| Before | 6.4 / 10.4 / 12.5 | 10.4 / 33.8 / **50.4** |
| Now, with real models (range over 3 runs) | 2.9–3.5 / 6.3–10.0 / 8.4–13.0 | 2.4–2.7 / 6.3–7.7 / **11.7–12.5** |

Terrain meshing moved onto a Worker pool; the sky is drawn last so it shades only
uncovered pixels; zero-copy vertex buffers; every Pokémon model and shader is
prepared behind the loading screen instead of mid-game. Earlier work on the
world itself:

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
npm test                 553 passing   core 44 · data 42 · world 69 · ai 66
                                       battle 63 · game 74 · quest 18 · save 18
                                       net 29 · audio 17 · render 81 · ui 32
npm run typecheck        clean
npm run validate:content referential integrity across every content table
npm run sim              long-run stability, no NaN, no runaway populations
node --experimental-strip-types apps/server/src/main.ts --selftest
                         boots the world headless and asserts wildlife spawned
```

The game was additionally played end to end in a real browser (Playwright +
SwiftShader), with **zero page errors**:

```
boot completes                      ok
new-game screen appears             ok — Rowlet / Litten / Popplio
choose Litten and begin             ok
the party HUD shows the starter     ok — Litten
teleport next to a wild Pokemon     ok — GRUBBIN lv4 (40 loaded)
the engage prompt shows             ok — E  battle the wild Grubbin (Lv 8)
press E to start a battle           ok — battle
battle UI is populated              ok — Fight/Bag/Pokémon/Run · arena tropical-forest/foliage
the move list shows real moves      ok — Ember, Razor Leaf, Tackle, Quick Attack
fight a full battle to a conclusion ok — won
the battle changed the profile      ok — exp 1136, hp 30/30, dex 2 seen
catch a Pokemon with a Master Ball  ok — caught, now 2 Pokemon
open the menu with Tab              ok — Verifier · ₽3,000 · dex 2/2
save the game                       ok — Saved. Verifier · ₽3,000 · dex 2
the save is really in localStorage   ok — v4, 2 in party, 2.7 KB
reload and confirm the save loads   ok — Verifier, 2 Pokemon: LITTEN, GRUBBIN
```

---

## Documentation

| | |
|---|---|
| [Index](docs/README.md) | All documents, with reading orders |
| [Vision](docs/00-vision.md) | What this game is and what it is for |
| [Architecture](docs/01-architecture.md) | The presentation boundary and why it holds |
| [World design bible](docs/20-world-design-bible.md) | All five islands, POI by POI |
| [The game layer](docs/21-game-layer.md) | Movesets, encounters, capture, saving — what turns the simulation into a game |
| [Code examples](docs/17-code-examples.md) | 22 real excerpts, with the reasoning behind each |
| [Roadmap](docs/production/18-roadmap.md) · [Milestones](docs/production/19-milestones.md) | Production plan |
| [TDDs](docs/README.md#technical-design-documents) | Determinism, terrain, ocean, ECS, battle, netcode, performance |

---

## Status

Playable end to end — verified in a real browser: start a run, engage a wild
Pokémon, fight it to a conclusion, catch one, save, reload, and the save comes
back. Zero page errors.

It is still a vertical slice. Each document's **Not done** section is accurate
and specific, and the headline gaps are: no transport layer under the netcode,
no GPU profiling, no occlusion culling, **no authored art** (every Pokémon and
the player is a procedural model built in code; no foliage meshes yet), ability
and move-effect coverage in battle is partial, and the
trials, Totem bosses and quest content exist as tested systems without an
authored campaign in front of them. What exists, works, is tested, and is
honest about its edges.

*Not affiliated with or endorsed by Nintendo, Game Freak or The Pokémon Company.
A technical and design exercise.*
