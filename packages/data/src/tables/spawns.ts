/**
 * Spawn tables.
 *
 * A spawn entry is a *candidate*, not a guarantee. The spawner scores every
 * candidate in a chunk against the live conditions — biome, hour, weather,
 * island, altitude — and only then rolls. This is what makes "weather-dependent
 * spawning" and "time-dependent spawning" real systems rather than two hardcoded
 * lists: a designer expresses a rule, and it composes with every other rule.
 *
 * Conditions are all optional and all AND-ed. An entry with no conditions can
 * appear anywhere its biome does.
 */
import type { BiomeId } from '../world/biomes.ts';

export type WeatherId =
  | 'clear' | 'cloudy' | 'rain' | 'thunderstorm' | 'heavy-rain'
  | 'sandstorm' | 'hail' | 'snow' | 'fog' | 'harsh-sunlight' | 'aurora';

export interface SpawnEntry {
  readonly species: string;
  /** Relative weight within its biome. Higher = more common. */
  readonly weight: number;
  readonly levelRange: readonly [number, number];
  /** Biomes this entry can appear in. */
  readonly biomes: readonly BiomeId[];
  /** Islands this entry is restricted to. Empty = any. */
  readonly islands?: readonly string[];
  /** Hours (0–23) this entry is eligible. Empty/absent = any hour. */
  readonly hours?: readonly number[];
  /** Weather conditions required. Absent = any. */
  readonly weather?: readonly WeatherId[];
  /** Altitude band in metres. */
  readonly altitude?: readonly [number, number];
  /** Multiplier applied when the required weather is active — makes rare
   *  weather feel genuinely rewarding rather than merely permissive. */
  readonly weatherBonus?: number;
  /** Chance this spawn is an alpha (oversized, aggressive, high level). */
  readonly alphaChance?: number;
  /** Requires a story flag before it can appear at all. */
  readonly requiresFlag?: string;
}

const DAY_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] as const;
const NIGHT_HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5] as const;

export const SPAWN_TABLE: readonly SpawnEntry[] = [
  // ------------------------------------------------------ Melemele basics
  { species: 'PIKIPEK', weight: 22, levelRange: [3, 9], biomes: ['tropical-forest', 'grassland'], islands: ['melemele'], hours: [...DAY_HOURS] },
  { species: 'YUNGOOS', weight: 24, levelRange: [3, 10], biomes: ['grassland', 'beach', 'tropical-forest'], islands: ['melemele', 'akala'], hours: [...DAY_HOURS] },
  { species: 'RATTATA_ALOLA', weight: 24, levelRange: [3, 10], biomes: ['grassland', 'town', 'tropical-forest'], hours: [...NIGHT_HOURS] },
  { species: 'CATERPIE', weight: 16, levelRange: [2, 7], biomes: ['tropical-forest', 'meadow'], hours: [...DAY_HOURS] },
  { species: 'GRUBBIN', weight: 18, levelRange: [3, 9], biomes: ['tropical-forest', 'grassland', 'dense-jungle'] },
  { species: 'PIKACHU', weight: 7, levelRange: [8, 16], biomes: ['tropical-forest', 'meadow', 'grassland'], hours: [...DAY_HOURS] },
  { species: 'PIKACHU', weight: 14, levelRange: [10, 18], biomes: ['tropical-forest', 'meadow'], weather: ['thunderstorm'], weatherBonus: 3, alphaChance: 0.06 },
  { species: 'WINGULL', weight: 26, levelRange: [4, 12], biomes: ['beach', 'coastal-cliff', 'ocean', 'reef'] },
  { species: 'CRABRAWLER', weight: 14, levelRange: [5, 13], biomes: ['beach', 'coastal-cliff'] },
  { species: 'MEOWTH_ALOLA', weight: 11, levelRange: [6, 14], biomes: ['town', 'city', 'grassland'], hours: [...NIGHT_HOURS] },
  { species: 'ORICORIO', weight: 9, levelRange: [9, 16], biomes: ['meadow', 'tropical-forest'], hours: [...DAY_HOURS] },
  { species: 'ROWLET', weight: 3, levelRange: [8, 14], biomes: ['dense-jungle', 'tropical-forest'], hours: [...NIGHT_HOURS], alphaChance: 0.04 },
  { species: 'LITTEN', weight: 3, levelRange: [8, 14], biomes: ['grassland', 'volcanic-slope'], hours: [...NIGHT_HOURS], alphaChance: 0.04 },
  { species: 'POPPLIO', weight: 3, levelRange: [8, 14], biomes: ['beach', 'reef'], hours: [...DAY_HOURS], alphaChance: 0.04 },

  // ------------------------------------------------------- Towns and cities
  // Towns previously held only nocturnal species, leaving them lifeless by
  // day. These are the Pokémon that live comfortably alongside people.
  { species: 'PIKIPEK', weight: 16, levelRange: [4, 12], biomes: ['town', 'city'], hours: [...DAY_HOURS] },
  { species: 'WINGULL', weight: 20, levelRange: [5, 14], biomes: ['town', 'city'] },
  { species: 'YUNGOOS', weight: 14, levelRange: [4, 12], biomes: ['town'], hours: [...DAY_HOURS] },
  { species: 'PIKACHU', weight: 6, levelRange: [8, 16], biomes: ['town'], hours: [...DAY_HOURS] },
  { species: 'MEOWTH_ALOLA', weight: 10, levelRange: [6, 15], biomes: ['town', 'city'], hours: [...DAY_HOURS] },
  { species: 'GRUBBIN', weight: 12, levelRange: [5, 13], biomes: ['town', 'city'] },
  { species: 'CRABRAWLER', weight: 8, levelRange: [6, 14], biomes: ['town'] },
  { species: 'STOUTLAND', weight: 5, levelRange: [28, 38], biomes: ['city'], hours: [...DAY_HOURS] },
  { species: 'ORICORIO', weight: 7, levelRange: [10, 18], biomes: ['town'], hours: [...DAY_HOURS] },

  // --------------------------------------------------------------- Aquatic
  { species: 'MAGIKARP', weight: 30, levelRange: [4, 14], biomes: ['ocean', 'river', 'lake', 'reef'] },
  { species: 'FINNEON', weight: 20, levelRange: [8, 18], biomes: ['ocean', 'reef'], hours: [...NIGHT_HOURS] },
  { species: 'LUVDISC', weight: 16, levelRange: [8, 18], biomes: ['reef'], hours: [...DAY_HOURS] },
  { species: 'WISHIWASHI', weight: 26, levelRange: [10, 22], biomes: ['ocean', 'reef', 'lake'] },
  { species: 'SHARPEDO', weight: 8, levelRange: [22, 34], biomes: ['ocean', 'deep-ocean'], alphaChance: 0.1 },
  { species: 'SHARPEDO', weight: 15, levelRange: [26, 40], biomes: ['deep-ocean'], weather: ['thunderstorm', 'heavy-rain'], weatherBonus: 2.5, alphaChance: 0.18 },
  { species: 'LAPRAS', weight: 4, levelRange: [24, 36], biomes: ['ocean', 'deep-ocean'], weather: ['clear', 'cloudy'], alphaChance: 0.05 },

  // ------------------------------------------------------------- Wetland
  { species: 'GRUBBIN', weight: 16, levelRange: [8, 18], biomes: ['wetland'] },
  { species: 'POPPLIO', weight: 6, levelRange: [10, 20], biomes: ['wetland'], hours: [...DAY_HOURS] },
  { species: 'CATERPIE', weight: 12, levelRange: [6, 14], biomes: ['wetland'], hours: [...DAY_HOURS] },
  { species: 'CRABRAWLER', weight: 12, levelRange: [10, 20], biomes: ['wetland'] },
  { species: 'MUDBRAY', weight: 14, levelRange: [18, 28], biomes: ['wetland'] },
  { species: 'ORICORIO', weight: 8, levelRange: [46, 58], biomes: ['wetland'], islands: ['poni'], hours: [...DAY_HOURS] },
  { species: 'WINGULL', weight: 16, levelRange: [8, 20], biomes: ['wetland'] },

  // ------------------------------------------------------ Akala: jungle/volcano
  { species: 'SALANDIT', weight: 20, levelRange: [18, 28], biomes: ['volcanic-slope', 'lava-field', 'lava-cave'], islands: ['akala'] },
  { species: 'SALANDIT', weight: 30, levelRange: [22, 32], biomes: ['volcanic-slope'], weather: ['harsh-sunlight'], weatherBonus: 2, alphaChance: 0.08 },
  { species: 'GROWLITHE', weight: 14, levelRange: [16, 26], biomes: ['grassland', 'volcanic-slope', 'badlands'] },
  { species: 'LURANTIS', weight: 5, levelRange: [24, 32], biomes: ['dense-jungle'], islands: ['akala'], hours: [...DAY_HOURS], alphaChance: 0.12 },
  { species: 'MUDBRAY', weight: 16, levelRange: [17, 27], biomes: ['grassland', 'badlands'], islands: ['akala', 'ulaula'] },
  { species: 'MUDSDALE', weight: 5, levelRange: [30, 42], biomes: ['grassland', 'badlands', 'canyon'], alphaChance: 0.1 },
  { species: 'TAUROS', weight: 9, levelRange: [24, 36], biomes: ['grassland', 'meadow'], alphaChance: 0.1 },
  { species: 'STUFFUL', weight: 12, levelRange: [20, 30], biomes: ['dense-jungle', 'tropical-forest'], islands: ['akala', 'ulaula'] },
  { species: 'BEWEAR', weight: 4, levelRange: [32, 44], biomes: ['dense-jungle'], alphaChance: 0.2 },
  { species: 'EXEGGUTOR_ALOLA', weight: 6, levelRange: [28, 40], biomes: ['tropical-forest', 'beach'], islands: ['akala', 'poni'] },
  { species: 'MAROWAK_ALOLA', weight: 8, levelRange: [24, 34], biomes: ['lava-cave', 'volcanic-slope', 'ruins'], hours: [...NIGHT_HOURS] },
  { species: 'GRIMER_ALOLA', weight: 14, levelRange: [22, 32], biomes: ['city', 'town', 'facility'], hours: [...NIGHT_HOURS] },

  // --------------------------------------------------------- Crystal caves
  { species: 'GEODUDE_ALOLA', weight: 22, levelRange: [24, 36], biomes: ['crystal-cave'] },
  { species: 'MIMIKYU', weight: 7, levelRange: [30, 42], biomes: ['crystal-cave'], hours: [...NIGHT_HOURS], alphaChance: 0.15 },
  { species: 'SANDSHREW_ALOLA', weight: 12, levelRange: [28, 40], biomes: ['crystal-cave'] },
  { species: 'MAROWAK_ALOLA', weight: 9, levelRange: [28, 40], biomes: ['crystal-cave'], hours: [...NIGHT_HOURS] },
  { species: 'VIKAVOLT', weight: 5, levelRange: [36, 48], biomes: ['crystal-cave'], alphaChance: 0.14 },

  // --------------------------------------------- Ula'ula: desert/city/alpine
  { species: 'GEODUDE_ALOLA', weight: 20, levelRange: [26, 38], biomes: ['cave', 'badlands', 'canyon', 'alpine'] },
  { species: 'GEODUDE_ALOLA', weight: 34, levelRange: [30, 42], biomes: ['badlands', 'canyon'], weather: ['thunderstorm'], weatherBonus: 2.2 },
  { species: 'SANDSHREW_ALOLA', weight: 18, levelRange: [32, 44], biomes: ['snowfield', 'alpine'], islands: ['ulaula'] },
  { species: 'VULPIX_ALOLA', weight: 14, levelRange: [32, 44], biomes: ['snowfield', 'alpine'], islands: ['ulaula'] },
  { species: 'VULPIX_ALOLA', weight: 26, levelRange: [34, 46], biomes: ['snowfield'], weather: ['snow', 'hail'], weatherBonus: 2.4, alphaChance: 0.12 },
  { species: 'RATICATE_ALOLA', weight: 16, levelRange: [28, 40], biomes: ['city', 'town', 'desert'], hours: [...NIGHT_HOURS] },
  { species: 'GUMSHOOS', weight: 12, levelRange: [28, 38], biomes: ['desert', 'badlands', 'grassland'], hours: [...DAY_HOURS] },
  { species: 'VIKAVOLT', weight: 6, levelRange: [34, 46], biomes: ['dense-jungle', 'highland'], alphaChance: 0.14 },
  { species: 'MIMIKYU', weight: 5, levelRange: [32, 44], biomes: ['ruins', 'cave', 'facility'], hours: [...NIGHT_HOURS], alphaChance: 0.15 },
  { species: 'MIMIKYU', weight: 12, levelRange: [34, 46], biomes: ['ruins', 'facility'], weather: ['fog'], weatherBonus: 2.5, hours: [...NIGHT_HOURS] },
  { species: 'STOUTLAND', weight: 8, levelRange: [34, 46], biomes: ['desert', 'grassland', 'badlands'] },

  // ------------------------------------------------------------------ Ruins
  // The ruins previously held only nocturnal species, so a daytime visit to a
  // Tapu shrine found nothing at all.
  { species: 'GEODUDE_ALOLA', weight: 16, levelRange: [20, 34], biomes: ['ruins'] },
  { species: 'ORICORIO', weight: 10, levelRange: [18, 30], biomes: ['ruins'], hours: [...DAY_HOURS] },
  { species: 'MEOWTH_ALOLA', weight: 9, levelRange: [16, 28], biomes: ['ruins'] },
  { species: 'CRABRAWLER', weight: 8, levelRange: [18, 30], biomes: ['ruins'] },

  // --------------------------------------------------- Poni: endgame frontier
  { species: 'KOMMO_O', weight: 3, levelRange: [52, 64], biomes: ['canyon', 'highland'], islands: ['poni'], alphaChance: 0.25 },
  { species: 'CHARIZARD', weight: 2, levelRange: [50, 62], biomes: ['alpine', 'highland', 'volcanic-slope'], alphaChance: 0.2 },

  // ------------------------------------------------------------ Ultra Space
  { species: 'NIHILEGO', weight: 10, levelRange: [55, 68], biomes: ['ultra-space'], requiresFlag: 'ultra_access' },
  { species: 'BUZZWOLE', weight: 8, levelRange: [58, 70], biomes: ['ultra-space'], requiresFlag: 'ultra_access' },
  { species: 'PHEROMOSA', weight: 8, levelRange: [58, 70], biomes: ['ultra-space'], requiresFlag: 'ultra_access' },
  { species: 'XURKITREE', weight: 8, levelRange: [58, 70], biomes: ['ultra-space'], requiresFlag: 'ultra_access' },
  { species: 'GUZZLORD', weight: 4, levelRange: [62, 75], biomes: ['ultra-space'], requiresFlag: 'ultra_access', alphaChance: 0.4 },

  // Wormhole leakage: Ultra Beasts appearing in the overworld during an aurora.
  { species: 'NIHILEGO', weight: 6, levelRange: [55, 66], biomes: ['coastal-cliff', 'beach', 'ruins'], weather: ['aurora'], weatherBonus: 4, requiresFlag: 'ub_mission_start' },
  { species: 'XURKITREE', weight: 5, levelRange: [56, 68], biomes: ['facility', 'badlands'], weather: ['aurora'], weatherBonus: 4, requiresFlag: 'ub_mission_start' },
];

/** Conditions the spawner evaluates a candidate against. */
export interface SpawnConditions {
  readonly biome: BiomeId;
  readonly island: string | null;
  /** 0–23.999 */
  readonly hour: number;
  readonly weather: WeatherId;
  readonly altitude: number;
  /** Story flags the player has set. */
  readonly flags: ReadonlySet<string>;
}

/**
 * Score a candidate against live conditions.
 * Returns 0 when the entry is ineligible, otherwise its effective weight.
 *
 * Keeping this a pure function means the spawner, the "what can I find here?"
 * UI, and the content validator all agree by construction.
 */
export function scoreSpawnEntry(entry: SpawnEntry, cond: SpawnConditions): number {
  if (!entry.biomes.includes(cond.biome)) return 0;

  if (entry.islands && entry.islands.length > 0) {
    if (cond.island === null || !entry.islands.includes(cond.island)) return 0;
  }

  if (entry.hours && entry.hours.length > 0) {
    if (!entry.hours.includes(Math.floor(cond.hour) % 24)) return 0;
  }

  if (entry.altitude) {
    const [lo, hi] = entry.altitude;
    if (cond.altitude < lo || cond.altitude > hi) return 0;
  }

  if (entry.requiresFlag && !cond.flags.has(entry.requiresFlag)) return 0;

  let weight = entry.weight;
  if (entry.weather && entry.weather.length > 0) {
    if (!entry.weather.includes(cond.weather)) return 0;
    weight *= entry.weatherBonus ?? 1;
  }

  return weight;
}

/** All entries that could ever appear in a biome — used by the Pokédex habitat view. */
export function entriesForBiome(biome: BiomeId): readonly SpawnEntry[] {
  return SPAWN_TABLE.filter((e) => e.biomes.includes(biome));
}

/** Every eligible entry for the given conditions, with its effective weight. */
export function eligibleSpawns(cond: SpawnConditions): { entry: SpawnEntry; weight: number }[] {
  const out: { entry: SpawnEntry; weight: number }[] = [];
  for (const entry of SPAWN_TABLE) {
    const w = scoreSpawnEntry(entry, cond);
    if (w > 0) out.push({ entry, weight: w });
  }
  return out;
}
