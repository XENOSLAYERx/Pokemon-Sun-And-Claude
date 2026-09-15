/**
 * @alola/ai — Pokémon behaviour.
 *
 * Architecture in one line: utility scoring picks the goal, a behaviour tree
 * executes it, steering moves the body, and memory makes it personal.
 */

// Behaviour trees
export {
  NodeStatus, action, condition, succeed, wait,
  sequence, selector, parallel,
  invert, alwaysSucceed, guard, timeout, repeat, throttle, traceTick,
} from './bt/tree.ts';
export type { BtNode, BtContext } from './bt/tree.ts';

// Utility
export {
  evaluateCurve, scoreGoal, selectGoal, scoreAll, emptyFacts,
} from './utility/scorer.ts';
export type {
  Goal, Consideration, ScoredGoal, UtilityFacts, ResponseCurve, CurveKind,
} from './utility/scorer.ts';
export {
  ALL_GOALS, getGoal,
  GOAL_FLEE, GOAL_ATTACK, GOAL_DEFEND_TERRITORY, GOAL_PROTECT,
  GOAL_HUNT, GOAL_FORAGE, GOAL_SLEEP, GOAL_REST,
  GOAL_INVESTIGATE, GOAL_GREET, GOAL_REGROUP, GOAL_RETURN_HOME,
  GOAL_WANDER, GOAL_PLAY,
} from './utility/goals.ts';

// Needs and memory
export {
  createNeeds, needsConfigFor, updateNeeds, applyFear, applyAggression, feed, dominantNeed,
} from './memory/needs.ts';
export type { Needs, NeedsConfig } from './memory/needs.ts';
export { AgentMemory, dispositionFor } from './memory/memory.ts';
export type { MemoryEpisode, MemoryKind, Relationship, Disposition, MemoryOptions } from './memory/memory.ts';

// Perception
export { perceive, canSee, visibilityFrom } from './perception/senses.ts';
export type { Percept, PerceptionResult, PerceivableAgent, PerceivedKind, PerceiveOptions } from './perception/senses.ts';

// Steering and flocking
export {
  flock, seek, flee, arrive, pursue, evade, wander, avoid,
  containWithin, combineSteering, MAX_FLOCK_NEIGHBOURS,
} from './flock/boids.ts';
export type { Boid, FlockWeights, WanderState } from './flock/boids.ts';

// Profiles
export { profileFor, biasedGoalsFor, willFlee, isHostile, allGoals, documentedProfiles } from './profiles/profiles.ts';
export type { AiProfile } from './profiles/profiles.ts';

// Brain
export { PokemonBrain, BrainLod, lodForDistance, normalisedDistance } from './ecosystem/brain.ts';
export type { BrainState, BrainWorldView } from './ecosystem/brain.ts';
