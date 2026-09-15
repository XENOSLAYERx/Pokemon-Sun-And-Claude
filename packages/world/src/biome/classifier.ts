/**
 * Biome classification.
 *
 * Maps a terrain sample to a biome. The rule set is deliberately ordered:
 * hard overrides first (authored features, water), then climate matching.
 *
 * Climate matching scores every biome on how well the point fits its declared
 * bands rather than taking the first match. That means biome boundaries follow
 * the terrain smoothly instead of snapping on declaration order, and adding a
 * new biome cannot silently steal territory from an existing one — it only
 * wins where it genuinely fits better.
 */
import { clamp01, invLerp } from '@alola/core';
import { BIOMES, type BiomeDefinition, type BiomeId } from '@alola/data';
import { SEA_LEVEL, type TerrainSample } from '../terrain/generator.ts';

/** How well does `value` sit inside [min, max]? 1 = centred, 0 = outside. */
function bandFit(value: number, min: number, max: number): number {
  if (value < min || value > max) {
    // Graceful falloff outside the band so near-misses still score above zero;
    // otherwise points between two biomes' bands classify as nothing.
    const span = Math.max(max - min, 1e-3);
    const overshoot = value < min ? min - value : value - max;
    return Math.max(0, 1 - overshoot / (span * 0.5)) * 0.35;
  }
  // Inside the band: peak in the middle, tapering toward the edges.
  const t = invLerp(min, max, value);
  return 1 - Math.abs(t - 0.5) * 0.6;
}

/** Biomes that are only ever placed by an authored feature, never by climate. */
const FEATURE_ONLY = new Set<BiomeId>([
  'town', 'city', 'facility', 'ruins', 'ultra-space',
  'cave', 'crystal-cave', 'lava-cave', 'lava-field',
]);

export interface BiomeClassification {
  readonly biome: BiomeDefinition;
  /** Runner-up, for blending terrain textures across the boundary. */
  readonly secondary: BiomeDefinition | null;
  /** 0–1 blend weight toward the secondary biome. */
  readonly blend: number;
}

export class BiomeClassifier {
  private readonly climateBiomes: readonly BiomeDefinition[];

  constructor() {
    this.climateBiomes = BIOMES.filter((b) => !FEATURE_ONLY.has(b.id));
  }

  classify(sample: TerrainSample): BiomeClassification {
    // 1. Authored feature override wins outright.
    if (sample.forcedBiome) {
      const forced = BIOMES.find((b) => b.id === sample.forcedBiome);
      if (forced) return { biome: forced, secondary: null, blend: 0 };
    }

    // 2. Water is determined by height, not climate.
    if (sample.height < SEA_LEVEL) {
      const depth = SEA_LEVEL - sample.height;
      let id: BiomeId;
      if (depth > 60) id = 'deep-ocean';
      else if (depth < 14 && sample.island !== null) id = 'reef';
      else id = 'ocean';
      const biome = BIOMES.find((b) => b.id === id)!;
      return { biome, secondary: null, blend: 0 };
    }

    // 3. Climate scoring.
    let best: BiomeDefinition | null = null;
    let bestScore = -Infinity;
    let second: BiomeDefinition | null = null;
    let secondScore = -Infinity;

    for (const b of this.climateBiomes) {
      if (sample.height < b.heightRange[0] || sample.height > b.heightRange[1]) {
        // Height is a hard gate: a snowfield at sea level is never right.
        continue;
      }
      if (sample.slope > b.maxSlope) continue;

      const score =
        bandFit(sample.height, b.heightRange[0], b.heightRange[1]) * 1.0 +
        bandFit(sample.moisture, b.moistureRange[0], b.moistureRange[1]) * 1.4 +
        bandFit(sample.temperature, b.tempRange[0], b.tempRange[1]) * 1.4;

      if (score > bestScore) {
        second = best;
        secondScore = bestScore;
        best = b;
        bestScore = score;
      } else if (score > secondScore) {
        second = b;
        secondScore = score;
      }
    }

    if (!best) {
      // Nothing fit — happens on extreme slopes. Fall back on a coastal cliff
      // (steep, climate-agnostic) rather than returning null and forcing every
      // caller to handle it.
      const fallback = BIOMES.find((b) => b.id === 'coastal-cliff')!;
      return { biome: fallback, secondary: null, blend: 0 };
    }

    // Blend weight: how close the runner-up was. Used for texture splatting.
    const blend = second && bestScore > 0 ? clamp01(secondScore / bestScore) * 0.5 : 0;
    return { biome: best, secondary: second, blend };
  }

  /** Convenience: just the id. */
  classifyId(sample: TerrainSample): BiomeId {
    return this.classify(sample).biome.id;
  }
}
