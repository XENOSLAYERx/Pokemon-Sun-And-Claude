/**
 * Per-species AI profiles.
 *
 * A profile is the small amount of tuning that turns the shared goal library
 * into a specific creature. Everything not overridden falls back to the
 * temperament default, so adding a species costs nothing unless it needs to be
 * special — and the ones the design brief calls out by name are special.
 *
 * The brief's specifications map directly:
 *   Pikachu   — curious, playful, social
 *   Bewear    — extremely strong, protective
 *   Sharpedo  — aggressive predator
 *   Lapras    — peaceful
 *   Wingull   — travel in flocks
 *   Growlithe — guard territories
 */
import { getSpecies, type SpeciesRuntime, type TemperamentClass } from '@alola/data';
import type { Goal } from '../utility/scorer.ts';
import {
  ALL_GOALS, GOAL_FLEE, GOAL_ATTACK, GOAL_DEFEND_TERRITORY, GOAL_PROTECT,
  GOAL_HUNT, GOAL_FORAGE, GOAL_SLEEP, GOAL_REST, GOAL_INVESTIGATE,
  GOAL_GREET, GOAL_REGROUP, GOAL_RETURN_HOME, GOAL_WANDER, GOAL_PLAY,
} from '../utility/goals.ts';

export interface AiProfile {
  /** Goals this species may pursue. */
  readonly goals: readonly Goal[];
  /** Per-goal priority multipliers layered on top of the goal's own priority. */
  readonly goalBias: Readonly<Record<string, number>>;
  /** Flocking strength, 0 = solitary. */
  readonly flockWeight: number;
  /** How close pack-mates try to stay, in metres. */
  readonly cohesionRadius: number;
  /** Personal space, in metres. */
  readonly separationRadius: number;
  /** Multiplier on how fast fear rises from a given stimulus. */
  readonly fearSensitivity: number;
  /** Distance at which the player triggers a reaction, in metres. */
  readonly alertRadius: number;
  /** Distance the agent will pursue a target before giving up, in metres. */
  readonly pursuitRange: number;
  /** Seconds between full behaviour re-evaluations at LOD0. */
  readonly decisionInterval: number;
  /** Notes for designers and for the AI debug overlay. */
  readonly notes: string;
}

/** Defaults derived from temperament. Every species gets one of these for free. */
const TEMPERAMENT_DEFAULTS: Readonly<Record<TemperamentClass, AiProfile>> = {
  timid: {
    goals: [GOAL_FLEE, GOAL_FORAGE, GOAL_SLEEP, GOAL_REST, GOAL_REGROUP, GOAL_RETURN_HOME, GOAL_WANDER],
    goalBias: { flee: 1.5, wander: 0.9 },
    flockWeight: 0.8, cohesionRadius: 14, separationRadius: 2.5,
    fearSensitivity: 1.6, alertRadius: 22, pursuitRange: 0,
    decisionInterval: 0.35,
    notes: 'Flees on sight. Never initiates. The baseline prey animal.',
  },
  skittish: {
    goals: [GOAL_FLEE, GOAL_FORAGE, GOAL_SLEEP, GOAL_REST, GOAL_INVESTIGATE, GOAL_RETURN_HOME, GOAL_WANDER],
    goalBias: { flee: 1.2, investigate: 0.7 },
    flockWeight: 0.4, cohesionRadius: 12, separationRadius: 2.5,
    fearSensitivity: 1.25, alertRadius: 18, pursuitRange: 0,
    decisionInterval: 0.4,
    notes: 'Wary. Will watch from a distance, and bolts if approached quickly.',
  },
  curious: {
    goals: [GOAL_FLEE, GOAL_INVESTIGATE, GOAL_GREET, GOAL_PLAY, GOAL_FORAGE, GOAL_SLEEP, GOAL_REST, GOAL_REGROUP, GOAL_WANDER],
    goalBias: { investigate: 1.4, greet: 1.2, flee: 0.8 },
    flockWeight: 0.5, cohesionRadius: 16, separationRadius: 2,
    fearSensitivity: 0.85, alertRadius: 20, pursuitRange: 18,
    decisionInterval: 0.3,
    notes: 'Approaches novelty. Will follow the player at a distance.',
  },
  playful: {
    goals: [GOAL_PLAY, GOAL_INVESTIGATE, GOAL_GREET, GOAL_FLEE, GOAL_FORAGE, GOAL_SLEEP, GOAL_REST, GOAL_REGROUP, GOAL_WANDER],
    goalBias: { play: 1.5, investigate: 1.2, greet: 1.3, flee: 0.7 },
    flockWeight: 0.6, cohesionRadius: 14, separationRadius: 1.8,
    fearSensitivity: 0.75, alertRadius: 20, pursuitRange: 22,
    decisionInterval: 0.28,
    notes: 'Seeks interaction. Chases thrown items and other Pokémon.',
  },
  docile: {
    goals: [GOAL_FORAGE, GOAL_REST, GOAL_SLEEP, GOAL_WANDER, GOAL_REGROUP, GOAL_FLEE],
    goalBias: { flee: 0.5, wander: 1.2, rest: 1.2 },
    flockWeight: 0.3, cohesionRadius: 20, separationRadius: 4,
    fearSensitivity: 0.5, alertRadius: 14, pursuitRange: 0,
    decisionInterval: 0.6,
    notes: 'Largely ignores the player. Will not flee unless directly attacked.',
  },
  territorial: {
    goals: [GOAL_DEFEND_TERRITORY, GOAL_ATTACK, GOAL_FORAGE, GOAL_REST, GOAL_SLEEP, GOAL_RETURN_HOME, GOAL_WANDER, GOAL_FLEE],
    goalBias: { 'defend-territory': 1.5, attack: 1.1, 'return-home': 1.3, flee: 0.6 },
    flockWeight: 0.35, cohesionRadius: 18, separationRadius: 4,
    fearSensitivity: 0.7, alertRadius: 30, pursuitRange: 45,
    decisionInterval: 0.35,
    notes: 'Warns first, then attacks. Disengages at the territory boundary.',
  },
  aggressive: {
    goals: [GOAL_ATTACK, GOAL_HUNT, GOAL_DEFEND_TERRITORY, GOAL_FORAGE, GOAL_REST, GOAL_WANDER, GOAL_FLEE],
    goalBias: { attack: 1.5, hunt: 1.3, flee: 0.35 },
    flockWeight: 0.25, cohesionRadius: 22, separationRadius: 5,
    fearSensitivity: 0.5, alertRadius: 38, pursuitRange: 70,
    decisionInterval: 0.3,
    notes: 'Attacks on sight. Pursues well past its starting position.',
  },
  apex: {
    goals: [GOAL_ATTACK, GOAL_HUNT, GOAL_REST, GOAL_SLEEP, GOAL_WANDER, GOAL_RETURN_HOME],
    goalBias: { attack: 1.7, hunt: 1.4 },
    flockWeight: 0, cohesionRadius: 0, separationRadius: 8,
    fearSensitivity: 0.2, alertRadius: 45, pursuitRange: 120,
    decisionInterval: 0.3,
    notes: 'Relentless. Does not flee and does not lose interest quickly.',
  },
  protective: {
    goals: [GOAL_PROTECT, GOAL_ATTACK, GOAL_DEFEND_TERRITORY, GOAL_FORAGE, GOAL_REST, GOAL_SLEEP, GOAL_REGROUP, GOAL_RETURN_HOME, GOAL_WANDER],
    goalBias: { protect: 1.8, attack: 1.1, flee: 0.4 },
    flockWeight: 0.7, cohesionRadius: 30, separationRadius: 5,
    fearSensitivity: 0.45, alertRadius: 34, pursuitRange: 90,
    decisionInterval: 0.32,
    notes: 'Peaceful until its young or pack are threatened, then implacable.',
  },
  nocturnal: {
    goals: [GOAL_FLEE, GOAL_FORAGE, GOAL_HUNT, GOAL_SLEEP, GOAL_REST, GOAL_INVESTIGATE, GOAL_REGROUP, GOAL_WANDER],
    goalBias: { sleep: 1.4, forage: 1.2 },
    flockWeight: 0.5, cohesionRadius: 12, separationRadius: 2.5,
    fearSensitivity: 1.1, alertRadius: 20, pursuitRange: 15,
    decisionInterval: 0.4,
    notes: 'Bold and active at night, hides and sleeps by day.',
  },
};

/**
 * Species-specific overrides.
 * Only species that need to differ from their temperament default appear here.
 */
const SPECIES_OVERRIDES: Readonly<Record<string, Partial<AiProfile>>> = {
  PIKACHU: {
    goalBias: { investigate: 1.6, play: 1.5, greet: 1.4, regroup: 1.3, flee: 0.75 },
    flockWeight: 0.75,
    cohesionRadius: 18,
    decisionInterval: 0.25,
    notes:
      'Curious, playful and social, per the design brief. Approaches the player ' +
      'to within a few metres, retreats if startled, and returns. Actively seeks ' +
      'out other Pikachu — a lone one will cross a route to reach a group.',
  },
  BEWEAR: {
    goalBias: { protect: 2.2, attack: 1.4, 'defend-territory': 1.2, flee: 0.15 },
    flockWeight: 0.9,
    cohesionRadius: 60,
    separationRadius: 7,
    fearSensitivity: 0.25,
    alertRadius: 40,
    pursuitRange: 160,
    decisionInterval: 0.3,
    notes:
      'Extremely strong and protective. Its cohesion radius is enormous: it ' +
      'keeps a Stufful in awareness across a whole clearing and will cross the ' +
      'route to intercept anything that threatens one. Once committed it ' +
      'pursues far past where any other species would disengage.',
  },
  STUFFUL: {
    goalBias: { flee: 1.4, regroup: 1.6 },
    flockWeight: 0.85,
    cohesionRadius: 55,
    notes: 'Flees to its Bewear rather than away — which is how the player meets the Bewear.',
  },
  SHARPEDO: {
    goals: [GOAL_HUNT, GOAL_ATTACK, GOAL_REST, GOAL_WANDER],
    goalBias: { hunt: 1.8, attack: 1.7 },
    flockWeight: 0.3,
    cohesionRadius: 28,
    separationRadius: 6,
    fearSensitivity: 0.25,
    alertRadius: 50,
    pursuitRange: 140,
    decisionInterval: 0.22,
    notes:
      'Aggressive predator. Has no flee goal at all — it does not retreat. ' +
      'Hunts Wishiwashi schools cooperatively, closing from multiple angles, ' +
      'and will break off a hunt to attack a swimming player.',
  },
  LAPRAS: {
    goals: [GOAL_WANDER, GOAL_REST, GOAL_SLEEP, GOAL_FORAGE, GOAL_GREET, GOAL_REGROUP],
    goalBias: { wander: 1.4, greet: 1.5, rest: 1.2 },
    flockWeight: 0.4,
    cohesionRadius: 40,
    separationRadius: 8,
    fearSensitivity: 0.3,
    alertRadius: 20,
    pursuitRange: 0,
    decisionInterval: 0.7,
    notes:
      'Peaceful, per the brief. Has neither a flee nor an attack goal: it ' +
      'simply continues on its way. Will approach a player it has positive ' +
      'affinity with, which is how the ride relationship is established.',
  },
  WINGULL: {
    goalBias: { regroup: 2.0, flee: 1.4, wander: 1.2 },
    flockWeight: 1.0,
    cohesionRadius: 26,
    separationRadius: 2.2,
    fearSensitivity: 1.5,
    alertRadius: 45,
    decisionInterval: 0.2,
    notes:
      'Travels in flocks, per the brief. Maximum flock weight and a short ' +
      'decision interval so the flock responds as one body. A threat to any ' +
      'member propagates through the flock and the whole colony lifts at once.',
  },
  GROWLITHE: {
    goalBias: { 'defend-territory': 1.9, attack: 1.2, 'return-home': 1.6, flee: 0.45 },
    flockWeight: 0.45,
    cohesionRadius: 25,
    fearSensitivity: 0.6,
    alertRadius: 42,
    pursuitRange: 55,
    decisionInterval: 0.3,
    notes:
      'Guards territories, per the brief. Detects intruders well before it ' +
      'acts, barks a warning at the territory edge, and only attacks if the ' +
      'intruder keeps coming. Breaks off hard at the boundary and returns to ' +
      'its post rather than pursuing.',
  },
  WISHIWASHI: {
    goalBias: { regroup: 2.4, flee: 1.8 },
    flockWeight: 1.0,
    cohesionRadius: 12,
    separationRadius: 0.8,
    fearSensitivity: 1.8,
    decisionInterval: 0.18,
    notes: 'Extreme schooling. Tight separation so the school reads as one mass.',
  },
  MAGIKARP: {
    goalBias: { wander: 1.5, flee: 1.2 },
    flockWeight: 0.6,
    cohesionRadius: 16,
    notes: 'Drifts. Flees ineffectually.',
  },
  TAPU_KOKO: {
    goals: [GOAL_INVESTIGATE, GOAL_ATTACK, GOAL_WANDER],
    goalBias: { investigate: 2.0, attack: 1.2 },
    flockWeight: 0,
    fearSensitivity: 0,
    alertRadius: 120,
    pursuitRange: 300,
    decisionInterval: 0.15,
    notes:
      'Curious about strength specifically. Appears, observes, and leaves ' +
      'before the player can react. Never flees, never forages, never sleeps.',
  },
  KOMMO_O: {
    goalBias: { attack: 1.8, 'defend-territory': 1.5 },
    fearSensitivity: 0.1,
    alertRadius: 55,
    pursuitRange: 150,
    notes: 'Challenges anything entering the canyon. Does not disengage.',
  },
};

const cache = new Map<string, AiProfile>();

/** Resolve a species' full AI profile, merging its overrides over the default. */
export function profileFor(speciesId: string): AiProfile {
  const cached = cache.get(speciesId);
  if (cached) return cached;

  const species = getSpecies(speciesId);
  const base = TEMPERAMENT_DEFAULTS[species.temperament];
  const override = SPECIES_OVERRIDES[speciesId];

  const profile: AiProfile = override
    ? {
        ...base,
        ...override,
        // Bias maps merge rather than replace, so an override only has to
        // state the goals it actually changes.
        goalBias: { ...base.goalBias, ...(override.goalBias ?? {}) },
      }
    : base;

  cache.set(speciesId, profile);
  return profile;
}

/** Goals for a species with the profile's bias folded into each priority. */
export function biasedGoalsFor(speciesId: string): Goal[] {
  const profile = profileFor(speciesId);
  return profile.goals.map((g) => {
    const bias = profile.goalBias[g.name];
    if (bias === undefined || bias === 1) return g;
    return { ...g, priority: (g.priority ?? 1) * bias };
  });
}

/** Does this species ever flee? Used by encounter design and by the Dex. */
export function willFlee(speciesId: string): boolean {
  return profileFor(speciesId).goals.some((g) => g.name === 'flee');
}

/** Does this species attack unprovoked? */
export function isHostile(speciesId: string): boolean {
  const species = getSpecies(speciesId);
  return species.temperament === 'aggressive' || species.temperament === 'apex';
}

/** All goals, for tooling that wants the complete set. */
export function allGoals(): readonly Goal[] {
  return ALL_GOALS;
}

/** Profile notes for every species that has a bespoke one — used by the docs build. */
export function documentedProfiles(): { species: string; notes: string }[] {
  return Object.entries(SPECIES_OVERRIDES).map(([species, p]) => ({
    species,
    notes: p.notes ?? profileFor(species).notes,
  }));
}

export type { SpeciesRuntime };
