/**
 * Terrain generator.
 *
 * Height at any world point is a pure function of (worldSeed, x, z). That
 * single property is what makes the whole streaming architecture work:
 *
 *   - A chunk can be generated on any thread, in any order, at any LOD.
 *   - A chunk can be discarded and regenerated identically — no persistence.
 *   - The server and every client agree on the ground without syncing it.
 *   - Collision can be evaluated analytically at a point, without a mesh.
 *
 * Composition order matters and is deliberate:
 *   1. Island mask      — where is there land at all?
 *   2. Base elevation   — the island's bulk.
 *   3. Features         — volcanoes, ridges, canyons, plateaus (authored).
 *   4. Detail noise     — fBm roughness, scaled by slope so beaches stay flat.
 *   5. Erosion pass     — a cheap approximation that softens convex ridges.
 *   6. Sea-level clamp  — beaches and the shelf.
 */
import { SimplexNoise, fbm2D, ridged2D, billow2D, clamp, clamp01, smoothstep, lerp } from '@alola/core';
import { ISLANDS, type IslandDefinition, type TerrainFeature, type BiomeId } from '@alola/data';

export const SEA_LEVEL = 0;

/** Minimum elevation for the interior of a landmass, in metres. */
const MIN_LAND_HEIGHT = 4;

/** Biomes an authored feature can declare to legitimately sit below sea level. */
const WATER_BIOMES = new Set<BiomeId>(['lake', 'river', 'ocean', 'reef', 'deep-ocean']);

export interface TerrainSample {
  /** Height in metres relative to sea level. */
  height: number;
  /** Surface normal, unit length. */
  normalX: number;
  normalY: number;
  normalZ: number;
  /** Slope in radians, 0 = flat. */
  slope: number;
  /** Moisture 0–1 after orographic adjustment. */
  moisture: number;
  /** Temperature in °C at this altitude. */
  temperature: number;
  /** Island this point belongs to, or null for open ocean. */
  island: IslandDefinition | null;
  /** Biome override forced by an authored feature, if any. */
  forcedBiome: BiomeId | null;
}

/** Tuning constants, grouped so a technical artist can find them. */
export const TERRAIN_TUNING = {
  /** Metres of detail noise amplitude at full strength. */
  detailAmplitude: 26,
  /** Horizontal scale of the detail noise, in metres per noise unit. */
  detailScale: 420,
  /** Coastal shelf falloff distance, in metres. */
  shelfWidth: 600,
  /** Seafloor depth beyond the shelf. */
  abyssDepth: 260,
  /**
   * Temperature lapse rate: °C lost per metre of altitude.
   * The real atmospheric value is ~0.0065. We use roughly 2.5x that on
   * purpose: at the true rate, Mount Lanakila's 2050m summit sits near 11°C
   * and never reads as a snowline. Exaggerating it makes altitude legible as
   * a climate band the player can see from the ground, which is worth more
   * here than meteorological accuracy.
   */
  lapseRate: 0.016,
  /** How strongly altitude drains moisture. */
  orographicFactor: 0.00055,
  /** Finite-difference step for normal estimation, in metres. */
  normalEpsilon: 1.5,
} as const;

export class TerrainGenerator {
  private readonly baseNoise: SimplexNoise;
  private readonly detailNoise: SimplexNoise;
  private readonly warpNoise: SimplexNoise;
  private readonly moistureNoise: SimplexNoise;
  private readonly erosionNoise: SimplexNoise;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    // Distinct seeds per layer: sharing one would correlate moisture with
    // elevation and produce visible "wet ridges / dry valleys" banding.
    this.baseNoise = new SimplexNoise(seed);
    this.detailNoise = new SimplexNoise(seed + 1013);
    this.warpNoise = new SimplexNoise(seed + 2027);
    this.moistureNoise = new SimplexNoise(seed + 3041);
    this.erosionNoise = new SimplexNoise(seed + 4057);
  }

  /**
   * Island mask: 1 inside the landmass, falling to 0 at the shoreline.
   * The boundary is domain-warped so coastlines are ragged and bay-like
   * rather than circular.
   */
  private islandMask(island: IslandDefinition, x: number, z: number): number {
    const dx = x - island.centerX;
    const dz = z - island.centerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Warp the effective radius with low-frequency noise: peninsulas and bays.
    const angle = Math.atan2(dz, dx);
    const coastNoise = fbm2D(this.warpNoise, Math.cos(angle) * 2.2, Math.sin(angle) * 2.2, {
      octaves: 4,
      frequency: 1,
    });
    const effectiveRadius = island.radius * (1 + coastNoise * 0.22);

    if (dist >= effectiveRadius) return 0;

    // Smooth falloff over the outer 18% of the radius — this is the beach band.
    const t = dist / effectiveRadius;
    return 1 - smoothstep(0.82, 1.0, t);
  }

  /** Contribution of one authored feature at a point. */
  private featureHeight(f: TerrainFeature, island: IslandDefinition, x: number, z: number): number {
    const lx = x - island.centerX;
    const lz = z - island.centerZ;

    switch (f.kind) {
      case 'cone': {
        const d = Math.hypot(lx - f.x, lz - f.z);
        if (d >= f.radius) return 0;
        const t = 1 - d / f.radius;
        // Ridged noise on the flanks gives erosion gullies down the cone.
        const gully = ridged2D(this.baseNoise, x * 0.0025, z * 0.0025, { octaves: 4 });
        const profile = Math.pow(t, f.falloff ?? 1.8);
        return f.height * profile * (0.82 + gully * 0.18);
      }

      case 'ridge': {
        if (f.x2 === undefined || f.z2 === undefined) return 0;
        const d = distanceToSegment(lx, lz, f.x, f.z, f.x2, f.z2);
        if (d >= f.radius) return 0;
        const t = 1 - d / f.radius;
        const crest = ridged2D(this.baseNoise, x * 0.0018, z * 0.0018, { octaves: 5 });
        return f.height * Math.pow(t, f.falloff ?? 1.5) * (0.7 + crest * 0.3);
      }

      case 'canyon': {
        if (f.x2 === undefined || f.z2 === undefined) return 0;
        const d = distanceToSegment(lx, lz, f.x, f.z, f.x2, f.z2);
        if (d >= f.radius) return 0;
        // Steep-walled: most of the depth is reached quickly, then a flat floor.
        const t = 1 - d / f.radius;
        const wall = smoothstep(0, 0.45, t);
        const meander = fbm2D(this.warpNoise, x * 0.0008, z * 0.0008, { octaves: 3 }) * 0.15;
        return f.height * clamp01(wall + meander);
      }

      case 'plateau': {
        const d = Math.hypot(lx - f.x, lz - f.z);
        if (d >= f.radius) return 0;
        // Low falloff exponent => flat top, steep sides.
        const t = 1 - d / f.radius;
        return f.height * Math.pow(t, f.falloff ?? 0.6);
      }

      case 'basin': {
        const d = Math.hypot(lx - f.x, lz - f.z);
        if (d >= f.radius) return 0;
        const t = 1 - d / f.radius;
        return f.height * smoothstep(0, 0.7, t);
      }

      case 'dune': {
        const d = Math.hypot(lx - f.x, lz - f.z);
        if (d >= f.radius) return 0;
        const t = 1 - d / f.radius;
        const dunes = billow2D(this.baseNoise, x * 0.006, z * 0.006, { octaves: 3 });
        return f.height * t * dunes;
      }

      case 'flat': {
        // Flats don't add height; they *level* terrain. Handled in sampleHeight
        // via the flattening pass so towns sit on genuinely buildable ground.
        return 0;
      }

      default:
        return 0;
    }
  }

  /** Blend factor toward a level platform for 'flat' features (towns). */
  private flattenInfluence(island: IslandDefinition, x: number, z: number): { weight: number; target: number } {
    let weight = 0;
    let target = 0;
    const lx = x - island.centerX;
    const lz = z - island.centerZ;

    for (const f of island.features) {
      if (f.kind !== 'flat') continue;
      const d = Math.hypot(lx - f.x, lz - f.z);
      if (d >= f.radius) continue;
      // Full flattening in the middle, blending out over the outer 40%.
      const w = 1 - smoothstep(0.6, 1.0, d / f.radius);
      if (w > weight) {
        weight = w;
        target = f.height;
      }
    }
    return { weight, target };
  }

  /** Which authored feature, if any, forces a biome at this point? */
  forcedBiomeAt(island: IslandDefinition, x: number, z: number): BiomeId | null {
    const lx = x - island.centerX;
    const lz = z - island.centerZ;
    let best: BiomeId | null = null;
    let bestScore = 0;

    for (const f of island.features) {
      if (!f.biome) continue;
      let inside = 0;
      if (f.kind === 'ridge' || f.kind === 'canyon') {
        if (f.x2 === undefined || f.z2 === undefined) continue;
        const d = distanceToSegment(lx, lz, f.x, f.z, f.x2, f.z2);
        inside = d < f.radius ? 1 - d / f.radius : 0;
      } else {
        const d = Math.hypot(lx - f.x, lz - f.z);
        inside = d < f.radius ? 1 - d / f.radius : 0;
      }
      if (inside > bestScore) {
        bestScore = inside;
        best = f.biome;
      }
    }
    // Require meaningful penetration so biome edges are not one-texel slivers.
    return bestScore > 0.25 ? best : null;
  }

  /**
   * Height at a world point, in metres. The hot path — called for every
   * vertex of every chunk, every collision query and every spawn placement.
   */
  sampleHeight(x: number, z: number): number {
    let height = -TERRAIN_TUNING.abyssDepth;
    let landMask = 0;
    let island: IslandDefinition | null = null;

    // Find the contributing island. Islands never overlap (enforced by the
    // content validator), so the first hit is the only hit.
    for (const isl of ISLANDS) {
      const mask = this.islandMask(isl, x, z);
      if (mask > 0) {
        landMask = mask;
        island = isl;
        break;
      }
    }

    if (island === null || landMask <= 0) {
      // Open ocean: shelf near land, abyss beyond.
      let nearestEdge = Infinity;
      for (const isl of ISLANDS) {
        const d = Math.hypot(x - isl.centerX, z - isl.centerZ) - isl.radius;
        if (d < nearestEdge) nearestEdge = d;
      }
      const shelfT = clamp01(nearestEdge / TERRAIN_TUNING.shelfWidth);
      const floor = lerp(-8, -TERRAIN_TUNING.abyssDepth, smoothstep(0, 1, shelfT));
      // Seafloor relief so the ocean isn't a flat plane when diving.
      const relief = fbm2D(this.baseNoise, x * 0.0009, z * 0.0009, { octaves: 4 }) * 22;
      return floor + relief;
    }

    // Base landmass elevation, shaped by the mask.
    height = island.baseHeight * landMask;

    // Authored features.
    let featureSum = 0;
    for (const f of island.features) {
      featureSum += this.featureHeight(f, island, x, z);
    }
    height += featureSum * landMask;

    // Detail roughness. Scaled down near sea level so beaches stay walkable.
    const detail = fbm2D(
      this.detailNoise,
      x / TERRAIN_TUNING.detailScale,
      z / TERRAIN_TUNING.detailScale,
      { octaves: 6, gain: 0.48 },
    );
    const detailScale = TERRAIN_TUNING.detailAmplitude * landMask * smoothstep(0, 40, height);
    height += detail * detailScale;

    // Cheap erosion approximation: subtract from convex areas. Real hydraulic
    // erosion is a multi-pass simulation we bake offline (see the content
    // pipeline); this analytic approximation keeps runtime generation coherent
    // with the baked result without needing neighbour state.
    const erosion = fbm2D(this.erosionNoise, x * 0.0012, z * 0.0012, { octaves: 3 });
    height -= Math.max(0, erosion) * 9 * landMask * smoothstep(60, 300, height);

    // Town flattening.
    const flat = this.flattenInfluence(island, x, z);
    if (flat.weight > 0) {
      height = lerp(height, flat.target, flat.weight);
    }

    // Land floor.
    //
    // A deep authored carve (a canyon, a crater) can otherwise cut an island's
    // interior below sea level and flood it — which is how Vast Poni Canyon
    // turned into an inland sea during development. Inside a landmass, clamp to
    // a minimum elevation unless a feature here explicitly declares a water
    // biome, which is how genuine lakes and rivers opt out.
    if (landMask > 0.35 && height < MIN_LAND_HEIGHT) {
      const forced = this.forcedBiomeAt(island, x, z);
      const isWaterFeature = forced !== null && WATER_BIOMES.has(forced);
      if (!isWaterFeature) {
        height = lerp(height, MIN_LAND_HEIGHT, (landMask - 0.35) / 0.65);
      }
    }

    return height;
  }

  /**
   * Full sample including derived fields.
   * Costs four extra height samples for the normal — only call it where you
   * actually need slope or climate (mesh generation, spawn placement), not for
   * a simple "am I above the ground?" test.
   */
  sample(x: number, z: number): TerrainSample {
    const eps = TERRAIN_TUNING.normalEpsilon;
    const height = this.sampleHeight(x, z);
    const hL = this.sampleHeight(x - eps, z);
    const hR = this.sampleHeight(x + eps, z);
    const hD = this.sampleHeight(x, z - eps);
    const hU = this.sampleHeight(x, z + eps);

    // Central differences give the gradient; the normal is its perpendicular.
    let nx = hL - hR;
    let ny = 2 * eps;
    let nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    const slope = Math.acos(clamp(ny, -1, 1));

    let island: IslandDefinition | null = null;
    for (const isl of ISLANDS) {
      if (this.islandMask(isl, x, z) > 0) {
        island = isl;
        break;
      }
    }

    const baseTemp = island?.baseTemp ?? 26;
    const baseMoisture = island?.baseMoisture ?? 1;

    // Temperature: lapse rate with altitude, plus regional variation.
    const tempNoise = fbm2D(this.moistureNoise, x * 0.0004 + 91, z * 0.0004 + 17, { octaves: 3 });
    const temperature = baseTemp - Math.max(0, height) * TERRAIN_TUNING.lapseRate + tempNoise * 3.5;

    // Moisture: base, minus orographic drying with altitude, plus noise, and
    // saturated near sea level.
    const moistNoise = fbm2D(this.moistureNoise, x * 0.0006, z * 0.0006, { octaves: 4 });
    let moisture = baseMoisture + moistNoise * 0.28 - Math.max(0, height) * TERRAIN_TUNING.orographicFactor;
    if (height <= SEA_LEVEL) moisture = 1;
    moisture = clamp01(moisture);

    return {
      height,
      normalX: nx,
      normalY: ny,
      normalZ: nz,
      slope,
      moisture,
      temperature,
      island,
      forcedBiome: island ? this.forcedBiomeAt(island, x, z) : null,
    };
  }

  /** Cheap "is this point underwater?" check used by locomotion and spawning. */
  isUnderwater(x: number, z: number): boolean {
    return this.sampleHeight(x, z) < SEA_LEVEL;
  }
}

/** Perpendicular distance from a point to a line segment. */
function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const abLenSq = abx * abx + abz * abz;
  if (abLenSq < 1e-6) return Math.hypot(apx, apz);
  const t = clamp01((apx * abx + apz * abz) / abLenSq);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}
