# TDD-07 — Performance, Scalability and the Frame Budget

**Author:** Optimization Engineer
**Status:** Implemented in `packages/render/src/pipeline/quality.ts`,
`packages/world/src/streaming/chunks.ts`, `packages/ai/src/ecosystem/brain.ts`.
Measurements taken from this repository.

---

## Requirement

60 FPS on mid-range hardware, and a Steam Deck target of 60 FPS at 1280×800,
while simulating a living archipelago with hundreds of Pokémon behaving
individually.

## Where the time actually goes

The single most useful thing this project established is **which half of the
problem is expensive**. It is not the half people assume.

```
AI cost per tick (headless harness, tools/gen/headless-sim.ts)
  mean           0.068ms for 208 agents
  peak           3.085ms
  per agent      0.33µs
```

That block is one run. Across six runs of the harness the mean sits between
**0.060ms and 0.068ms** (0.29–0.33µs per agent); the figure quoted throughout
these documents is the slowest of them, so nothing here is flattered by a
lucky run.

At 0.33µs per agent, the entire utility-AI, perception, memory and flocking
stack for 208 Pokémon costs **0.4% of a 16.6ms frame**. Simulation is
effectively free. Rendering is the entire budget.

This has a direct design consequence, encoded in the presets: **even the lowest
graphics preset keeps full AI.** Degrading Pokémon behaviour to gain frames
would trade away the thing that makes the world feel alive in exchange for
almost nothing.

## The measured rendering ceiling in this environment

Honest statement, because the alternative is a claim that cannot be reproduced:
the browser client in this container runs at **2–3 FPS**, and that is
SwiftShader software rasterisation in a GPU-less environment, not a simulation
cost.

The proof is direct — hiding the 159 terrain meshes and changing nothing else:

| State | FPS |
|-------|-----|
| Terrain visible | 2.3 |
| Terrain hidden | 36.3 |

Same simulation, same entity count, same AI, 16× the frame rate. The cost is
fragment and vertex throughput on a software rasteriser. On real hardware this
geometry is unremarkable; in this container it is fatal. No performance number
in this repository claims 60 FPS on measured hardware, because none was
measured on hardware.

## Optimisations actually applied and measured

### 1. Streaming radius cap + far terrain

Originally the streamer loaded chunks to the horizon: **3,068 chunks**. Capping
streaming at 3.6km and rendering everything beyond it as a single far-terrain
mesh took that to **621 chunks — an 80% reduction**.

```ts
const LOD_RADII       = [400, 900, 1800, 3600];
const LOD_RESOLUTIONS = [128,  64,   32,   16];
const FAR_TERRAIN_RADIUS = 20000;
```

Far terrain: **5 draw calls, 242k triangles, 122,503 vertices, 1.5s to build,
once**. The horizon is still there; it just stopped costing 2,400 chunk
objects.

A runtime invariant now throws if `LOD_RADII` and `LOD_RESOLUTIONS` disagree in
length. That check exists because they did disagree during development, and the
streamer's response was to silently build **zero** chunks — a blank world with
no error.

### 2. Terrain sampling: 13.5µs → 6.15µs per sample

Two changes, both in `packages/world/src/terrain/generator.ts`:

- **Coast-warp early-out.** A sample provably outside every island's warped
  radius returns 0 without evaluating a single octave of noise:
  ```ts
  const maxRadius = island.radius * (1 + COAST_WARP);
  if (distSq >= maxRadius * maxRadius) return 0;
  ```
  Most of a 20km ocean is outside every island.
- **Grid-derived normals.** Normals come from neighbouring grid heights already
  being computed, instead of four extra `sample()` calls per vertex.

Terrain sampling is called for every vertex of every chunk at every LOD, so
halving it halves chunk build time.

### 3. Four-tier simulation LOD

```
Full     — every tick, full perception, full utility scoring
Reduced  — every 4th tick, cheaper perception
Coarse   — every 16th tick, goal held, movement integrated only
Dormant  — statistical only; position advanced along a path, no decisions
```

Plus a **per-agent tick stagger** derived from entity id, so the agents in a
tier do not all evaluate on the same frame. Without the stagger, a Reduced tier
of 400 agents produces a 4-frame sawtooth: three cheap frames and one spike.
With it, the cost is flat.

### 4. Temporal hysteresis on LOD transitions

Ring boundaries widen by **8%** when unloading. A player walking a boundary
would otherwise thrash a chunk between two LODs every few frames, each
transition costing a rebuild.

### 5. Skirts, not stitching

Adjacent chunks at different LODs leave visible seams. The standard fix is
stitching the boundary vertices, which couples a chunk's mesh to its
neighbours' LODs — so a neighbour changing LOD forces a rebuild. Instead each
chunk drops a vertical skirt at its border. Chunks stay independent, cracks are
hidden, and a rebuild never cascades.

### 6. Per-frame, not per-tick, streaming budget

The streaming update ran inside the fixed 60Hz tick loop. With up to 5 catch-up
ticks per frame and 2 chunk builds each, a single frame could attempt **8 chunk
builds at ~225ms each**. Streaming now runs exactly once per rendered frame:

```ts
function updateStreaming(frameDt: number): void {
  streamer.setObservers([{ x: player.position.x, z: player.position.z }]);
  streamer.update(simTime, buildChunk, disposeChunk);
}
```

## Quality presets

Five presets in `packages/render/src/pipeline/quality.ts`:

| | potato | low | medium (Deck) | high | ultra |
|---|---|---|---|---|---|
| pixel ratio | 0.5 | 1 | 1 | 1.5 | 2 |
| render scale | 0.5 | 0.75 | 1 | 1 | 1 |
| shadows | off | 1024 | 1536 | 2048 | 4096 |
| draw distance | ×0.25 | ×0.5 | ×0.75 | ×1 | ×1.35 |
| chunk builds/frame | 1 | 1 | 2 | 2 | 3 |
| foliage density | 0 | 0.35 | 0.6 | 1 | 1.5 |
| max visible Pokémon | 40 | 80 | 140 | 220 | 320 |
| cloud raymarch steps | 0 | 8 | 16 | 24 | 40 |
| ocean tessellation | 24 | 64 | 128 | 192 | 256 |
| Gerstner waves | 3 | 4 | 5 | 6 | 8 |
| triplanar terrain | no | no | yes | yes | yes |
| bloom / motion blur / AO | – | – | bloom | all | all |

`potato` is explicitly **not a shipping preset**. It is a safety net so the game
is inspectable in a CI container or a VM instead of hanging at one frame every
two seconds — which is exactly the situation this repository's verification runs
in.

`detectQuality()` reads the WebGL renderer string and matches SwiftShader,
llvmpipe and Mesa's software paths, starting at `potato` when it finds one.
`AdaptiveQuality` watches frame time and steps down when the game is
persistently below target, firing `onChange` so the client can rebuild
resources — and stops adapting the moment the player picks a preset explicitly,
because a settings screen that silently overrides the player is worse than no
settings screen.

## Instancing

Foliage and small props render through `packages/render/src/instancing/scatter.ts`
with per-chunk instance budgets scaled by `foliageDensity`. Scatter positions
are derived from the terrain function and the chunk seed, so they are stable
across reloads and need no storage.

## Verification

- Headless harness (`npm run sim`) reports per-tick AI cost, population
  stability and NaN checks over long runs:
  `✓ All systems stable. No NaN, no deadlock, no runaway populations.`
- Browser verification via Playwright + SwiftShader: zero page errors, 430
  chunks resident, 40 Pokémon with distinct active goals, weather driving
  significant wave height from 0.66m to 5.58m.
- `packages/render/test/render.test.ts` asserts preset monotonicity (every
  budget is non-decreasing across `QUALITY_ORDER`), software-renderer
  detection, and that `AdaptiveQuality` stops on explicit player choice.
- Streaming tests assert chunk counts per ring, hysteresis behaviour, and the
  LOD table-length invariant.

## Not done

- **No GPU profiling.** There was no GPU. Draw call counts, triangle counts and
  vertex counts are real; milliseconds-per-pass are not measured.
- **No occlusion culling.** Frustum culling only. A valley wall does not cull
  what is behind it.
- **No texture streaming or mesh LOD for Pokémon.** Terrain has LODs; creatures
  do not.
- **No memory budget enforcement.** Chunk disposal is correct, but there is no
  hard cap that evicts under pressure.
