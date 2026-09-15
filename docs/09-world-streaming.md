# World Streaming Architecture

**Document owner:** Optimization Engineer
**Status:** Implemented. Numbers in this document are measured, not estimated.

---

## 1. The requirement

"No loading screens between major areas" over a 40km × 30km archipelago.

That is not a rendering problem. It is a *memory and scheduling* problem: the
world is far larger than RAM, so the question is what exists at any moment, and
how work to create it is spread across frames so the player never sees a hitch.

## 2. The property everything depends on

> **Terrain height is a pure function of `(worldSeed, x, z)`.**

```ts
sampleHeight(x: number, z: number): number
```

No stored heightmap, no mutable state, no ordering requirement. This single
property buys:

- Chunks generate on **any thread, in any order, at any LOD**.
- An unloaded chunk costs **nothing** to remember — it regenerates
  byte-identically.
- The **server and every client agree on the ground** without syncing it.
- Collision can be evaluated **analytically at a point**, with no mesh.

Everything below is an application of that property.

## 3. Chunks

**256m square.** Small enough that one is cheap to build; large enough that the
player crosses one about every 45 seconds at running speed, so the load cadence
is gentle rather than constant.

Chunk coordinates pack into a single integer key:

```ts
export function chunkKey(cx: number, cz: number): ChunkKey {
  return ((cx & 0xffff) << 16) | (cz & 0xffff);
}
```

±32,767 chunks is ±8,388km — far more than needed — and integer keys make the
loaded-chunk map materially faster than string keys at this call frequency.

## 4. LOD rings

| LOD | Radius | Resolution | Vertex spacing |
|---|---|---|---|
| 0 | 400m | 128² | 2m |
| 1 | 900m | 64² | 4m |
| 2 | 1800m | 32² | 8m |
| 3 | 3600m | 16² | 16m |

A chunk's LOD is a pure function of its distance, so there is no hysteresis
bookkeeping — but transitions *are* hysteretic in time:

```ts
lodFor(distance: number, currentLod = -1): number {
  for (let i = 0; i < LOD_RADII.length; i++) {
    let radius = LOD_RADII[i];
    if (currentLod === i) radius *= 1.08;   // widen the ring we are in
    if (distance <= radius) return i;
  }
  return MAX_LOD;
}
```

Without the 8% widening, a chunk sitting on a ring boundary rebuilds every
frame as the player's position jitters.

### The 3.6km cutoff — a correction, with numbers

An earlier build streamed to 8km so distant islands stayed visible. Ring area
grows with the square of radius:

| Ring | Range | Area | Chunks |
|---|---|---|---|
| 0 | 0–400m | 0.5 km² | 8 |
| 1 | 400–900m | 2.0 km² | 31 |
| 2 | 900–1800m | 7.6 km² | 116 |
| 3 | 1800–3600m | 30.5 km² | 466 |
| **4** | **3600–8000m** | **160.3 km²** | **2,447** |
| | | | **3,068** |

**Ring 4 alone was 80% of all loaded chunks**, spent on terrain occupying a
handful of pixels. That is inherent to chunked streaming and cannot be tuned
away.

The fix is what open-world engines actually do: stop chunk streaming at 3.6km
and render everything beyond as **one coarse mesh per island**.

| | Before | After |
|---|---|---|
| Loaded chunks | ~3,068 | **621** |
| Distant terrain | 2,447 chunks | **5 draw calls** |
| Far-terrain cost | — | 122k vertices, 242k triangles, built once |

Distant islands are still visible — the opening vista shows Akala, Ula'ula and
Mount Lanakila's snowline from Melemele's eastern shore. They simply no longer
cost anything to be there.

**A regression this introduced, and the invariant that prevents it recurring:**
`MAX_LOD` was derived from `LOD_RESOLUTIONS` (5 entries) while `LOD_RADII` now
had 4. The radius lookup returned `undefined`, `chunkRadius` became `NaN`, and
streaming silently stopped entirely. Nothing threw. The headless simulation
caught it by reporting zero chunks built.

```ts
if (LOD_RESOLUTIONS.length !== LOD_RADII.length) {
  throw new Error(`LOD table mismatch: ${LOD_RESOLUTIONS.length} resolutions ` +
                  `but ${LOD_RADII.length} radii.`);
}
```

## 5. Cracks, and why we use skirts

Adjacent chunks at different LODs have mismatched vertex densities along their
shared edge, leaving gaps you can see the sky through.

**Stitching** (generating transition geometry) requires knowing the neighbours'
LODs, which reintroduces exactly the inter-chunk dependency that makes
independent, any-order generation possible.

**Skirts** hang a vertical ring of geometry down from each chunk's border. The
crack still exists; it is simply behind geometry. It costs one extra vertex
ring and preserves independence completely.

Skirt vertices copy the surface normal from the edge they hang from — a
downward normal reads as a black band.

## 6. The budgeted work queue

The streamer never builds more than a set number of chunks per frame, and
prioritises by distance:

```ts
this.buildQueue.sort((a, b) => a.distance - b.distance);
while (this.buildQueue.length > 0 && built < this.buildsPerTick) { ... }
```

Nearest-first is the ordering that matters most: the ground under the player's
feet must never be what we defer. Falling behind shows as distant terrain
arriving slightly late — never as a frame hitch.

### The per-tick vs per-frame bug

Originally the streamer was called from inside the fixed-step simulation, with
a budget of "2 builds per tick". The clock runs up to **four** catch-up steps
per frame, so the real cost was up to **eight synchronous chunk builds in one
frame**.

At the time a LOD0 chunk cost 225ms. Eight of them is 1.8 seconds.

```ts
// Streaming runs once per RENDERED frame, never inside the fixed-step loop.
function updateStreaming(frameDt: number): void {
  streamer.setObservers([{ x: player.position.x, z: player.position.z }]);
  streamer.update(simTime, buildChunk, disposeChunk);
}
```

**The general rule: a budget that exists to protect frame time must be enforced
per frame.**

## 7. Making chunk generation cheap

Two measured optimisations took `terrain.sample()` from 13.5µs to 6.15µs and
removed four fifths of the mesher's terrain cost.

### 7.1 Reject before doing noise work

`sampleHeight` tests every island, and each test evaluated a 4-octave fBm
coastline warp. Since at most one island is ever near a given point, that was
four wasted fBm evaluations per sample:

```ts
// The coast warp can extend the radius by at most COAST_WARP, so anything
// beyond that bound is definitively ocean.
const maxRadius = island.radius * (1 + COAST_WARP);
if (distSq >= maxRadius * maxRadius) return 0;
```

### 7.2 Derive normals from the grid, not from extra samples

`terrain.sample()` spends **five** height evaluations estimating a normal by
finite differences. A mesher walking a regular grid already knows its
neighbours' heights.

The mesher now fills a height grid with a one-cell border, then derives normals
from central differences over it:

```ts
let nx = heightAt(ix - 1, iz) - heightAt(ix + 1, iz);
let ny = 2 * step;
let nz = heightAt(ix, iz - 1) - heightAt(ix, iz + 1);
// ...normalise, then:
const sample = terrain.sampleFrom(x, z, height, nx, ny, nz);
```

Heights become the only per-vertex terrain cost.

## 8. Unloading

A chunk is unloaded when it is past the outermost ring *plus* a hysteresis
margin (two chunk widths) *and* no observer has needed it for a grace period
(8 seconds). Both conditions matter: the margin stops a chunk unloading and
immediately reloading as the player paces a boundary; the grace period covers
a player who doubles back.

Unloads are also budgeted per frame, because disposing 400 meshes at once is
as bad a hitch as building them.

`clear()` exists for fast travel, where incremental streaming would thrash: a
hard reset and rebuild around the destination is both faster and simpler than
migrating a working set across 10km.

## 9. Multiple observers

`setObservers` takes a list. Split-screen, spectated players and in-flight
cameras all add observers, and a chunk is kept if *any* observer needs it. This
is also what the server uses to decide what to simulate.

## 10. Measured results

From the headless harness (6 in-game hours, 208 agents, observer walking a
400m circle):

| Metric | Value |
|---|---|
| Loaded chunks | 713 |
| Chunks built over the run | 1,877 |
| AI cost | 0.068ms/tick for 208 agents |
| Peak AI tick | 3.1ms (was 26.5ms before staggering) |
| NaN positions | 0 |

From the browser (SwiftShader, no GPU):

| Metric | Value |
|---|---|
| `terrain.sample` | 6.15µs (was 13.5µs) |
| Far terrain build | 1.5s once at boot, 5 draw calls |
| JS simulation | 0.01ms/tick for 41 agents |

**A caveat stated plainly:** this container has no GPU. SwiftShader is a CPU
rasteriser, and the browser frame rate measured here (2–3 fps at 640×480) is a
property of that, not of the game — hiding terrain meshes took it from 2.3 to
36.3 fps while JavaScript cost 0.01ms. Real frame-rate targets require real
hardware and are not claimed here.

## 11. What is not built

- **Worker offload.** Chunk generation takes `(seed, cx, cz, lod)` and returns
  buffers, so it transfers cleanly. Not yet done; it is the single highest-value
  remaining optimisation.
- **Chunk merging.** 621 chunks is 621 draw calls. Merging same-LOD neighbours
  into larger batches would cut that substantially.
- **Interior streaming.** Buildings and caves are currently part of the
  heightfield. Real interiors need a separate volume system.
- **Baked far terrain.** Built at runtime in 1.5s; it should be baked offline
  by the content pipeline.
