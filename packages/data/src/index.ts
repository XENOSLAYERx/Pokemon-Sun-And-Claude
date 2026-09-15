/**
 * @alola/data — the content layer.
 *
 * Pure data plus the pure functions that interpret it. No simulation state,
 * no side effects: every export here is safe to import from a Worker, the
 * server, the content validator or a test.
 */

// Types
export {
  PokemonTypes,
  TYPE_COUNT,
  typeIndex,
  effectiveness,
  effectivenessAgainst,
  effectivenessMessage,
  defensiveProfile,
  weaknessesOf,
  resistancesOf,
} from './types.ts';
export type { PokemonType } from './types.ts';

// Species
export type {
  SpeciesDefinition,
  SpeciesRuntime,
  BaseStats,
  StatKey,
  EggGroup,
  MovementClass,
  TemperamentClass,
} from './species/schema.ts';
export { makeRuntime } from './species/schema.ts';
export { SPECIES_LIST } from './species/dex.ts';
export {
  getSpecies,
  tryGetSpecies,
  hasSpecies,
  getSpeciesByDex,
  allSpecies,
  speciesOfType,
  speciesWithMovement,
  speciesWithTemperament,
  predatorsFor,
  rideSpecies,
  isActiveAtHour,
  SPECIES_COUNT,
} from './species/registry.ts';

// Moves
export type {
  MoveDefinition,
  MoveCategory,
  MoveTarget,
  MoveFlags,
  SecondaryEffect,
  StatusCondition,
} from './moves/schema.ts';
export { MOVE_LIST } from './moves/moves.ts';
export { getMove, tryGetMove, allMoves, movesOfType, MOVE_COUNT } from './moves/registry.ts';
export {
  ZMOVE_LIST,
  getZMove,
  zMoveForCrystal,
  zMoveDuration,
  allZMoves,
} from './moves/zmoves.ts';
export type { ZMoveDefinition, ZMoveBeat, ZEnvironmentReaction } from './moves/zmoves.ts';

// World
export { BiomeIds, BIOMES, getBiome, allBiomes } from './world/biomes.ts';
export type { BiomeId, BiomeDefinition } from './world/biomes.ts';
export {
  ISLANDS,
  getIsland,
  allIslands,
  islandAt,
  nearestIsland,
  worldBounds,
} from './world/islands.ts';
export type {
  IslandDefinition,
  TerrainFeature,
  SettlementDefinition,
  PointOfInterest,
} from './world/islands.ts';

// Spawning
export {
  SPAWN_TABLE,
  scoreSpawnEntry,
  entriesForBiome,
  eligibleSpawns,
} from './tables/spawns.ts';
export type { SpawnEntry, SpawnConditions, WeatherId } from './tables/spawns.ts';

// Items
export { ITEMS, getItem, tryGetItem, itemsOfCategory, allItems } from './items/items.ts';
export type { ItemDefinition, ItemCategory } from './items/items.ts';

// Trials & quests
export { TRIALS, getTrial, trialsForIsland, allTrials } from './quests/trials.ts';
export type { TrialDefinition, TrialStage, TrialStageKind, TotemDefinition } from './quests/trials.ts';
export {
  QUESTS,
  getQuest,
  tryGetQuest,
  questsForIsland,
  questsOfCategory,
  allQuests,
  FACTIONS,
} from './quests/quests.ts';
export type {
  QuestDefinition,
  QuestObjective,
  QuestObjectiveKind,
  QuestReward,
  QuestCategory,
  FactionId,
} from './quests/quests.ts';
