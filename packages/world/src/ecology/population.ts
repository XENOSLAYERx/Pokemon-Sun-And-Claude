/**
 * Ecosystem population model.
 *
 * Runs above the individual-Pokémon AI, at a much coarser timescale (one tick
 * every few in-game minutes). Its job is the *statistical* health of the world:
 * if the player hunts every Yungoos on a route, Rattata numbers should climb,
 * and the Gumshoos that preyed on them should thin out or move away.
 *
 * This is modelled as a discrete Lotka–Volterra system per (region, species),
 * with carrying capacity and migration between adjacent regions. Regions are
 * coarse — one per island per biome — because the point is a felt trend over
 * hours of play, not a precise simulation.
 *
 * The population level feeds back into the spawner as a weight multiplier, so
 * the loop closes: fewer Yungoos in the model means fewer Yungoos spawn.
 */
import { clamp, clamp01, lerp, Rng } from '@alola/core';
import { entriesForBiome, getSpecies, predatorsFor, type BiomeId } from '@alola/data';

export interface PopulationRegion {
  readonly id: string;
  readonly islandId: string;
  readonly biome: BiomeId;
}

export interface SpeciesPopulation {
  /** Current population as a fraction of carrying capacity, 0–2. */
  level: number;
  /** Carrying capacity weighting from the spawn tables. */
  capacity: number;
  /** Net change last tick — what the researcher NPCs report on. */
  trend: number;
  /** Individuals removed by the player since the last tick (caught/defeated). */
  harvested: number;
}

export interface EcosystemOptions {
  /** Intrinsic growth rate per tick for prey species. */
  growthRate?: number;
  /** Predation efficiency. */
  predationRate?: number;
  /** Fraction of a population that migrates to neighbours per tick. */
  migrationRate?: number;
  /** Population level below which a species is considered locally depleted. */
  depletionThreshold?: number;
}

export class EcosystemModel {
  private regions = new Map<string, PopulationRegion>();
  /** regionId -> speciesId -> population */
  private populations = new Map<string, Map<string, SpeciesPopulation>>();
  private readonly rng: Rng;

  private readonly growthRate: number;
  private readonly predationRate: number;
  private readonly migrationRate: number;
  private readonly depletionThreshold: number;

  /** Total ticks processed. */
  ticks = 0;

  constructor(seed: number, opts: EcosystemOptions = {}) {
    this.rng = new Rng(seed ^ 0xec0);
    this.growthRate = opts.growthRate ?? 0.06;
    this.predationRate = opts.predationRate ?? 0.045;
    this.migrationRate = opts.migrationRate ?? 0.02;
    this.depletionThreshold = opts.depletionThreshold ?? 0.2;
  }

  /** Register a region and seed its populations from the spawn tables. */
  addRegion(region: PopulationRegion, speciesWeights: ReadonlyMap<string, number>): void {
    this.regions.set(region.id, region);
    const pops = new Map<string, SpeciesPopulation>();
    for (const [speciesId, weight] of speciesWeights) {
      pops.set(speciesId, {
        level: 1,
        capacity: Math.max(0.1, weight / 20),
        trend: 0,
        harvested: 0,
      });
    }
    this.populations.set(region.id, pops);
  }

  /** Record that the player removed an individual from the world. */
  recordHarvest(regionId: string, speciesId: string, count = 1): void {
    const pop = this.populations.get(regionId)?.get(speciesId);
    if (pop) pop.harvested += count;
  }

  /**
   * Advance the model one step.
   *
   * Order matters: harvest pressure first (the player's effect is immediate),
   * then predation, then growth, then migration. Applying growth before
   * predation would let a heavily-hunted prey species paper over the loss
   * within the same tick and mask the player's impact.
   */
  tick(neighbours: ReadonlyMap<string, readonly string[]>): void {
    this.ticks++;

    // Pass 1: harvest and predation, computed against a snapshot so that the
    // order regions are iterated in cannot change the outcome.
    const snapshot = new Map<string, Map<string, number>>();
    for (const [regionId, pops] of this.populations) {
      const snap = new Map<string, number>();
      for (const [sid, p] of pops) snap.set(sid, p.level);
      snapshot.set(regionId, snap);
    }

    for (const [regionId, pops] of this.populations) {
      const snap = snapshot.get(regionId)!;

      for (const [speciesId, pop] of pops) {
        const before = pop.level;

        // Player pressure. Each harvested individual is a meaningful dent in a
        // small local population and negligible in a large one.
        if (pop.harvested > 0) {
          pop.level = Math.max(0, pop.level - (pop.harvested * 0.015) / Math.max(0.2, pop.capacity));
          pop.harvested = 0;
        }

        // Predation: sum the pressure from every predator present in-region.
        let predatorPressure = 0;
        for (const predatorId of predatorsFor(speciesId)) {
          const predatorLevel = snap.get(predatorId) ?? 0;
          if (predatorLevel > 0) predatorPressure += predatorLevel;
        }
        if (predatorPressure > 0) {
          pop.level = Math.max(0, pop.level - this.predationRate * predatorPressure * pop.level);
        }

        // Predator sustenance: a predator with no prey in-region declines.
        const species = getSpecies(speciesId);
        if (species.preysOn.length > 0) {
          let preyAvailable = 0;
          for (const preyId of species.preysOn) preyAvailable += snap.get(preyId) ?? 0;

          if (preyAvailable < this.depletionThreshold) {
            // Starvation: predators thin out or leave.
            pop.level = Math.max(0, pop.level - 0.05);
          } else {
            // Well-fed predators grow, but slowly.
            pop.level += this.growthRate * 0.35 * preyAvailable * (1 - pop.level / 1.5);
          }
        } else {
          // Logistic growth toward carrying capacity.
          pop.level += this.growthRate * pop.level * (1 - pop.level);
        }

        // Small stochastic drift so populations are never perfectly static.
        pop.level += this.rng.gaussian(0, 0.004);
        pop.level = clamp(pop.level, 0, 2);
        pop.trend = pop.level - before;
      }
    }

    // Pass 2: migration between adjacent regions, which is what lets a depleted
    // route naturally refill from its neighbours rather than needing a respawn
    // timer.
    for (const [regionId, adjacent] of neighbours) {
      const pops = this.populations.get(regionId);
      if (!pops || adjacent.length === 0) continue;

      for (const [speciesId, pop] of pops) {
        for (const neighbourId of adjacent) {
          const neighbourPops = this.populations.get(neighbourId);
          const neighbourPop = neighbourPops?.get(speciesId);
          if (!neighbourPop) continue;

          // Flow down the gradient.
          const gradient = neighbourPop.level - pop.level;
          if (Math.abs(gradient) < 0.01) continue;
          const flow = gradient * this.migrationRate;
          pop.level = clamp(pop.level + flow, 0, 2);
          neighbourPop.level = clamp(neighbourPop.level - flow, 0, 2);
        }
      }
    }
  }

  /**
   * Spawn weight multiplier for a species in a region.
   * This is the feedback path into the spawner: a depleted population spawns
   * less, a booming one spawns more.
   */
  spawnMultiplier(regionId: string, speciesId: string): number {
    const pop = this.populations.get(regionId)?.get(speciesId);
    if (!pop) return 1;
    // Map population level 0..2 to a 0.15..1.8 multiplier, non-linearly so that
    // a healthy population sits near 1 and depletion is strongly felt.
    return lerp(0.15, 1.8, clamp01(pop.level / 2) ** 0.8);
  }

  get(regionId: string, speciesId: string): SpeciesPopulation | undefined {
    return this.populations.get(regionId)?.get(speciesId);
  }

  /** Species whose population has collapsed in a region — drives research quests. */
  depletedIn(regionId: string): string[] {
    const pops = this.populations.get(regionId);
    if (!pops) return [];
    const out: string[] = [];
    for (const [sid, p] of pops) {
      if (p.level < this.depletionThreshold) out.push(sid);
    }
    return out;
  }

  /** Species that have boomed — drives "cull the Yungoos" bounty quests. */
  overpopulatedIn(regionId: string): string[] {
    const pops = this.populations.get(regionId);
    if (!pops) return [];
    const out: string[] = [];
    for (const [sid, p] of pops) {
      if (p.level > 1.5) out.push(sid);
    }
    return out;
  }

  regionIds(): string[] {
    return [...this.regions.keys()];
  }

  /** Compact save representation. */
  save(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [regionId, pops] of this.populations) {
      const r: Record<string, number> = {};
      for (const [sid, p] of pops) r[sid] = Math.round(p.level * 1000) / 1000;
      out[regionId] = r;
    }
    return out;
  }

  restore(data: Record<string, Record<string, number>>): void {
    for (const [regionId, species] of Object.entries(data)) {
      const pops = this.populations.get(regionId);
      if (!pops) continue;
      for (const [sid, level] of Object.entries(species)) {
        const p = pops.get(sid);
        if (p) p.level = level;
      }
    }
  }
}

/** Build the standard region set: one per (island, biome) pair in use. */
export function buildRegionId(islandId: string, biome: BiomeId): string {
  return `${islandId}:${biome}`;
}

/**
 * Species that can occupy a biome, with their summed spawn weight.
 * This is what seeds a region's carrying capacities, so the ecosystem model
 * and the spawner derive from the same source of truth.
 */
export function speciesWeightsForBiome(biome: BiomeId): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of entriesForBiome(biome)) {
    out.set(entry.species, (out.get(entry.species) ?? 0) + entry.weight);
  }
  return out;
}

/**
 * Build the full region set for an island from the biomes it actually contains.
 * Regions with no possible inhabitants are skipped — an empty region would
 * just burn a tick every update for no observable effect.
 */
export function buildRegionsForIsland(
  islandId: string,
  biomes: readonly BiomeId[],
): { region: PopulationRegion; weights: Map<string, number> }[] {
  const out: { region: PopulationRegion; weights: Map<string, number> }[] = [];
  for (const biome of biomes) {
    const weights = speciesWeightsForBiome(biome);
    if (weights.size === 0) continue;
    out.push({
      region: { id: buildRegionId(islandId, biome), islandId, biome },
      weights,
    });
  }
  return out;
}
