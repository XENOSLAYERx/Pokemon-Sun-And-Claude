/**
 * Drives and emotional state.
 *
 * Every simulated Pokémon carries a small vector of continuous internal
 * values. These are the inputs the utility scorer weighs, and they are what
 * turns a species table row into an individual: two Growlithe with identical
 * stats behave differently because one is hungry and one is frightened.
 *
 * All values are 0–1. They decay toward a resting value over time, which is
 * what produces natural rhythm — a startled Pokémon calms down, a fed one gets
 * hungry again — without any scripting.
 */
import { clamp01, lerp } from '@alola/core';
import type { SpeciesRuntime } from '@alola/data';

export interface Needs {
  /** Rises over time; satisfied by eating. Drives foraging and hunting. */
  hunger: number;
  /** Rises while active, falls while resting. Gates running and fighting. */
  fatigue: number;
  /** Spikes at threats, decays slowly. The dominant emotion when high. */
  fear: number;
  /** Rises when territory is invaded or when cornered. Drives attacking. */
  aggression: number;
  /** Drives approaching novel things — the player, thrown items, sounds. */
  curiosity: number;
  /** Drives seeking pack-mates. High in social species. */
  sociability: number;
  /** Sleep pressure. Rises when the species is outside its active hours. */
  drowsiness: number;
}

export interface NeedsConfig {
  /** Per-second change while undisturbed. Negative = decays. */
  readonly hungerRate: number;
  readonly fatigueRate: number;
  readonly fearDecay: number;
  readonly aggressionDecay: number;
  readonly curiosityDecay: number;
  /** Resting values each need decays toward. */
  readonly baseCuriosity: number;
  readonly baseAggression: number;
  readonly baseSociability: number;
}

export function createNeeds(rand: () => number): Needs {
  // Individual variation at spawn: this is where "this Pikachu is bolder than
  // that one" comes from, with no extra data per individual.
  return {
    hunger: rand() * 0.4,
    fatigue: rand() * 0.2,
    fear: 0,
    aggression: rand() * 0.15,
    curiosity: rand() * 0.3,
    sociability: rand() * 0.4,
    drowsiness: 0,
  };
}

/**
 * Derive need dynamics from a species' temperament.
 *
 * This is the single place a designer changes to make a whole species behave
 * differently, and it is intentionally small: everything else emerges from the
 * interaction between these rates and the world.
 */
export function needsConfigFor(species: SpeciesRuntime): NeedsConfig {
  const base: NeedsConfig = {
    hungerRate: 0.0022,
    fatigueRate: 0.0035,
    fearDecay: 0.045,
    aggressionDecay: 0.03,
    curiosityDecay: 0.02,
    baseCuriosity: 0.25,
    baseAggression: 0.1,
    baseSociability: 0.3,
  };

  switch (species.temperament) {
    case 'timid':
      return { ...base, fearDecay: 0.018, baseCuriosity: 0.08, baseAggression: 0.02, baseSociability: 0.6 };
    case 'skittish':
      return { ...base, fearDecay: 0.03, baseCuriosity: 0.2, baseAggression: 0.05 };
    case 'curious':
      return { ...base, curiosityDecay: 0.008, baseCuriosity: 0.72, baseAggression: 0.08, baseSociability: 0.55 };
    case 'playful':
      return { ...base, curiosityDecay: 0.006, baseCuriosity: 0.8, baseAggression: 0.05, baseSociability: 0.7 };
    case 'docile':
      return { ...base, fearDecay: 0.08, baseCuriosity: 0.2, baseAggression: 0.02, baseSociability: 0.45 };
    case 'territorial':
      return { ...base, aggressionDecay: 0.012, baseAggression: 0.42, baseCuriosity: 0.18 };
    case 'aggressive':
      return { ...base, aggressionDecay: 0.008, baseAggression: 0.68, baseCuriosity: 0.12, fearDecay: 0.09 };
    case 'apex':
      return {
        ...base, aggressionDecay: 0.005, baseAggression: 0.8, baseCuriosity: 0.15,
        fearDecay: 0.2, baseSociability: 0.05,
      };
    case 'protective':
      return { ...base, aggressionDecay: 0.01, baseAggression: 0.22, baseSociability: 0.85 };
    case 'nocturnal':
      return { ...base, baseCuriosity: 0.3, baseAggression: 0.15 };
    default:
      return base;
  }
}

/**
 * Advance needs by `dt` seconds.
 *
 * `isActiveHour` comes from the species' schedule; `hasThreat` and
 * `packNearby` come from perception. Keeping this a pure-ish function of
 * (needs, config, world facts) makes it trivially testable, which matters
 * because emergent behaviour is otherwise very hard to debug.
 */
export function updateNeeds(
  needs: Needs,
  config: NeedsConfig,
  dt: number,
  world: {
    isActiveHour: boolean;
    isResting: boolean;
    isMoving: boolean;
    hasThreat: boolean;
    packNearby: boolean;
  },
): void {
  // Hunger always climbs, faster when active.
  needs.hunger = clamp01(needs.hunger + config.hungerRate * dt * (world.isMoving ? 1.6 : 1));

  // Fatigue climbs while moving, falls while resting.
  if (world.isResting) {
    needs.fatigue = clamp01(needs.fatigue - config.fatigueRate * 2.5 * dt);
  } else {
    needs.fatigue = clamp01(needs.fatigue + config.fatigueRate * dt * (world.isMoving ? 1 : 0.25));
  }

  // Fear decays unless a threat is present, in which case it holds.
  if (!world.hasThreat) {
    needs.fear = clamp01(needs.fear - config.fearDecay * dt);
  }

  // Aggression and curiosity relax toward their species baselines.
  needs.aggression = clamp01(
    lerp(needs.aggression, config.baseAggression, Math.min(1, config.aggressionDecay * dt)),
  );
  needs.curiosity = clamp01(
    lerp(needs.curiosity, config.baseCuriosity, Math.min(1, config.curiosityDecay * dt)),
  );

  // Sociability climbs when alone, is satisfied by company.
  const socialTarget = world.packNearby ? config.baseSociability * 0.3 : Math.min(1, config.baseSociability * 1.5);
  needs.sociability = clamp01(lerp(needs.sociability, socialTarget, Math.min(1, 0.02 * dt)));

  // Drowsiness builds outside active hours and is relieved by resting.
  if (world.isActiveHour) {
    needs.drowsiness = clamp01(needs.drowsiness - 0.02 * dt);
  } else {
    needs.drowsiness = clamp01(needs.drowsiness + (world.isResting ? -0.03 : 0.01) * dt);
  }
}

/** Apply a fear spike — called by perception when a threat is detected. */
export function applyFear(needs: Needs, intensity: number): void {
  needs.fear = clamp01(Math.max(needs.fear, intensity));
  // Fear suppresses curiosity immediately: a frightened creature stops
  // investigating. Without this, a startled Pikachu keeps walking toward the
  // thing that startled it, which reads as broken.
  needs.curiosity = clamp01(needs.curiosity * (1 - intensity * 0.7));
}

/** Apply an aggression spike — territory invaded, pack-mate attacked, cornered. */
export function applyAggression(needs: Needs, intensity: number): void {
  needs.aggression = clamp01(Math.max(needs.aggression, intensity));
}

/** Satisfy hunger after a successful feed. */
export function feed(needs: Needs, amount: number): void {
  needs.hunger = clamp01(needs.hunger - amount);
}

/** The dominant need, for the debug overlay and for animation selection. */
export function dominantNeed(needs: Needs): keyof Needs {
  let best: keyof Needs = 'curiosity';
  let bestValue = -1;
  for (const key of Object.keys(needs) as (keyof Needs)[]) {
    if (needs[key] > bestValue) {
      bestValue = needs[key];
      best = key;
    }
  }
  return best;
}
