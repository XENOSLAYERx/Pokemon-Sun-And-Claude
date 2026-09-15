/**
 * Biome definitions.
 *
 * A biome is the join point between terrain generation, spawning, audio and
 * rendering. The terrain generator classifies each point into a biome from
 * height/moisture/temperature/slope; everything downstream — which Pokémon
 * spawn, which ambience plays, which grass mesh scatters, which footstep
 * sound fires — reads it from here rather than re-deriving it.
 */

export const BiomeIds = [
  'ocean', 'deep-ocean', 'reef', 'beach', 'coastal-cliff',
  'tropical-forest', 'dense-jungle', 'grassland', 'meadow',
  'wetland', 'river', 'lake',
  'volcanic-slope', 'lava-field', 'lava-cave',
  'cave', 'crystal-cave', 'desert', 'badlands',
  'canyon', 'highland', 'alpine', 'snowfield',
  'ruins', 'town', 'city', 'facility', 'ultra-space',
] as const;

export type BiomeId = (typeof BiomeIds)[number];

export interface BiomeDefinition {
  readonly id: BiomeId;
  readonly name: string;
  /** Height band in metres above sea level this biome can occupy. */
  readonly heightRange: readonly [number, number];
  /** Moisture band, 0–1. */
  readonly moistureRange: readonly [number, number];
  /** Temperature band in °C. */
  readonly tempRange: readonly [number, number];
  /** Max terrain slope in radians this biome occupies. */
  readonly maxSlope: number;
  /** Base ground albedo — the terrain shader tints splat layers with this. */
  readonly groundColor: readonly [number, number, number];
  /** Density of scattered foliage instances per square metre. */
  readonly foliageDensity: number;
  /** Foliage prototype ids, chosen per-instance by weight. */
  readonly foliage: readonly { readonly proto: string; readonly weight: number }[];
  /** Ambient loop. */
  readonly ambience: string;
  /** Footstep material. */
  readonly footstep: string;
  /** Is this biome traversable on foot? */
  readonly walkable: boolean;
  /** Does it require a water ride Pokémon? */
  readonly aquatic: boolean;
  /** Fog density multiplier applied on top of the weather system's value. */
  readonly fogScale: number;
  /** Danger tier 0–5; drives spawn levels and the music stinger the player hears. */
  readonly danger: number;
}

export const BIOMES: readonly BiomeDefinition[] = [
  {
    id: 'ocean', name: 'Open Ocean',
    heightRange: [-60, 0], moistureRange: [1, 1], tempRange: [22, 30], maxSlope: Math.PI,
    groundColor: [0.05, 0.22, 0.35], foliageDensity: 0, foliage: [],
    ambience: 'amb/ocean_surface', footstep: 'water', walkable: false, aquatic: true,
    fogScale: 0.6, danger: 1,
  },
  {
    id: 'deep-ocean', name: 'Deep Ocean',
    heightRange: [-400, -60], moistureRange: [1, 1], tempRange: [14, 24], maxSlope: Math.PI,
    groundColor: [0.02, 0.10, 0.22], foliageDensity: 0, foliage: [],
    ambience: 'amb/ocean_deep', footstep: 'water', walkable: false, aquatic: true,
    fogScale: 1.4, danger: 3,
  },
  {
    id: 'reef', name: 'Coral Reef',
    heightRange: [-14, -1], moistureRange: [1, 1], tempRange: [24, 31], maxSlope: Math.PI,
    groundColor: [0.28, 0.45, 0.42], foliageDensity: 1.6,
    foliage: [{ proto: 'coral_branch', weight: 5 }, { proto: 'coral_fan', weight: 3 }, { proto: 'sea_anemone', weight: 2 }],
    ambience: 'amb/reef', footstep: 'water', walkable: false, aquatic: true,
    fogScale: 0.9, danger: 1,
  },
  {
    id: 'beach', name: 'Beach',
    heightRange: [0, 4], moistureRange: [0.5, 1], tempRange: [24, 32], maxSlope: 0.22,
    groundColor: [0.86, 0.80, 0.62], foliageDensity: 0.12,
    foliage: [{ proto: 'palm_short', weight: 3 }, { proto: 'beach_grass', weight: 8 }, { proto: 'driftwood', weight: 1 }],
    ambience: 'amb/beach_waves', footstep: 'sand', walkable: true, aquatic: false,
    fogScale: 0.5, danger: 0,
  },
  {
    id: 'coastal-cliff', name: 'Coastal Cliff',
    heightRange: [4, 120], moistureRange: [0.4, 0.9], tempRange: [20, 30], maxSlope: 1.3,
    groundColor: [0.42, 0.40, 0.36], foliageDensity: 0.25,
    foliage: [{ proto: 'cliff_shrub', weight: 6 }, { proto: 'wind_grass', weight: 10 }],
    ambience: 'amb/cliff_wind', footstep: 'rock', walkable: true, aquatic: false,
    fogScale: 0.7, danger: 1,
  },
  {
    id: 'tropical-forest', name: 'Tropical Forest',
    heightRange: [2, 180], moistureRange: [0.55, 0.95], tempRange: [20, 31], maxSlope: 0.7,
    groundColor: [0.24, 0.34, 0.18], foliageDensity: 1.1,
    foliage: [
      { proto: 'palm_tall', weight: 4 }, { proto: 'fern_large', weight: 7 },
      { proto: 'hibiscus', weight: 3 }, { proto: 'jungle_grass', weight: 12 },
    ],
    ambience: 'amb/forest_tropical', footstep: 'grass', walkable: true, aquatic: false,
    fogScale: 0.9, danger: 1,
  },
  {
    id: 'dense-jungle', name: 'Dense Jungle',
    heightRange: [10, 260], moistureRange: [0.75, 1], tempRange: [22, 32], maxSlope: 0.85,
    groundColor: [0.16, 0.27, 0.13], foliageDensity: 2.4,
    foliage: [
      { proto: 'jungle_canopy', weight: 5 }, { proto: 'liana', weight: 6 },
      { proto: 'fern_giant', weight: 8 }, { proto: 'buttress_root', weight: 3 },
      { proto: 'jungle_grass', weight: 14 },
    ],
    ambience: 'amb/jungle_dense', footstep: 'foliage', walkable: true, aquatic: false,
    fogScale: 1.6, danger: 3,
  },
  {
    id: 'grassland', name: 'Grassland',
    heightRange: [1, 200], moistureRange: [0.3, 0.7], tempRange: [18, 30], maxSlope: 0.5,
    groundColor: [0.38, 0.46, 0.22], foliageDensity: 0.7,
    foliage: [{ proto: 'tall_grass', weight: 14 }, { proto: 'wildflower', weight: 4 }, { proto: 'lone_tree', weight: 1 }],
    ambience: 'amb/grassland', footstep: 'grass', walkable: true, aquatic: false,
    fogScale: 0.6, danger: 1,
  },
  {
    id: 'meadow', name: 'Flower Meadow',
    heightRange: [4, 160], moistureRange: [0.45, 0.8], tempRange: [18, 28], maxSlope: 0.4,
    groundColor: [0.42, 0.52, 0.26], foliageDensity: 1.3,
    foliage: [{ proto: 'wildflower', weight: 16 }, { proto: 'tall_grass', weight: 8 }, { proto: 'flower_cluster', weight: 6 }],
    ambience: 'amb/meadow', footstep: 'grass', walkable: true, aquatic: false,
    fogScale: 0.5, danger: 0,
  },
  {
    id: 'wetland', name: 'Wetland',
    heightRange: [0, 30], moistureRange: [0.85, 1], tempRange: [20, 30], maxSlope: 0.2,
    groundColor: [0.28, 0.30, 0.20], foliageDensity: 1.0,
    foliage: [{ proto: 'reed', weight: 12 }, { proto: 'mangrove', weight: 4 }, { proto: 'lily_pad', weight: 5 }],
    ambience: 'amb/wetland', footstep: 'mud', walkable: true, aquatic: false,
    fogScale: 1.5, danger: 2,
  },
  {
    id: 'river', name: 'River',
    heightRange: [-6, 200], moistureRange: [1, 1], tempRange: [14, 28], maxSlope: 0.3,
    groundColor: [0.18, 0.34, 0.38], foliageDensity: 0.1,
    foliage: [{ proto: 'river_reed', weight: 6 }],
    ambience: 'amb/river', footstep: 'water', walkable: false, aquatic: true,
    fogScale: 0.8, danger: 1,
  },
  {
    id: 'lake', name: 'Lake',
    heightRange: [-30, 200], moistureRange: [1, 1], tempRange: [12, 28], maxSlope: Math.PI,
    groundColor: [0.14, 0.28, 0.34], foliageDensity: 0.05,
    foliage: [{ proto: 'lily_pad', weight: 8 }],
    ambience: 'amb/lake', footstep: 'water', walkable: false, aquatic: true,
    fogScale: 0.9, danger: 1,
  },
  {
    id: 'volcanic-slope', name: 'Volcanic Slope',
    heightRange: [60, 900], moistureRange: [0, 0.35], tempRange: [30, 55], maxSlope: 1.1,
    groundColor: [0.24, 0.18, 0.15], foliageDensity: 0.05,
    foliage: [{ proto: 'ash_shrub', weight: 4 }, { proto: 'obsidian_shard', weight: 3 }],
    ambience: 'amb/volcano_slope', footstep: 'ash', walkable: true, aquatic: false,
    fogScale: 1.3, danger: 3,
  },
  {
    id: 'lava-field', name: 'Lava Field',
    heightRange: [80, 900], moistureRange: [0, 0.15], tempRange: [55, 120], maxSlope: 0.6,
    groundColor: [0.14, 0.09, 0.08], foliageDensity: 0, foliage: [],
    ambience: 'amb/lava_field', footstep: 'stone_hot', walkable: true, aquatic: false,
    fogScale: 1.8, danger: 4,
  },
  {
    id: 'lava-cave', name: 'Lava Cave',
    heightRange: [-200, 600], moistureRange: [0, 0.2], tempRange: [50, 130], maxSlope: Math.PI,
    groundColor: [0.12, 0.07, 0.06], foliageDensity: 0, foliage: [],
    ambience: 'amb/lava_cave', footstep: 'stone_hot', walkable: true, aquatic: false,
    fogScale: 2.2, danger: 4,
  },
  {
    id: 'cave', name: 'Cave',
    heightRange: [-300, 800], moistureRange: [0.3, 0.9], tempRange: [12, 22], maxSlope: Math.PI,
    groundColor: [0.20, 0.19, 0.18], foliageDensity: 0.08,
    foliage: [{ proto: 'cave_moss', weight: 6 }, { proto: 'stalagmite', weight: 4 }],
    ambience: 'amb/cave', footstep: 'stone', walkable: true, aquatic: false,
    fogScale: 2.0, danger: 2,
  },
  {
    id: 'crystal-cave', name: 'Crystal Cave',
    heightRange: [-300, 500], moistureRange: [0.2, 0.7], tempRange: [10, 20], maxSlope: Math.PI,
    groundColor: [0.22, 0.24, 0.32], foliageDensity: 0.3,
    foliage: [{ proto: 'crystal_cluster', weight: 8 }, { proto: 'crystal_spire', weight: 3 }],
    ambience: 'amb/cave_crystal', footstep: 'crystal', walkable: true, aquatic: false,
    fogScale: 1.6, danger: 3,
  },
  {
    id: 'desert', name: 'Desert',
    heightRange: [10, 300], moistureRange: [0, 0.2], tempRange: [28, 48], maxSlope: 0.45,
    groundColor: [0.72, 0.60, 0.42], foliageDensity: 0.04,
    foliage: [{ proto: 'desert_scrub', weight: 5 }, { proto: 'cactus', weight: 2 }, { proto: 'bleached_bone', weight: 1 }],
    ambience: 'amb/desert', footstep: 'sand', walkable: true, aquatic: false,
    fogScale: 0.9, danger: 3,
  },
  {
    id: 'badlands', name: 'Badlands',
    heightRange: [20, 400], moistureRange: [0, 0.3], tempRange: [22, 42], maxSlope: 0.9,
    groundColor: [0.52, 0.38, 0.28], foliageDensity: 0.06,
    foliage: [{ proto: 'dead_tree', weight: 2 }, { proto: 'desert_scrub', weight: 6 }],
    ambience: 'amb/badlands', footstep: 'gravel', walkable: true, aquatic: false,
    fogScale: 1.1, danger: 3,
  },
  {
    id: 'canyon', name: 'Canyon',
    heightRange: [-40, 500], moistureRange: [0.1, 0.5], tempRange: [16, 36], maxSlope: 1.4,
    groundColor: [0.48, 0.32, 0.24], foliageDensity: 0.15,
    foliage: [{ proto: 'canyon_shrub', weight: 6 }, { proto: 'hardy_grass', weight: 8 }],
    ambience: 'amb/canyon_wind', footstep: 'gravel', walkable: true, aquatic: false,
    fogScale: 1.0, danger: 4,
  },
  {
    id: 'highland', name: 'Highland',
    heightRange: [300, 900], moistureRange: [0.3, 0.8], tempRange: [4, 18], maxSlope: 0.8,
    groundColor: [0.32, 0.36, 0.26], foliageDensity: 0.4,
    foliage: [{ proto: 'hardy_grass', weight: 12 }, { proto: 'highland_pine', weight: 3 }],
    ambience: 'amb/highland', footstep: 'grass', walkable: true, aquatic: false,
    fogScale: 1.2, danger: 3,
  },
  {
    id: 'alpine', name: 'Alpine',
    heightRange: [800, 1600], moistureRange: [0.2, 0.7], tempRange: [-8, 8], maxSlope: 1.0,
    groundColor: [0.42, 0.42, 0.44], foliageDensity: 0.1,
    foliage: [{ proto: 'alpine_shrub', weight: 4 }, { proto: 'rock_scatter', weight: 8 }],
    ambience: 'amb/alpine_wind', footstep: 'gravel', walkable: true, aquatic: false,
    fogScale: 1.3, danger: 4,
  },
  {
    id: 'snowfield', name: 'Snowfield',
    heightRange: [1100, 2400], moistureRange: [0.3, 0.9], tempRange: [-25, 2], maxSlope: 0.9,
    groundColor: [0.88, 0.91, 0.96], foliageDensity: 0.03,
    foliage: [{ proto: 'snow_rock', weight: 5 }, { proto: 'ice_spike', weight: 2 }],
    ambience: 'amb/snowfield', footstep: 'snow', walkable: true, aquatic: false,
    fogScale: 1.7, danger: 4,
  },
  {
    id: 'ruins', name: 'Ancient Ruins',
    heightRange: [0, 900], moistureRange: [0.1, 0.9], tempRange: [5, 35], maxSlope: 0.7,
    groundColor: [0.46, 0.44, 0.38], foliageDensity: 0.3,
    foliage: [{ proto: 'ruin_vine', weight: 7 }, { proto: 'broken_pillar', weight: 3 }, { proto: 'moss_patch', weight: 5 }],
    ambience: 'amb/ruins', footstep: 'stone', walkable: true, aquatic: false,
    fogScale: 1.2, danger: 3,
  },
  {
    id: 'town', name: 'Town',
    heightRange: [0, 300], moistureRange: [0.2, 0.9], tempRange: [14, 32], maxSlope: 0.3,
    groundColor: [0.55, 0.50, 0.45], foliageDensity: 0.2,
    foliage: [{ proto: 'town_palm', weight: 4 }, { proto: 'planter', weight: 6 }],
    ambience: 'amb/town_day', footstep: 'pavement', walkable: true, aquatic: false,
    fogScale: 0.5, danger: 0,
  },
  {
    id: 'city', name: 'City',
    heightRange: [0, 200], moistureRange: [0.2, 0.8], tempRange: [14, 32], maxSlope: 0.2,
    groundColor: [0.42, 0.42, 0.44], foliageDensity: 0.1,
    foliage: [{ proto: 'street_tree', weight: 5 }, { proto: 'planter', weight: 4 }],
    ambience: 'amb/city', footstep: 'pavement', walkable: true, aquatic: false,
    fogScale: 0.6, danger: 0,
  },
  {
    id: 'facility', name: 'Facility',
    heightRange: [-200, 200], moistureRange: [0, 0.5], tempRange: [18, 24], maxSlope: 0.1,
    groundColor: [0.78, 0.80, 0.82], foliageDensity: 0, foliage: [],
    ambience: 'amb/facility_hum', footstep: 'metal', walkable: true, aquatic: false,
    fogScale: 0.3, danger: 2,
  },
  {
    id: 'ultra-space', name: 'Ultra Space',
    heightRange: [-1000, 1000], moistureRange: [0, 1], tempRange: [-50, 100], maxSlope: Math.PI,
    groundColor: [0.30, 0.18, 0.42], foliageDensity: 0.2,
    foliage: [{ proto: 'ultra_crystal', weight: 6 }, { proto: 'ultra_spire', weight: 3 }],
    ambience: 'amb/ultra_space', footstep: 'alien', walkable: true, aquatic: false,
    fogScale: 2.5, danger: 5,
  },
];

const biomeById = new Map(BIOMES.map((b) => [b.id, b]));

export function getBiome(id: BiomeId): BiomeDefinition {
  const b = biomeById.get(id);
  if (!b) throw new Error(`Unknown biome "${id}".`);
  return b;
}

export function allBiomes(): readonly BiomeDefinition[] {
  return BIOMES;
}
