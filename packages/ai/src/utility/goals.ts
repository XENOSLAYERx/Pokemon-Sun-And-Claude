/**
 * The goal library.
 *
 * These are the behaviours every wild Pokémon can choose between. A species'
 * profile selects a subset and adjusts priorities; the considerations below
 * are shared, which is what keeps behaviour coherent across the whole dex
 * instead of every species being a special case.
 */
import type { Goal } from './scorer.ts';

/** Flee from a perceived threat. */
export const GOAL_FLEE: Goal = {
  name: 'flee',
  priority: 1.6,
  commitment: 0.25,
  considerations: [
    { name: 'fear', input: (f) => f.fear, curve: { kind: 'quadratic', m: 0.7 } },
    // Closer threats matter far more. threatDistance is 1 when nothing is near.
    { name: 'threat-proximity', input: (f) => 1 - f.threatDistance, curve: { kind: 'logistic', c: 0.45, m: 1.2 } },
    { name: 'threat-level', input: (f) => f.threatLevel, curve: { kind: 'linear' } },
  ],
};

/** Stand and fight. Competes directly with flee. */
export const GOAL_ATTACK: Goal = {
  name: 'attack',
  priority: 1.5,
  commitment: 0.3,
  considerations: [
    { name: 'aggression', input: (f) => f.aggression, curve: { kind: 'logistic', c: 0.45 } },
    { name: 'target-near', input: (f) => 1 - f.threatDistance, curve: { kind: 'logistic', c: 0.5 } },
    // Will not fight when badly hurt.
    { name: 'health', input: (f) => f.healthFraction, curve: { kind: 'logistic', c: 0.3 } },
    // Will not fight when exhausted.
    { name: 'stamina', input: (f) => f.fatigue, curve: { kind: 'inverse' } },
    // Fear suppresses fighting — but aggression can overcome it.
    { name: 'nerve', input: (f) => f.fear, curve: { kind: 'inverse-quadratic', m: 0.6 } },
  ],
};

/** Defend territory: move to intercept an intruder without full commitment. */
export const GOAL_DEFEND_TERRITORY: Goal = {
  name: 'defend-territory',
  priority: 1.35,
  commitment: 0.2,
  considerations: [
    { name: 'in-territory', input: (f) => f.inTerritory, curve: { kind: 'threshold', c: 0.15 } },
    { name: 'intruder', input: (f) => 1 - Math.min(f.playerDistance, f.threatDistance), curve: { kind: 'logistic', c: 0.4 } },
    { name: 'aggression', input: (f) => f.aggression, curve: { kind: 'linear' } },
    { name: 'health', input: (f) => f.healthFraction, curve: { kind: 'logistic', c: 0.25 } },
  ],
};

/** Protect a pack-mate or young that is under threat. */
export const GOAL_PROTECT: Goal = {
  name: 'protect',
  priority: 1.7,
  commitment: 0.35,
  considerations: [
    { name: 'packmate-near', input: (f) => 1 - f.packmateDistance, curve: { kind: 'logistic', c: 0.5 } },
    { name: 'threat-present', input: (f) => f.threatLevel, curve: { kind: 'logistic', c: 0.2 } },
    { name: 'sociability', input: (f) => f.sociability, curve: { kind: 'linear' } },
    { name: 'health', input: (f) => f.healthFraction, curve: { kind: 'logistic', c: 0.2 } },
  ],
};

/** Hunt prey. */
export const GOAL_HUNT: Goal = {
  name: 'hunt',
  priority: 1.2,
  commitment: 0.28,
  considerations: [
    { name: 'hunger', input: (f) => f.hunger, curve: { kind: 'logistic', c: 0.45 } },
    { name: 'prey-available', input: (f) => 1 - f.preyDistance, curve: { kind: 'logistic', c: 0.35 } },
    { name: 'stamina', input: (f) => f.fatigue, curve: { kind: 'inverse', m: 0.8 } },
    { name: 'not-afraid', input: (f) => f.fear, curve: { kind: 'inverse-quadratic' } },
    { name: 'awake', input: (f) => f.isActiveHour, curve: { kind: 'threshold', c: 0.5 } },
  ],
};

/** Forage for plants, berries, minerals — the herbivore equivalent of hunting. */
export const GOAL_FORAGE: Goal = {
  name: 'forage',
  priority: 1.0,
  commitment: 0.15,
  considerations: [
    { name: 'hunger', input: (f) => f.hunger, curve: { kind: 'logistic', c: 0.4 } },
    { name: 'safe', input: (f) => f.fear, curve: { kind: 'inverse-quadratic' } },
    { name: 'awake', input: (f) => f.isActiveHour, curve: { kind: 'threshold', c: 0.5 } },
    { name: 'rested', input: (f) => f.fatigue, curve: { kind: 'inverse', m: 0.7 } },
  ],
};

/** Sleep. */
export const GOAL_SLEEP: Goal = {
  name: 'sleep',
  priority: 1.1,
  commitment: 0.4,
  considerations: [
    { name: 'drowsy', input: (f) => f.drowsiness, curve: { kind: 'logistic', c: 0.4 } },
    { name: 'off-hours', input: (f) => 1 - f.isActiveHour, curve: { kind: 'linear' } },
    // Will not sleep while afraid, no matter how tired.
    { name: 'safe', input: (f) => f.fear, curve: { kind: 'inverse-quadratic', m: 1.4 } },
    { name: 'no-threat', input: (f) => f.threatDistance, curve: { kind: 'logistic', c: 0.55 } },
  ],
};

/** Rest while awake — recover fatigue without fully sleeping. */
export const GOAL_REST: Goal = {
  name: 'rest',
  priority: 0.8,
  commitment: 0.18,
  considerations: [
    { name: 'tired', input: (f) => f.fatigue, curve: { kind: 'logistic', c: 0.55 } },
    { name: 'safe', input: (f) => f.fear, curve: { kind: 'inverse-quadratic' } },
    { name: 'fed', input: (f) => f.hunger, curve: { kind: 'inverse', m: 0.8 } },
  ],
};

/** Approach something novel — the player, a thrown item, an odd sound. */
export const GOAL_INVESTIGATE: Goal = {
  name: 'investigate',
  priority: 1.0,
  commitment: 0.16,
  considerations: [
    { name: 'curiosity', input: (f) => f.curiosity, curve: { kind: 'logistic', c: 0.4 } },
    // Bell curve: too far and it is not interesting, too close and it is
    // already resolved. Interest peaks at a middle distance.
    { name: 'interest-range', input: (f) => f.playerDistance, curve: { kind: 'bell', c: 0.45, m: 0.9 } },
    { name: 'unafraid', input: (f) => f.fear, curve: { kind: 'inverse-quadratic', m: 1.2 } },
    { name: 'awake', input: (f) => f.isActiveHour, curve: { kind: 'threshold', c: 0.5 } },
  ],
};

/** Approach a player this Pokémon likes. */
export const GOAL_GREET: Goal = {
  name: 'greet',
  priority: 1.25,
  commitment: 0.2,
  considerations: [
    { name: 'affinity', input: (f) => f.playerAffinity, curve: { kind: 'logistic', c: 0.62 } },
    { name: 'familiarity', input: (f) => f.playerFamiliarity, curve: { kind: 'logistic', c: 0.3 } },
    { name: 'player-near', input: (f) => 1 - f.playerDistance, curve: { kind: 'logistic', c: 0.4 } },
    { name: 'unafraid', input: (f) => f.fear, curve: { kind: 'inverse-quadratic' } },
  ],
};

/** Rejoin the pack. */
export const GOAL_REGROUP: Goal = {
  name: 'regroup',
  priority: 0.95,
  commitment: 0.18,
  considerations: [
    { name: 'lonely', input: (f) => f.sociability, curve: { kind: 'logistic', c: 0.5 } },
    { name: 'pack-exists', input: (f) => 1 - f.packmateDistance, curve: { kind: 'linear' } },
    { name: 'separated', input: (f) => f.packmateDistance, curve: { kind: 'logistic', c: 0.35 } },
  ],
};

/** Return to home territory after straying. */
export const GOAL_RETURN_HOME: Goal = {
  name: 'return-home',
  priority: 0.9,
  commitment: 0.22,
  considerations: [
    { name: 'far-from-home', input: (f) => f.distanceFromHome, curve: { kind: 'logistic', c: 0.6 } },
    { name: 'not-busy', input: (f) => f.hasTarget, curve: { kind: 'inverse' } },
    { name: 'calm', input: (f) => f.fear, curve: { kind: 'inverse', m: 0.8 } },
  ],
};

/** Idle wander. The fallback that guarantees a goal is always selectable. */
export const GOAL_WANDER: Goal = {
  name: 'wander',
  priority: 0.35,
  commitment: 0.1,
  considerations: [
    { name: 'awake', input: (f) => f.isActiveHour, curve: { kind: 'threshold', c: 0.5 } },
    { name: 'calm', input: (f) => f.fear, curve: { kind: 'inverse', m: 0.9 } },
    { name: 'has-energy', input: (f) => f.fatigue, curve: { kind: 'inverse', m: 0.6 } },
  ],
};

/** Play — chase pack-mates, bat at objects. Reads as life more than anything else. */
export const GOAL_PLAY: Goal = {
  name: 'play',
  priority: 0.7,
  commitment: 0.2,
  considerations: [
    { name: 'curious', input: (f) => f.curiosity, curve: { kind: 'logistic', c: 0.55 } },
    { name: 'company', input: (f) => 1 - f.packmateDistance, curve: { kind: 'logistic', c: 0.45 } },
    { name: 'fed', input: (f) => f.hunger, curve: { kind: 'inverse', m: 1.1 } },
    { name: 'rested', input: (f) => f.fatigue, curve: { kind: 'inverse' } },
    { name: 'safe', input: (f) => f.fear, curve: { kind: 'inverse-quadratic', m: 1.3 } },
  ],
};

export const ALL_GOALS: readonly Goal[] = [
  GOAL_FLEE, GOAL_ATTACK, GOAL_DEFEND_TERRITORY, GOAL_PROTECT,
  GOAL_HUNT, GOAL_FORAGE, GOAL_SLEEP, GOAL_REST,
  GOAL_INVESTIGATE, GOAL_GREET, GOAL_REGROUP, GOAL_RETURN_HOME,
  GOAL_WANDER, GOAL_PLAY,
];

const byName = new Map(ALL_GOALS.map((g) => [g.name, g]));

export function getGoal(name: string): Goal {
  const g = byName.get(name);
  if (!g) throw new Error(`Unknown goal "${name}".`);
  return g;
}
