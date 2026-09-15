# TDD-02 — Terrain Generation

**Author:** Technical Artist + Optimization Engineer
**Status:** Implemented in `packages/world/src/terrain/generator.ts`.

---

## Requirement

A 40km × 30km archipelago, streamable with no loading screens, with authored
landmarks in specific places.

The tension: fully procedural terrain cannot guarantee Mount Lanakila is where
the story says it is. Fully authored terrain at this scale is unaffordable and
unstreamable.

## Design: authored features composited into procedural terrain

Height is a pure function of `(worldSeed, x, z)`, composed in a deliberate
order:

```
1. Island mask       where is there land at all?
2. Base elevation    the island's bulk
3. Authored features volcanoes, ridges, canyons, plateaus, town flats
4. Detail noise      fBm, scaled by slope so beaches stay flat
5. Erosion pass      analytic approximation, softens convex ridges
6. Land floor        no feature may flood an island interior
7. Sea-level clamp   shelf and abyss
```

### Island masks are domain-warped

A circular falloff produces circular islands. The effective radius is warped by
low-frequency noise sampled around the island's angular coordinate, producing
peninsulas and bays:

```ts
const angle = Math.atan2(dz, dx);
const coastNoise = fbm2D(this.warpNoise, Math.cos(angle) * 2.2, Math.sin(angle) * 2.2, ...);
const effectiveRadius = island.radius * (1 + coastNoise * COAST_WARP);
```

### Feature types

| Kind | Profile | Used for |
|---|---|---|
| `cone` | Radial falloff, ridged gullies on the flanks | Volcanoes, peaks |
| `ridge` | Distance to a segment, ridged crest | Mountain spines |
| `canyon` | Segment with steep walls, flat floor | Vast Poni Canyon |
| `plateau` | Low falloff exponent — flat top, steep sides | Shrine platforms |
| `basin` | Smooth depression | Calderas, lakebeds |
| `dune` | Billow noise | Haina Desert |
| `flat` | **Levels** terrain rather than adding height | Towns |

`flat` is the interesting one: towns need genuinely buildable ground, so it
blends the height toward a target rather than contributing to it. Verified by
test — max slope under a town is below 0.5 rad over a 160m square.

### The land floor

```ts
if (landMask > 0.35 && height < MIN_LAND_HEIGHT) {
  const forced = this.forcedBiomeAt(island, x, z);
  if (forced === null || !WATER_BIOMES.has(forced)) {
    height = lerp(height, MIN_LAND_HEIGHT, (landMask - 0.35) / 0.65);
  }
}
```

Added because Vast Poni Canyon cut the island interior to −286m and flooded it.
A feature may only go below sea level if it explicitly declares a water biome,
which is how genuine lakes and rivers opt out.

### Exaggerated lapse rate

```ts
lapseRate: 0.016,   // real atmospheric value is ~0.0065
```

At the true rate, Lanakila's 2,050m summit sits near 11°C and never reads as a
snowline. Altitude has to be legible as a climate band a player can see from the
ground; that is worth more here than meteorological accuracy, and the comment in
the source says so.

## Performance

Two measured optimisations, both in response to profiling a 225ms LOD0 chunk.

**Reject before doing noise work.** `sampleHeight` tests every island, and each
test evaluated a 4-octave fBm coast warp. Since at most one island is ever near
a point, four of those were wasted:

```ts
const maxRadius = island.radius * (1 + COAST_WARP);
if (distSq >= maxRadius * maxRadius) return 0;
```

13.5µs → 6.15µs per sample.

**Derive normals from the grid.** `sample()` spends five height evaluations on
finite differences. A mesher walking a regular grid already knows its
neighbours, so `sampleFrom()` accepts a precomputed height and normal.

## Verification

- Determinism across generators; divergence across seeds.
- Every island centre above sea level.
- Mount Lanakila exceeds 1,200m and is the highest cone in the archipelago.
- Town ground max slope < 0.5 rad.
- Normals unit length, always pointing up on land.
- Temperature falls with altitude; the summit is below 5°C.
- Open ocean beyond the shelf is below −100m.

## Not done

- **Hydraulic erosion.** The analytic approximation is coherent but not
  physically derived. Real erosion is a multi-pass simulation that should be
  baked offline and sampled at runtime.
- **Caves.** 3D noise carving is written in the noise library but not wired;
  caves are currently authored `basin` features with a forced biome.
- **Rivers.** No flow simulation. River biomes exist but are placed by hand.
