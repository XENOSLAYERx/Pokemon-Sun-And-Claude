/**
 * @alola/battle — deterministic battle simulation.
 *
 * Pure function from (state, actions, seed) to (state, events). The same code
 * runs on the client for prediction and on the server for authority; a battle
 * is stored as a seed plus an input log rather than a state dump.
 */
export {
  createField, activePokemon, opposingSides, opponentsOf, sideHasFighters, emptyStages,
} from './engine/state.ts';
export type {
  BattleState, BattlePokemon, BattleSide, BattleField, BattleArena,
  BattleAction, BattleEvent, BattleFormat, StatStages, MoveSlot,
} from './engine/state.ts';

export { BattleEngine, makeBattlePokemon } from './engine/engine.ts';
export type { EngineOptions } from './engine/engine.ts';

export {
  calculateDamage, accuracyCheck, effectiveStat, effectiveSpeed,
  stageMultiplier, accuracyStageMultiplier, sortByTurnOrder,
  critChance, rollCritical, computeStat, catchProbability,
  MAX_STAGE, MIN_STAGE,
} from './calc/damage.ts';
export type { DamageContext, DamageResult, OrderEntry } from './calc/damage.ts';

export {
  registerTotem, clearTotemRegistry, totemDefinitionFor,
  applyTotemAura, applyTotemPhases, totemEncounterFor, totemHpMultiplier,
} from './totem/totem.ts';
export type { TotemEncounter } from './totem/totem.ts';

export { BattleAi } from './ai/trainer-ai.ts';
export type { AiDifficulty, AiConfig, ScoredAction } from './ai/trainer-ai.ts';

export {
  generateArena, surfaceForBiome, cameraRigFor,
  resolveEnvironmentReactions, musicFor,
} from './arena/arena.ts';
export type { TerrainProbe, ArenaRequest, CameraRig } from './arena/arena.ts';

export { evaluatePose, buildCinematic, beatAt, timeScaleAt, shakeAt } from './zmove/cinematic.ts';
export type { PoseInput, PoseResult, ZMoveCinematic, ScheduledBeat } from './zmove/cinematic.ts';
