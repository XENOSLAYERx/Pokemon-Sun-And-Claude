/**
 * Arena generation.
 *
 * The brief requires seamless battles with no loading screens. That means the
 * battle "arena" is not a scene we load — it is a description of the ground
 * the player is already standing on, captured at the moment the encounter
 * starts.
 *
 * This module answers three questions:
 *   1. Where exactly does the battle take place? (Finding flat-enough ground.)
 *   2. What surface is underfoot? (Drives Z-Move reactions and footstep audio.)
 *   3. How should the camera be rigged? (Open field vs cave vs cliff edge.)
 */
import { getBiome, type BiomeId } from '@alola/data';
import type { BattleArena } from '../engine/state.ts';

export interface TerrainProbe {
  /** Ground height at a world position. */
  heightAt(x: number, z: number): number;
  /** Slope in radians at a world position. */
  slopeAt(x: number, z: number): number;
  /** Biome at a world position. */
  biomeAt(x: number, z: number): BiomeId;
}

export interface ArenaRequest {
  /** Where the encounter was triggered. */
  readonly x: number;
  readonly z: number;
  /** Desired usable radius in metres. */
  readonly desiredRadius?: number;
  readonly weather: string | null;
  readonly hour: number;
  readonly island: string | null;
  /** Is the encounter underground or indoors? */
  readonly enclosed?: boolean;
}

/** Map a biome to the dominant surface material underfoot. */
export function surfaceForBiome(biome: BiomeId): BattleArena['surface'] {
  switch (biome) {
    case 'beach':
    case 'desert':
      return 'sand';
    case 'ocean':
    case 'deep-ocean':
    case 'reef':
    case 'river':
    case 'lake':
    case 'wetland':
      return 'water';
    case 'snowfield':
      return 'snow';
    case 'lava-field':
    case 'lava-cave':
      return 'lava';
    case 'coastal-cliff':
    case 'cave':
    case 'crystal-cave':
    case 'canyon':
    case 'badlands':
    case 'alpine':
    case 'ruins':
    case 'volcanic-slope':
      return 'rock';
    case 'facility':
    case 'city':
      return 'metal';
    case 'tropical-forest':
    case 'dense-jungle':
    case 'meadow':
    case 'grassland':
    case 'highland':
      return 'foliage';
    default:
      return 'ground';
  }
}

/** Biomes that are physically enclosed, which constrains sky-facing cameras. */
const ENCLOSED_BIOMES = new Set<BiomeId>(['cave', 'crystal-cave', 'lava-cave', 'facility']);

/**
 * Find the best battle position near the encounter point.
 *
 * Searches outward in rings for the flattest ground within a short distance.
 * This matters more than it sounds: staging a cinematic Z-Move on a 40-degree
 * slope puts the camera underground and the Pokémon sliding. Nudging the arena
 * a few metres to level ground is invisible to the player and fixes both.
 */
export function generateArena(probe: TerrainProbe, request: ArenaRequest): BattleArena {
  const desiredRadius = request.desiredRadius ?? 14;

  let bestX = request.x;
  let bestZ = request.z;
  let bestScore = -Infinity;

  // Ring search: the origin, then three rings outward.
  const rings = [0, 4, 8, 14];
  const samplesPerRing = 8;

  for (const ringRadius of rings) {
    const samples = ringRadius === 0 ? 1 : samplesPerRing;
    for (let i = 0; i < samples; i++) {
      const angle = (i / samples) * Math.PI * 2;
      const x = request.x + Math.cos(angle) * ringRadius;
      const z = request.z + Math.sin(angle) * ringRadius;

      // Score the flatness of a small patch around the candidate.
      let totalSlope = 0;
      let maxSlope = 0;
      let heightSpread = 0;
      const centerHeight = probe.heightAt(x, z);
      const probes = 8;

      for (let j = 0; j < probes; j++) {
        const a = (j / probes) * Math.PI * 2;
        const px = x + Math.cos(a) * desiredRadius * 0.7;
        const pz = z + Math.sin(a) * desiredRadius * 0.7;
        const slope = probe.slopeAt(px, pz);
        totalSlope += slope;
        maxSlope = Math.max(maxSlope, slope);
        heightSpread = Math.max(heightSpread, Math.abs(probe.heightAt(px, pz) - centerHeight));
      }

      const avgSlope = totalSlope / probes;
      // Prefer flat ground, penalise height variance, and slightly prefer
      // staying near the encounter point so the camera does not lurch.
      const score =
        -avgSlope * 3 - maxSlope * 2 - heightSpread * 0.15 - (ringRadius / 14) * 0.4;

      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestZ = z;
      }
    }
  }

  const biome = probe.biomeAt(bestX, bestZ);
  const biomeDef = getBiome(biome);

  // Shrink the arena on difficult ground rather than clipping through it.
  let radius = desiredRadius;
  const centerSlope = probe.slopeAt(bestX, bestZ);
  if (centerSlope > 0.5) radius *= 0.7;
  if (biomeDef.aquatic) radius *= 1.3; // Water battles have more open space.

  return {
    biome,
    surface: surfaceForBiome(biome),
    x: bestX,
    z: bestZ,
    y: probe.heightAt(bestX, bestZ),
    radius,
    weather: request.weather,
    hour: request.hour,
    island: request.island,
    enclosed: request.enclosed ?? ENCLOSED_BIOMES.has(biome),
  };
}

/**
 * Camera rig selection.
 *
 * The rig is chosen from the arena's shape, not from the battle type, so the
 * same trainer battle looks different on a beach and in a cave — which is the
 * whole point of generating arenas from the world.
 */
export type CameraRig =
  | 'open-field'    // Wide orbit, high angles available.
  | 'enclosed'      // Low ceiling: tight orbit, no sky shots.
  | 'aquatic'       // Surface-level, waves in frame.
  | 'cliff'         // Dramatic drop on one side; use it.
  | 'confined';     // Very tight; mostly close-ups.

export function cameraRigFor(arena: BattleArena): CameraRig {
  if (arena.enclosed) return arena.radius < 10 ? 'confined' : 'enclosed';
  if (arena.surface === 'water') return 'aquatic';
  if (arena.biome === 'coastal-cliff' || arena.biome === 'canyon') return 'cliff';
  if (arena.radius < 9) return 'confined';
  return 'open-field';
}

/**
 * Which Z-Move environmental reactions can actually play here?
 *
 * A Z-Move declares reactions per surface; this resolves them against the real
 * arena, so Gigavolt Havoc vitrifies sand on a beach and does nothing to the
 * metal floor of Aether Paradise.
 */
export function resolveEnvironmentReactions(
  arena: BattleArena,
  reactions: readonly { surface: string; effect: string; radius: number; duration: number }[],
): { effect: string; radius: number; duration: number }[] {
  const out: { effect: string; radius: number; duration: number }[] = [];
  for (const reaction of reactions) {
    if (reaction.surface !== 'any' && reaction.surface !== arena.surface) {
      // A foliage reaction still plays in a forest biome even though the
      // surface reads as 'foliage' only for ground cover.
      if (!(reaction.surface === 'foliage' && arena.surface === 'foliage')) continue;
    }
    // Clamp the reaction to the space actually available.
    out.push({
      effect: reaction.effect,
      radius: Math.min(reaction.radius, arena.radius * 2.2),
      duration: reaction.duration,
    });
  }
  return out;
}

/** Music track for an arena, resolved from island and biome danger. */
export function musicFor(arena: BattleArena, isTotem: boolean, isTrainer: boolean): string {
  if (isTotem) return 'bgm/totem_battle';
  if (arena.biome === 'ultra-space') return 'bgm/ultra_space_battle';
  if (isTrainer) return arena.island ? `bgm/battle_trainer_${arena.island}` : 'bgm/battle_trainer';
  const danger = getBiome(arena.biome).danger;
  if (danger >= 4) return 'bgm/battle_wild_dangerous';
  return 'bgm/battle_wild';
}
