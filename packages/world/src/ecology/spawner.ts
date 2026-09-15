/**
 * Overworld spawner.
 *
 * Turns the declarative spawn tables into actual Pokémon standing in the world.
 *
 * Two properties drive the whole design:
 *
 * 1. **Deterministic per chunk.** A chunk's population is a pure function of
 *    (worldSeed, chunkCoords, conditions). Walk away, come back, and the same
 *    Yungoos is in the same clearing — because we re-derive it, not because we
 *    stored it. This is what makes a 40km world's wildlife free to persist.
 *
 * 2. **Conditions are captured at spawn time.** A Pokémon that spawned in rain
 *    does not vanish the instant the rain stops; it lives out its life and is
 *    simply not re-rolled. Nothing breaks immersion faster than wildlife
 *    popping out of existence because a cloud moved.
 *
 * Pack spawning, shiny rolls, alpha rolls and level selection all happen here
 * so that the AI layer receives fully-formed individuals.
 */
import { Rng, rngForCell, hashCombine, type Vec3, vec3 } from '@alola/core';
import {
  eligibleSpawns,
  getSpecies,
  type SpawnConditions,
  type SpawnEntry,
  type WeatherId,
  type BiomeId,
} from '@alola/data';
import { CHUNK_SIZE } from '../streaming/chunks.ts';
import type { TerrainGenerator } from '../terrain/generator.ts';
import type { BiomeClassifier } from '../biome/classifier.ts';

/** Base shiny odds. Matches the modern series rate. */
export const SHINY_BASE_ODDS = 4096;

export interface SpawnedPokemon {
  readonly speciesId: string;
  readonly level: number;
  readonly shiny: boolean;
  readonly alpha: boolean;
  readonly sizeScale: number;
  readonly gender: 'male' | 'female' | 'genderless';
  /** Personality value: the single number every cosmetic/IV roll derives from. */
  readonly personality: number;
  readonly position: Vec3;
  readonly yaw: number;
  /** Chunk key this individual belongs to. */
  readonly homeChunk: number;
  /** Index within its pack; 0 is the pack leader. */
  readonly packIndex: number;
  /** Shared id for pack-mates, or -1 when solitary. */
  readonly packId: number;
}

export interface SpawnerOptions {
  /** Target simultaneous Pokémon per chunk at LOD0. */
  densityPerChunk?: number;
  /** Multiplier on shiny odds (charms, chain bonuses). */
  shinyMultiplier?: number;
  /** Hard cap on individuals produced for one chunk. */
  maxPerChunk?: number;
}

export class Spawner {
  private readonly worldSeed: number;
  private readonly terrain: TerrainGenerator;
  private readonly classifier: BiomeClassifier;
  private readonly density: number;
  private readonly maxPerChunk: number;

  shinyMultiplier: number;

  constructor(
    worldSeed: number,
    terrain: TerrainGenerator,
    classifier: BiomeClassifier,
    opts: SpawnerOptions = {},
  ) {
    this.worldSeed = worldSeed;
    this.terrain = terrain;
    this.classifier = classifier;
    this.density = opts.densityPerChunk ?? 7;
    this.maxPerChunk = opts.maxPerChunk ?? 24;
    this.shinyMultiplier = opts.shinyMultiplier ?? 1;
  }

  /**
   * Generate the population for one chunk.
   *
   * `hour`, `weather` and `flags` are the live conditions. Two calls with the
   * same conditions produce identical results; changing the hour re-rolls the
   * chunk, which is how day and night populations differ.
   */
  populateChunk(
    cx: number,
    cz: number,
    hour: number,
    weatherFor: (islandId: string | null) => WeatherId,
    flags: ReadonlySet<string>,
  ): SpawnedPokemon[] {
    const out: SpawnedPokemon[] = [];
    // Bucket the hour so the population does not re-roll every simulated second —
    // it changes on a 3-hour cadence, which is what makes dawn and dusk feel
    // like transitions rather than noise.
    const hourBucket = Math.floor(hour / 3);
    const rng = rngForCell(this.worldSeed, cx, cz, `spawn:${hourBucket}`);

    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;

    let packCounter = 0;
    let attempts = 0;
    const maxAttempts = this.density * 6;

    while (out.length < this.density && attempts < maxAttempts && out.length < this.maxPerChunk) {
      attempts++;

      // Pick a candidate point inside the chunk.
      const px = originX + rng.next() * CHUNK_SIZE;
      const pz = originZ + rng.next() * CHUNK_SIZE;

      const sample = this.terrain.sample(px, pz);
      const biome = this.classifier.classify(sample).biome;
      const islandId = sample.island?.id ?? null;

      const conditions: SpawnConditions = {
        biome: biome.id as BiomeId,
        island: islandId,
        hour,
        weather: weatherFor(islandId),
        altitude: sample.height,
        flags,
      };

      const candidates = eligibleSpawns(conditions);
      if (candidates.length === 0) continue;

      const idx = rng.weightedIndex(candidates.map((c) => c.weight));
      if (idx < 0) continue;
      const entry = candidates[idx].entry;
      const species = getSpecies(entry.species);

      // Reject placements the species cannot occupy.
      if (!this.isPlacementValid(species.movement, sample.height, sample.slope, biome.aquatic)) {
        continue;
      }

      // Pack size, clamped by remaining budget.
      const [packMin, packMax] = species.packSize;
      const desiredPack = rng.int(packMin, packMax);
      const packSize = Math.min(desiredPack, this.maxPerChunk - out.length);
      const packId = packSize > 1 ? packCounter++ : -1;

      for (let i = 0; i < packSize; i++) {
        // Scatter pack members around the leader.
        const spread = i === 0 ? 0 : rng.range(3, 14);
        const angle = rng.yaw();
        const mx = px + Math.cos(angle) * spread;
        const mz = pz + Math.sin(angle) * spread;

        const memberSample = i === 0 ? sample : this.terrain.sample(mx, mz);
        if (i > 0 && !this.isPlacementValid(species.movement, memberSample.height, memberSample.slope, biome.aquatic)) {
          continue;
        }

        out.push(this.makeIndividual(rng, entry, mx, mz, memberSample.height, cx, cz, i, packId));
        if (out.length >= this.maxPerChunk) break;
      }
    }

    return out;
  }

  /** Can this movement class legally exist at this point? */
  private isPlacementValid(
    movement: string,
    height: number,
    slope: number,
    aquatic: boolean,
  ): boolean {
    const underwater = height < 0;

    switch (movement) {
      case 'swimmer':
        return underwater || aquatic;
      case 'amphibious':
        return true;
      case 'flyer':
      case 'floater':
        return true; // Airborne agents are placed above whatever is below them.
      case 'burrower':
        return !underwater && slope < 0.6;
      case 'climber':
        return !underwater;
      default:
        // Land movement: must be above water and on a walkable slope.
        return !underwater && slope < 0.95;
    }
  }

  /** Roll one fully-formed individual. */
  private makeIndividual(
    rng: Rng,
    entry: SpawnEntry,
    x: number,
    z: number,
    groundHeight: number,
    cx: number,
    cz: number,
    packIndex: number,
    packId: number,
  ): SpawnedPokemon {
    const species = getSpecies(entry.species);

    // Personality value drives every derived roll, so an individual is fully
    // described by this one number plus its species — which is exactly what
    // netcode and save files want to transmit.
    const personality = rng.nextUint32();

    const [lvMin, lvMax] = entry.levelRange;
    let level = rng.int(lvMin, lvMax);

    // Alpha: oversized, higher level, aggressive.
    const alpha = entry.alphaChance !== undefined && rng.chance(entry.alphaChance);
    if (alpha) level = Math.min(100, level + rng.int(3, 8));

    // Shiny. Rolled on its own forked stream so that changing anything else
    // about spawning does not shift shiny outcomes — players notice.
    const shinyRng = new Rng(hashCombine(personality, 0x5417, cx, cz));
    const odds = Math.max(1, Math.floor(SHINY_BASE_ODDS / Math.max(1, this.shinyMultiplier)));
    const shiny = shinyRng.odds(1, odds);

    // Size variation. Alphas are dramatically larger; normal individuals vary
    // subtly, which makes a genuinely big one feel notable.
    const sizeJitter = 1 + rng.gaussian(0, 0.045);
    const sizeScale = alpha ? sizeJitter * rng.range(1.25, 1.55) : Math.max(0.82, Math.min(1.18, sizeJitter));

    let gender: SpawnedPokemon['gender'] = 'genderless';
    if (species.genderRatio !== null) {
      gender = rng.next() < species.genderRatio ? 'male' : 'female';
    }

    // Flyers hover above the ground; swimmers sit at the surface.
    let y = groundHeight;
    if (species.movement === 'flyer') y = groundHeight + rng.range(8, 26);
    else if (species.movement === 'floater') y = groundHeight + rng.range(1.5, 5);
    else if (species.movement === 'swimmer') y = Math.min(groundHeight + 1.2, 0);

    return {
      speciesId: species.id,
      level,
      shiny,
      alpha,
      sizeScale,
      gender,
      personality,
      position: vec3(x, y, z),
      yaw: rng.yaw(),
      homeChunk: hashCombine(cx, cz),
      packIndex,
      packId,
    };
  }

  /**
   * How many Pokémon *could* appear here right now? Powers the Scanner Lens
   * key item and the "habitat density" map overlay without actually spawning.
   */
  previewDensity(
    cx: number,
    cz: number,
    hour: number,
    weather: WeatherId,
    flags: ReadonlySet<string>,
  ): { species: string; weight: number }[] {
    const center = { x: cx * CHUNK_SIZE + CHUNK_SIZE / 2, z: cz * CHUNK_SIZE + CHUNK_SIZE / 2 };
    const sample = this.terrain.sample(center.x, center.z);
    const biome = this.classifier.classify(sample).biome;

    return eligibleSpawns({
      biome: biome.id as BiomeId,
      island: sample.island?.id ?? null,
      hour,
      weather,
      altitude: sample.height,
      flags,
    }).map((c) => ({ species: c.entry.species, weight: c.weight }));
  }
}
