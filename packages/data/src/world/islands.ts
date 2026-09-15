/**
 * Island definitions — the macro layout of Alola.
 *
 * World space is metres, with the origin at the centre of the archipelago.
 * Each island declares a centre, a radius and a set of terrain "features"
 * that the generator composites into the heightfield. The islands are
 * deliberately far enough apart that ocean travel between them is a real
 * journey (2–6 minutes on a Sharpedo), but close enough that the next island
 * is always visible on the horizon — the player should never feel adrift.
 *
 * Scale note: the original games' Melemele reads as roughly 1.5km across.
 * Here it is 6km, with Ula'ula at 11km. That is the "significantly larger"
 * requirement made concrete — and it is the number the streaming budget,
 * traversal speeds and quest pacing are all derived from.
 */
import type { BiomeId } from './biomes.ts';

/** A terrain feature composited into the heightfield. */
export interface TerrainFeature {
  readonly kind:
    | 'cone'        // Volcano / mountain: radial falloff from a peak.
    | 'ridge'       // Elongated ridgeline between two points.
    | 'plateau'     // Flat raised area with steep sides.
    | 'basin'       // Depression — craters, calderas, lakebeds.
    | 'canyon'      // Carved channel following a path.
    | 'dune'        // Rolling sand.
    | 'flat';       // Level ground for towns.
  /** Local position relative to the island centre, in metres. */
  readonly x: number;
  readonly z: number;
  /** Peak height contribution in metres (negative for basins). */
  readonly height: number;
  /** Radius of influence in metres. */
  readonly radius: number;
  /** For ridges and canyons: the end point. */
  readonly x2?: number;
  readonly z2?: number;
  /** Falloff sharpness. 1 = linear, 2 = smooth, 0.5 = plateau-like. */
  readonly falloff?: number;
  /** Biome forced within this feature, overriding climate classification. */
  readonly biome?: BiomeId;
}

export interface SettlementDefinition {
  readonly id: string;
  readonly name: string;
  /** Local coordinates relative to island centre. */
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly kind: 'town' | 'city' | 'village' | 'facility' | 'resort';
  /** Population drives NPC schedule density and ambient crowd audio. */
  readonly population: number;
  readonly services: readonly ('pokecenter' | 'shop' | 'clothing' | 'salon' | 'restaurant' | 'lab' | 'dock' | 'airstrip')[];
}

export interface PointOfInterest {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly kind: 'trial' | 'ruin' | 'legendary' | 'cave' | 'vista' | 'dungeon' | 'landmark' | 'ultra-site';
  /** Recommended party level. */
  readonly level: number;
  readonly description: string;
}

export interface IslandDefinition {
  readonly id: string;
  readonly name: string;
  /** World-space centre in metres. */
  readonly centerX: number;
  readonly centerZ: number;
  /** Island radius in metres — where the landmass falls to sea level. */
  readonly radius: number;
  /** Base landmass elevation before features, in metres. */
  readonly baseHeight: number;
  /** Climate: mean temperature at sea level, in °C. */
  readonly baseTemp: number;
  /** Climate: base moisture, 0–1. */
  readonly baseMoisture: number;
  /** Prevailing wind direction, radians. Drives weather fronts and ocean swell. */
  readonly windDirection: number;
  /** Progression order. Gates recommended levels and story flags. */
  readonly order: number;
  readonly levelRange: readonly [number, number];
  readonly features: readonly TerrainFeature[];
  readonly settlements: readonly SettlementDefinition[];
  readonly pois: readonly PointOfInterest[];
  /** Guardian deity species id. */
  readonly guardian: string;
  readonly musicTheme: string;
  readonly description: string;
}

export const ISLANDS: readonly IslandDefinition[] = [
  {
    id: 'melemele', name: 'Melemele Island',
    centerX: -11000, centerZ: -7000, radius: 3000,
    baseHeight: 24, baseTemp: 27, baseMoisture: 0.62,
    windDirection: 0.9, order: 1, levelRange: [2, 18],
    features: [
      { kind: 'cone', x: 400, z: -300, height: 520, radius: 1500, falloff: 1.7 },
      { kind: 'ridge', x: -900, z: 600, x2: 700, z2: 1100, height: 180, radius: 500 },
      { kind: 'flat', x: -1400, z: -900, height: 6, radius: 700, biome: 'town' },
      { kind: 'flat', x: 900, z: 1500, height: 10, radius: 450, biome: 'town' },
      { kind: 'basin', x: 1500, z: -1200, height: -40, radius: 600, biome: 'cave' },
      { kind: 'plateau', x: -200, z: -1700, height: 140, radius: 550, falloff: 0.6, biome: 'ruins' },
      { kind: 'dune', x: -2100, z: 1400, height: 12, radius: 800, biome: 'beach' },
    ],
    settlements: [
      {
        id: 'iki-town', name: 'Iki Town', x: -1400, z: -900, radius: 260, kind: 'village',
        population: 180, services: ['pokecenter', 'shop'],
      },
      {
        id: 'hauoli-city', name: "Hau'oli City", x: 900, z: 1500, radius: 620, kind: 'city',
        population: 5400, services: ['pokecenter', 'shop', 'clothing', 'salon', 'restaurant', 'dock', 'airstrip'],
      },
    ],
    pois: [
      {
        id: 'verdant-cavern', name: 'Verdant Cavern', x: 1500, z: -1200, kind: 'trial', level: 10,
        description: "Ilima's trial. A burrow network where a Totem Gumshoos waits at the deepest chamber.",
      },
      {
        id: 'ruins-of-conflict', name: 'Ruins of Conflict', x: -200, z: -1700, kind: 'legendary', level: 20,
        description: 'Tapu Koko’s shrine, reached by a lightning-puzzle chain up the plateau face.',
      },
      {
        id: 'ten-carat-hill', name: 'Ten Carat Hill', x: 1900, z: 400, kind: 'cave', level: 14,
        description: 'A crystal-veined cavern. The Farthest Hollow opens only to a player with a ride Pokémon.',
      },
      {
        id: 'kala-e-bay', name: "Kala'e Bay", x: -2100, z: 1400, kind: 'vista', level: 8,
        description: 'A hidden beach beneath the cliffs. Wingull colonies nest on the stacks offshore.',
      },
      {
        id: 'mahalo-trail', name: 'Mahalo Trail', x: -700, z: -1500, kind: 'landmark', level: 5,
        description: 'The pilgrimage path to the Plank Bridge, where the story begins.',
      },
    ],
    guardian: 'TAPU_KOKO', musicTheme: 'bgm/melemele',
    description: 'The starter island. Tropical forest, surf beaches and a dormant cone at its heart.',
  },
  {
    id: 'akala', name: 'Akala Island',
    centerX: -2000, centerZ: -2000, radius: 4200,
    baseHeight: 30, baseTemp: 29, baseMoisture: 0.74,
    windDirection: 1.3, order: 2, levelRange: [16, 32],
    features: [
      { kind: 'cone', x: 1100, z: -800, height: 1180, radius: 2000, falloff: 1.9, biome: 'volcanic-slope' },
      { kind: 'basin', x: 1100, z: -800, height: -180, radius: 380, biome: 'lava-field' },
      { kind: 'ridge', x: -1800, z: 900, x2: 200, z2: 1900, height: 340, radius: 700 },
      { kind: 'plateau', x: -2100, z: -1400, height: 210, radius: 900, falloff: 0.7, biome: 'dense-jungle' },
      { kind: 'flat', x: -2600, z: 1600, height: 8, radius: 620, biome: 'town' },
      { kind: 'flat', x: 1800, z: 2100, height: 12, radius: 540, biome: 'town' },
      { kind: 'basin', x: -600, z: 2400, height: -25, radius: 700, biome: 'lake' },
      { kind: 'plateau', x: 2400, z: -2000, height: 380, radius: 500, falloff: 0.5, biome: 'ruins' },
    ],
    settlements: [
      {
        id: 'heahea-city', name: 'Heahea City', x: -2600, z: 1600, radius: 560, kind: 'resort',
        population: 3200, services: ['pokecenter', 'shop', 'clothing', 'salon', 'restaurant', 'dock'],
      },
      {
        id: 'paniola-town', name: 'Paniola Town', x: 400, z: 1700, radius: 380, kind: 'town',
        population: 640, services: ['pokecenter', 'shop', 'restaurant'],
      },
      {
        id: 'konikoni-city', name: 'Konikoni City', x: 1800, z: 2100, radius: 480, kind: 'city',
        population: 2100, services: ['pokecenter', 'shop', 'clothing', 'restaurant', 'dock'],
      },
    ],
    pois: [
      {
        id: 'brooklet-hill', name: 'Brooklet Hill', x: -600, z: 2400, kind: 'trial', level: 20,
        description: "Lana's trial. Cascading pools where a Totem Wishiwashi schools into something vast.",
      },
      {
        id: 'lush-jungle', name: 'Lush Jungle', x: -2100, z: -1400, kind: 'trial', level: 22,
        description: "Mallow's trial. Ingredient-gathering under canopy, ending with a Totem Lurantis.",
      },
      {
        id: 'wela-volcano', name: 'Wela Volcano Park', x: 1100, z: -800, kind: 'trial', level: 24,
        description: "Kiawe's trial. Dance-sequence recall on the caldera rim, then a Totem Marowak.",
      },
      {
        id: 'ruins-of-life', name: 'Ruins of Life', x: 2400, z: -2000, kind: 'legendary', level: 34,
        description: 'Tapu Lele’s shrine above the lava fields, reached only after the volcano trial.',
      },
      {
        id: 'diglett-tunnel', name: "Diglett's Tunnel", x: 2600, z: 600, kind: 'cave', level: 18,
        description: 'A boring tunnel that punches clean through the eastern ridge.',
      },
      {
        id: 'memorial-hill', name: 'Memorial Hill', x: 2200, z: 1500, kind: 'landmark', level: 21,
        description: 'Graves of Pokémon and their trainers. Ghost-types gather here after dark.',
      },
    ],
    guardian: 'TAPU_LELE', musicTheme: 'bgm/akala',
    description: 'The largest volcanic island. Jungle on its western flank, an active caldera at its centre.',
  },
  {
    id: 'ulaula', name: "Ula'ula Island",
    centerX: 10000, centerZ: -4000, radius: 5500,
    baseHeight: 26, baseTemp: 24, baseMoisture: 0.42,
    windDirection: 2.2, order: 3, levelRange: [30, 48],
    features: [
      { kind: 'cone', x: 1600, z: -2600, height: 2050, radius: 2600, falloff: 2.1, biome: 'snowfield' },
      { kind: 'dune', x: -2200, z: 900, height: 45, radius: 1900, biome: 'desert' },
      { kind: 'ridge', x: -400, z: -1200, x2: 1400, z2: 600, height: 420, radius: 800 },
      { kind: 'flat', x: 2600, z: 1900, height: 10, radius: 900, biome: 'city' },
      { kind: 'flat', x: -3400, z: -1600, height: 14, radius: 480, biome: 'town' },
      { kind: 'plateau', x: -1400, z: -2800, height: 640, radius: 620, falloff: 0.6 },
      { kind: 'basin', x: 3400, z: -900, height: -60, radius: 520, biome: 'facility' },
      { kind: 'plateau', x: -2900, z: 2300, height: 180, radius: 460, falloff: 0.5, biome: 'ruins' },
    ],
    settlements: [
      {
        id: 'malie-city', name: 'Malie City', x: 2600, z: 1900, radius: 840, kind: 'city',
        population: 7800, services: ['pokecenter', 'shop', 'clothing', 'salon', 'restaurant', 'lab', 'dock'],
      },
      {
        id: 'tapu-village', name: 'Tapu Village', x: -400, z: -2400, radius: 300, kind: 'village',
        population: 120, services: ['pokecenter', 'shop'],
      },
      {
        id: 'po-town', name: 'Po Town', x: -3400, z: -1600, radius: 420, kind: 'town',
        population: 90, services: [],
      },
    ],
    pois: [
      {
        id: 'hokulani-observatory', name: 'Hokulani Observatory', x: -1400, z: -2800, kind: 'trial', level: 34,
        description: "Sophocles' trial. A power failure at altitude, ending with a Totem Vikavolt.",
      },
      {
        id: 'thrifty-megamart', name: 'Thrifty Megamart', x: -2900, z: 1100, kind: 'trial', level: 38,
        description: "Acerola's trial. An abandoned superstore where a Totem Mimikyu plays with the lights.",
      },
      {
        id: 'ruins-of-abundance', name: 'Ruins of Abundance', x: -2900, z: 2300, kind: 'legendary', level: 50,
        description: 'Tapu Bulu’s shrine at the desert’s edge, half-swallowed by growth it caused.',
      },
      {
        id: 'haina-desert', name: 'Haina Desert', x: -2200, z: 900, kind: 'dungeon', level: 36,
        description: 'A maze of shifting dunes. The route markers lie; the standing stones do not.',
      },
      {
        id: 'mount-lanakila', name: 'Mount Lanakila', x: 1600, z: -2600, kind: 'landmark', level: 52,
        description: 'Alola’s highest peak and the seat of its League. Snow above 1100 metres year-round.',
      },
      {
        id: 'ula-power-plant', name: "Ula'ula Power Plant", x: 3400, z: -900, kind: 'dungeon', level: 40,
        description: 'Xurkitree drain the grid here. Security has stopped filing reports.',
      },
      {
        id: 'ultra-site-north', name: 'Ultra Wormhole Site 01', x: 500, z: -3600, kind: 'ultra-site', level: 55,
        description: 'The first confirmed wormhole. Reality thins here when the aurora runs.',
      },
    ],
    guardian: 'TAPU_BULU', musicTheme: 'bgm/ulaula',
    description: 'The largest and most developed island: a real city, a desert, and Alola’s only snowline.',
  },
  {
    id: 'poni', name: 'Poni Island',
    centerX: 3000, centerZ: 9000, radius: 4600,
    // Poni is a high plateau cut by canyons, not a low island. The base height
    // has to exceed the deepest canyon carve or the interior floods.
    baseHeight: 280, baseTemp: 21, baseMoisture: 0.55,
    windDirection: 3.6, order: 4, levelRange: [45, 70],
    features: [
      { kind: 'canyon', x: -1200, z: -1600, x2: 1600, z2: 1800, height: -240, radius: 620, biome: 'canyon' },
      { kind: 'ridge', x: -2200, z: -600, x2: -600, z2: 2200, height: 780, radius: 900 },
      { kind: 'cone', x: 1900, z: -1900, height: 940, radius: 1500, falloff: 1.8 },
      { kind: 'plateau', x: 2400, z: 2200, height: 420, radius: 700, falloff: 0.6, biome: 'ruins' },
      { kind: 'flat', x: -2800, z: 1900, height: 8, radius: 380, biome: 'town' },
      { kind: 'basin', x: 0, z: 2900, height: -150, radius: 800, biome: 'wetland' },
      { kind: 'plateau', x: -1600, z: -2600, height: 560, radius: 540, falloff: 0.55, biome: 'highland' },
    ],
    settlements: [
      {
        id: 'seafolk-village', name: 'Seafolk Village', x: -2800, z: 1900, radius: 300, kind: 'village',
        population: 210, services: ['pokecenter', 'shop', 'restaurant', 'dock'],
      },
    ],
    pois: [
      {
        id: 'vast-poni-canyon', name: 'Vast Poni Canyon', x: 200, z: 0, kind: 'trial', level: 50,
        description: 'The final trial: no captain, no guidance, and a Totem Kommo-o at the top of the climb.',
      },
      {
        id: 'ruins-of-hope', name: 'Ruins of Hope', x: 2400, z: 2200, kind: 'legendary', level: 60,
        description: 'Tapu Fini’s shrine, permanently fogbound. The fog shows you things.',
      },
      {
        id: 'altar-of-the-sunne', name: 'Altar of the Sunne', x: 1900, z: -1900, kind: 'legendary', level: 62,
        description: 'Where Solgaleo is called. At dusk the stone circle aligns and the sky opens.',
      },
      {
        id: 'poni-meadow', name: 'Poni Meadow', x: 0, z: 2900, kind: 'vista', level: 54,
        description: 'A wetland meadow that blooms only when Tapu Fini’s mist rolls in.',
      },
      {
        id: 'exeggutor-island', name: 'Exeggutor Island', x: 3600, z: -800, kind: 'landmark', level: 48,
        description: 'A stack of rock crowded with eleven-metre palms that are not palms.',
      },
      {
        id: 'resolution-cave', name: 'Resolution Cave', x: -1600, z: -2600, kind: 'dungeon', level: 68,
        description: 'The deepest cave in Alola. Guzzlord has been sighted at the bottom.',
      },
    ],
    guardian: 'TAPU_FINI', musicTheme: 'bgm/poni',
    description: 'The wild frontier. Barely settled, deeply carved, and dangerous from the shoreline inward.',
  },
  {
    id: 'aether', name: 'Aether Paradise',
    centerX: -8000, centerZ: 4000, radius: 900,
    baseHeight: 4, baseTemp: 23, baseMoisture: 0.3,
    windDirection: 0, order: 5, levelRange: [28, 65],
    features: [
      { kind: 'flat', x: 0, z: 0, height: 4, radius: 900, falloff: 0.3, biome: 'facility' },
      { kind: 'basin', x: 0, z: 0, height: -60, radius: 420, biome: 'facility' },
      { kind: 'plateau', x: 0, z: -520, height: 28, radius: 300, falloff: 0.4, biome: 'facility' },
    ],
    settlements: [
      {
        id: 'aether-main', name: 'Aether Paradise', x: 0, z: 0, radius: 900, kind: 'facility',
        population: 340, services: ['pokecenter', 'shop', 'lab', 'dock'],
      },
    ],
    pois: [
      {
        id: 'conservation-area', name: 'Conservation Area', x: 0, z: -520, kind: 'landmark', level: 30,
        description: 'An artificial biodome. The Pokémon here were rescued, and none of them may leave.',
      },
      {
        id: 'secret-labs', name: 'Secret Labs B1–B3', x: 0, z: 0, kind: 'dungeon', level: 45,
        description: 'Below the waterline. Containment, research, and the cells Type: Null came from.',
      },
      {
        id: 'ub-containment', name: 'Ultra Beast Containment', x: 180, z: 120, kind: 'ultra-site', level: 60,
        description: 'Reinforced cells built for things that do not obey local physics. Two are empty.',
      },
    ],
    guardian: '', musicTheme: 'bgm/aether',
    description: 'A man-made island of white plastic and glass, and the only place in Alola with a basement.',
  },
];

const islandById = new Map(ISLANDS.map((i) => [i.id, i]));

export function getIsland(id: string): IslandDefinition {
  const i = islandById.get(id);
  if (!i) throw new Error(`Unknown island "${id}".`);
  return i;
}

export function allIslands(): readonly IslandDefinition[] {
  return ISLANDS;
}

/** Which island (if any) contains this world position? */
export function islandAt(worldX: number, worldZ: number): IslandDefinition | null {
  for (const island of ISLANDS) {
    const dx = worldX - island.centerX;
    const dz = worldZ - island.centerZ;
    if (dx * dx + dz * dz <= island.radius * island.radius) return island;
  }
  return null;
}

/** Nearest island and the distance to its shoreline — used by ocean navigation UI. */
export function nearestIsland(worldX: number, worldZ: number): { island: IslandDefinition; distance: number } {
  let best = ISLANDS[0];
  let bestDist = Infinity;
  for (const island of ISLANDS) {
    const dx = worldX - island.centerX;
    const dz = worldZ - island.centerZ;
    const d = Math.sqrt(dx * dx + dz * dz) - island.radius;
    if (d < bestDist) {
      bestDist = d;
      best = island;
    }
  }
  return { island: best, distance: bestDist };
}

/** Full archipelago bounds, used to size the ocean plane and the map screen. */
export function worldBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const i of ISLANDS) {
    minX = Math.min(minX, i.centerX - i.radius);
    maxX = Math.max(maxX, i.centerX + i.radius);
    minZ = Math.min(minZ, i.centerZ - i.radius);
    maxZ = Math.max(maxZ, i.centerZ + i.radius);
  }
  // Ocean margin so the player can sail past the outermost island.
  const margin = 4000;
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
}
