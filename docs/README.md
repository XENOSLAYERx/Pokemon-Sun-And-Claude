# Project Alola — Documentation Index

An open-world 3D reimagining of Alola: a deterministic headless simulation core
with a Three.js presentation layer on top, eleven packages, a runnable client,
an authoritative server, and a content pipeline that refuses to ship broken
data.

Everything in these documents describes code that exists in this repository.
Where a system is partially built, the document says so in its **Not done**
section rather than describing the intention as if it were the implementation.

---

## The twenty deliverables

| # | Deliverable | Document |
|---|-------------|----------|
| — | Creative pillars and what this game is | [`00-vision.md`](00-vision.md) |
| 1 | **Full game architecture** | [`01-architecture.md`](01-architecture.md) |
| 2 | **Folder structure** | [`02-folder-structure.md`](02-folder-structure.md) |
| 3 | **Database structure** | [`03-database-schema.md`](03-database-schema.md) |
| 4 | **AI architecture** | [`04-ai-architecture.md`](04-ai-architecture.md) |
| 5 | **Combat architecture** | [`05-combat-architecture.md`](05-combat-architecture.md) |
| 6 | **UI architecture** | [`06-ui-architecture.md`](06-ui-architecture.md) |
| 7 | **Save system** | [`07-save-system.md`](07-save-system.md) |
| 8 | **Multiplayer architecture** | [`08-multiplayer-architecture.md`](08-multiplayer-architecture.md) |
| 9 | **World streaming architecture** | [`09-world-streaming.md`](09-world-streaming.md) |
| 10 | **Quest architecture** | [`10-quest-architecture.md`](10-quest-architecture.md) |
| 11 | **Pokémon spawning architecture** | [`11-spawning-architecture.md`](11-spawning-architecture.md) |
| 12 | **Weather architecture** | [`12-weather-architecture.md`](12-weather-architecture.md) |
| 13 | **Economy architecture** | [`13-economy-architecture.md`](13-economy-architecture.md) |
| 14 | **Content pipeline** | [`14-content-pipeline.md`](14-content-pipeline.md) |
| 15 | **Art pipeline** | [`15-art-pipeline.md`](15-art-pipeline.md) |
| 16 | **Animation pipeline** | [`16-animation-pipeline.md`](16-animation-pipeline.md) |
| 17 | **Technical design documents** | [`tdd/`](#technical-design-documents) — seven documents |
| 18 | **Production roadmap** | [`production/18-roadmap.md`](production/18-roadmap.md) |
| 19 | **Milestones** | [`production/19-milestones.md`](production/19-milestones.md) |
| 20 | **Source code examples** | [`17-code-examples.md`](17-code-examples.md) |
| — | World design bible (all five islands, POI by POI) | [`20-world-design-bible.md`](20-world-design-bible.md) |
| — | **The game layer** — what turns the simulation into something you play | [`21-game-layer.md`](21-game-layer.md) |

## Technical design documents

Deep dives on the systems where the *how* matters more than the *what* — each
one written around a decision that had a wrong answer, and what the wrong
answer cost.

| Document | Subject |
|----------|---------|
| [`tdd-01-determinism.md`](tdd/tdd-01-determinism.md) | Seeded RNG, stream forking, and why determinism is a load-bearing feature rather than a nicety |
| [`tdd-02-terrain.md`](tdd/tdd-02-terrain.md) | Terrain as a pure function of `(seed, x, z)`, authored features composited on top |
| [`tdd-03-ocean.md`](tdd/tdd-03-ocean.md) | Gerstner waves with real deep-water dispersion, evaluated identically on CPU and GPU |
| [`tdd-04-ecs-scheduling.md`](tdd/tdd-04-ecs-scheduling.md) | Generational entity handles, sparse sets, deferred structural change, ten-phase scheduler |
| [`tdd-05-battle-determinism.md`](tdd/tdd-05-battle-determinism.md) | The battle engine as a pure function; why truncation order *is* the specification |
| [`tdd-06-netcode.md`](tdd/tdd-06-netcode.md) | Server authority, client prediction, banded interest management, lockstep battles |
| [`tdd-07-performance.md`](tdd/tdd-07-performance.md) | Where the frame actually goes, the optimisations that were measured, and the five quality presets |

---

## Reading orders

**"What is this game?"**
→ [`00-vision.md`](00-vision.md) → [`20-world-design-bible.md`](20-world-design-bible.md) → [`production/18-roadmap.md`](production/18-roadmap.md)

**"How is it built?"**
→ [`01-architecture.md`](01-architecture.md) → [`02-folder-structure.md`](02-folder-structure.md) → [`tdd/tdd-01-determinism.md`](tdd/tdd-01-determinism.md) → [`tdd/tdd-04-ecs-scheduling.md`](tdd/tdd-04-ecs-scheduling.md)

**"Show me the code."**
→ [`17-code-examples.md`](17-code-examples.md) — 22 real excerpts with the reasoning and the measurements behind each

**"How does it actually play?"**
→ [`21-game-layer.md`](21-game-layer.md) — movesets, encounters, capture, saving, and the presentation on top

**"How do the Pokémon behave?"**
→ [`04-ai-architecture.md`](04-ai-architecture.md) → [`11-spawning-architecture.md`](11-spawning-architecture.md) → [`12-weather-architecture.md`](12-weather-architecture.md)

**"How does a fight work?"**
→ [`05-combat-architecture.md`](05-combat-architecture.md) → [`tdd/tdd-05-battle-determinism.md`](tdd/tdd-05-battle-determinism.md)

**"Will it run?"**
→ [`tdd/tdd-07-performance.md`](tdd/tdd-07-performance.md) → [`09-world-streaming.md`](09-world-streaming.md)

---

## State of the repository

| | |
|---|---|
| Packages | 12 (`@alola/core` … `@alola/ui`) + client, server, tools |
| TypeScript | 27,609 lines across 99 files |
| Tests | **504 passing**, ~2s, no browser and no build step |
| Species | 53, with battle stats *and* overworld behaviour fields |
| Moves | 50, plus 14 Z-Moves with pose, camera beats and environment reactions |
| Biomes | 28, across 5 islands |
| Spawn table | 78 entries, weighted by biome, hour, weather and progression flags |
| Items | 45, with a coherent price curve |
| Trials / quests | 7 trials with Totem encounters · 11 quests · 10 reputation factions |
| World | 40km × 40km, streamed to 3.6km with far terrain to 20km |
| Playable | New game → explore → engage → battle → catch → save → reload, verified in a browser |

Per-package test counts: core 42 · data 42 · world 60 · ai 66 · battle 63 · game 74 ·
quest 18 · save 18 · net 29 · audio 17 · render 43 · ui 32.

## Running it

```bash
npm install
npm test                  # 504 tests, no browser required
npm run typecheck         # tsc --noEmit, strict, erasableSyntaxOnly
npm run validate:content  # referential integrity across every content table
npm run sim               # headless simulation harness with timings
npm run dev               # the browser client
npm run dev:server        # the authoritative server
```

No build step is required to run or test: `erasableSyntaxOnly` is on, so every
source file executes directly under `node --experimental-strip-types`.

## An honest note on performance

The browser client renders at 2–3 FPS **in this container**, because there is no
GPU and Chromium falls back to SwiftShader software rasterisation. Hiding the
terrain meshes takes the same scene from 2.3 to 36.3 FPS, which locates the cost
precisely: fragment and vertex throughput, not simulation.

Simulation cost was measured and is not the problem — 0.060–0.068ms per tick for
208 agents across six runs, 0.29–0.33µs per agent (documents quote the slower
end). No number anywhere in these documents claims 60 FPS on
measured hardware, because no hardware was available to measure.
[`tdd/tdd-07-performance.md`](tdd/tdd-07-performance.md) has the full breakdown.
