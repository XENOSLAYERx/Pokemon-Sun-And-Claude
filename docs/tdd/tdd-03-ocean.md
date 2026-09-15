# TDD-03 — Ocean Simulation

**Author:** Technical Artist
**Status:** Implemented in `packages/world/src/ocean/gerstner.ts` and the ocean
shader.

---

## Requirement

The player crosses open water between every island, on a Lapras or a Sharpedo.
The ocean must therefore be both convincing to look at **and queryable**: a ride
Pokémon sits on the surface, and the height it sits at must match the surface
the player sees.

## Design: Gerstner waves, evaluated identically on CPU and GPU

A sum of trochoidal waves. Unlike a sine heightfield, Gerstner waves displace
**horizontally as well as vertically**, producing sharp crests and broad
troughs — the characteristic silhouette of real ocean.

```
x' = x + Σ Qᵢ Aᵢ Dᵢ.x cos(fᵢ)
z' = z + Σ Qᵢ Aᵢ Dᵢ.z cos(fᵢ)
y' = Σ Aᵢ sin(fᵢ)

where fᵢ = kᵢ(Dᵢ · P) − ωᵢ t + φᵢ,  kᵢ = 2π/Lᵢ,  ωᵢ = √(g·kᵢ)
```

**The dispersion relation is real.** Phase speed is `√(gL/2π)`, so long swells
visibly outrun short chop. That single detail is most of what makes an ocean
read as ocean rather than as a moving texture.

The vertex shader and `OceanSimulation` evaluate the same sum from the same
uniform array, so the visible surface and the surface a Lapras floats on cannot
disagree.

## Inverting the displacement

Because Gerstner waves displace horizontally, `heightAt(x, z)` is not simply
`y(x, z)` — the surface point above `(x, z)` originated somewhere else.

Two fixed-point iterations converge to well under a centimetre for our steepness
range:

```ts
for (let iter = 0; iter < 2; iter++) {
  this.displace(sx, sz, tmp);
  sx += x - tmp.x;      // correct by the error in the displaced result
  sz += z - tmp.z;
}
```

Far cheaper than a proper solve and more than accurate enough to float on.

## Sea state from wind

```ts
const seaState = clamp01(this.windSpeed / 25);
const baseAmplitude = lerp(0.08, 1.6, seaState * seaState) * this.scale;
const baseWavelength = lerp(9, 62, seaState);
```

Amplitude scales with roughly the square of wind speed, matching developed
seas. Forcing a thunderstorm in the client takes significant wave height from
0.66m to 5.58m — which the player feels, because buoyancy pitches their mount.

Wavelengths follow a geometric series so components never beat into a visible
repeating pattern, and directions fan around the wind vector with the widest
spread on the shortest waves. Real seas are directional but not aligned.

Direction offsets are **deterministic, not random**, so the ocean is identical
everywhere without needing to sync a seed.

## Buoyancy

```ts
buoyancyAt(x, z, length): { height, pitch, roll }
```

Samples four points around the body and derives pitch and roll from the
differences. A Lapras genuinely rides the swell rather than sliding along a
height value.

## Shading

- **Schlick Fresnel.** Water is nearly opaque at grazing angles and nearly
  transparent looking down. Getting this right is most of what makes water look
  like water, and it drives both reflection blend and alpha.
- **Depth tint.** Shallow reef water differs from open ocean, which is what
  makes a coastline legible from the air.
- **Foam** on crests and steep faces, scrolled by the displacement field.
- **Subsurface approximation** — light through a wave crest when looking toward
  the sun.

## Verification

- Long waves travel faster than short ones (dispersion).
- Height queries finite and bounded by the spectrum over 300 timesteps.
- Deterministic for a given time.
- Storm sea state > 3× calm.
- Normals unit length and upward.
- Buoyancy pitch and roll within plausible bounds.
- Shader asserted to contain the same dispersion relation and wavenumber as the
  CPU path.

## Not done

- **Shoreline interaction.** No depth-based wave steepening or breaking; waves
  pass through the shore unchanged.
- **Wakes.** No displacement from moving bodies.
- **Underwater rendering.** The material switches but there is no volumetric
  scattering, caustics or god rays.
