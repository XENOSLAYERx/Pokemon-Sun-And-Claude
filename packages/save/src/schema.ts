/**
 * Save file schema.
 *
 * Design rules this schema follows, learned the hard way by every long-lived
 * game:
 *
 * 1. **Version everything.** A save records the schema version it was written
 *    with. Migrations run in sequence to bring old saves forward. A player who
 *    stops for a year and comes back must not lose their save.
 *
 * 2. **Reference content by stable id, never by index.** Species are
 *    "PIKACHU", not dex slot 25; items are "ultra-ball", not inventory slot 4.
 *    Re-ordering the dex must never turn someone's Pikachu into a Raichu.
 *
 * 3. **Store the seed, not the world.** The world is regenerated from
 *    (worldSeed, position). We save what the player *changed*, which is a few
 *    kilobytes instead of a few hundred megabytes.
 *
 * 4. **Tolerate unknown content.** A save referencing a species removed in a
 *    patch must load with that entry dropped, not crash.
 */
import type { QuestJournalSnapshot } from '@alola/quest';

/** Bump on any breaking schema change and add a migration. */
export const CURRENT_SAVE_VERSION = 4;

export interface SavedPokemon {
  /** Stable species id. */
  species: string;
  form: number;
  nickname: string | null;
  level: number;
  exp: number;
  /** Personality value: every cosmetic and IV roll derives from this. */
  personality: number;
  shiny: boolean;
  alpha: boolean;
  gender: 'male' | 'female' | 'genderless';
  nature: string;
  ability: string;
  /** Held item id, or null. */
  item: string | null;
  moves: { id: string; pp: number }[];
  ivs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  currentHp: number;
  status: string;
  friendship: number;
  /** Where and when it was caught — shown on the summary screen. */
  metLocation: string;
  metLevel: number;
  metDate: number;
  /** Original trainer id, for trade tracking. */
  originalTrainer: string;
  /** Size variation, 0.82–1.55. */
  scale: number;
}

export interface SavedPlayer {
  id: string;
  name: string;
  /** Character creator output. Opaque to everything but the avatar system. */
  appearance: {
    bodyType: number;
    skinTone: number;
    hairStyle: number;
    hairColor: number;
    eyeShape: number;
    eyeColor: number;
    faceShape: number;
    features: number[];
  };
  outfit: {
    hat: string | null;
    top: string;
    bottom: string;
    shoes: string;
    bag: string;
    accessory: string | null;
    /** Per-slot colour indices. */
    colors: Record<string, number>;
  };
  money: number;
  /** Battle Points, for the endgame facilities. */
  battlePoints: number;
  position: { x: number; y: number; z: number };
  yaw: number;
  /** Island the player was last on. */
  island: string;
  playtimeSeconds: number;
  /** Ride Pokémon the player has registered to the pager. */
  registeredRides: string[];
  currentRide: string | null;
}

export interface SavedProgress {
  /** Story and unlock flags. */
  flags: string[];
  /** Trials completed, by id. */
  trialsCompleted: string[];
  /** Grand trials (kahuna battles) completed. */
  grandTrialsCompleted: string[];
  /** Z-Crystals owned. */
  zCrystals: string[];
  /** Pokédex: species id -> { seen, caught }. */
  pokedex: Record<string, { seen: boolean; caught: boolean; forms: number[] }>;
  /** Shiny encounter chains, for the hunting community. */
  chains: Record<string, number>;
}

export interface SavedWorld {
  /** The seed the entire world is generated from. Never changes for a save. */
  worldSeed: number;
  /** In-game seconds elapsed. */
  timeOfDay: number;
  /** Per-island weather snapshot. */
  weather: Record<string, { current: string; remaining: number }>;
  /** Ecosystem population levels: regionId -> speciesId -> level. */
  ecology: Record<string, Record<string, number>>;
  /** Persistent world modifications: opened doors, moved boulders, harvested nodes. */
  modifications: Record<string, number>;
  /** Locations discovered, for fast travel. */
  discovered: string[];
}

export interface SavedInventory {
  /** itemId -> count. */
  items: Record<string, number>;
  /** Key items are a separate list so they cannot be accidentally sold. */
  keyItems: string[];
}

export interface SaveFile {
  version: number;
  /** Unix ms. */
  savedAt: number;
  /** Build that wrote this save, for support diagnostics. */
  gameBuild: string;
  player: SavedPlayer;
  party: SavedPokemon[];
  /** Box storage, flattened with an explicit box index. */
  boxes: { box: number; slot: number; pokemon: SavedPokemon }[];
  inventory: SavedInventory;
  progress: SavedProgress;
  world: SavedWorld;
  quests: QuestJournalSnapshot;
  /** Integrity checksum over everything above. */
  checksum: string;
}

/** A save that has been read but not yet migrated. */
export interface RawSave {
  version: number;
  [key: string]: unknown;
}
