/**
 * Utility-based goal selection.
 *
 * Each tick, every candidate goal is scored from the agent's needs and its
 * perception of the world. The highest scorer wins and its behaviour tree runs.
 *
 * Three details make this work in practice rather than in theory:
 *
 * - **Response curves, not raw values.** A need's contribution passes through a
 *   named curve (linear, quadratic, inverse, threshold, logistic). "Fear
 *   matters a little until it matters enormously" is a curve, not a constant,
 *   and expressing it as one is what stops the scoring from needing magic
 *   numbers everywhere.
 *
 * - **Geometric mean, not sum.** Scores multiply. A goal that requires prey and
 *   hunger scores zero if either is absent, instead of limping along on the
 *   other. Summed utility produces the classic bug where a starving creature
 *   with no food nearby still chooses "eat" and stands still.
 *
 * - **Hysteresis on the current goal.** The active goal gets a bonus, so an
 *   agent does not flicker between two nearly-equal goals every tick — the
 *   single most common way emergent AI reads as broken.
 */
import { clamp01 } from '@alola/core';

export type CurveKind = 'linear' | 'quadratic' | 'inverse' | 'inverse-quadratic' | 'threshold' | 'logistic' | 'bell';

export interface ResponseCurve {
  readonly kind: CurveKind;
  /** Slope/steepness. */
  readonly m?: number;
  /** Threshold or centre point. */
  readonly c?: number;
}

export function evaluateCurve(curve: ResponseCurve, x: number): number {
  const v = clamp01(x);
  const m = curve.m ?? 1;
  const c = curve.c ?? 0.5;

  switch (curve.kind) {
    case 'linear':
      return clamp01(v * m);
    case 'quadratic':
      // Slow start, sharp finish. "Only matters once it is severe."
      return clamp01(Math.pow(v, 2 * m));
    case 'inverse':
      return clamp01(1 - v * m);
    case 'inverse-quadratic':
      return clamp01(Math.pow(1 - v, 2 * m));
    case 'threshold':
      // Hard gate: nothing below c, full above.
      return v >= c ? 1 : 0;
    case 'logistic': {
      // Smooth S-curve centred on c. The general-purpose "soft threshold".
      const k = 12 * m;
      return clamp01(1 / (1 + Math.exp(-k * (v - c))));
    }
    case 'bell':
      // Peaks at c. "Best when moderate" — e.g. approach distance.
      return clamp01(Math.exp(-Math.pow((v - c) * 4 * m, 2)));
    default:
      return v;
  }
}

/** One input to a goal's score. */
export interface Consideration {
  readonly name: string;
  /** Extract the raw 0–1 input from the world. */
  readonly input: (facts: UtilityFacts) => number;
  readonly curve: ResponseCurve;
  /** Relative importance. Applied as an exponent, preserving the zero-kills rule. */
  readonly weight?: number;
}

/**
 * Everything a consideration may read.
 *
 * Deliberately a flat struct of primitives rather than references to live
 * objects: it is assembled once per agent per decision tick, which means
 * scoring is cheap, side-effect free and trivially testable.
 */
export interface UtilityFacts {
  // Needs
  hunger: number;
  fatigue: number;
  fear: number;
  aggression: number;
  curiosity: number;
  sociability: number;
  drowsiness: number;

  // Perception
  threatDistance: number;      // Normalised 0–1 over sight range; 1 = none.
  threatLevel: number;
  preyDistance: number;        // 1 = none in range.
  packmateDistance: number;    // 1 = none in range.
  playerDistance: number;      // 1 = none in range.
  packCount: number;           // Normalised 0–1.

  // Relationship with the nearest player
  playerAffinity: number;      // Remapped to 0–1, 0.5 = neutral.
  playerFamiliarity: number;

  // Self / world state
  healthFraction: number;
  inTerritory: number;         // 1 = at the centre of territory, 0 = far outside.
  isActiveHour: number;        // 1 = awake period.
  distanceFromHome: number;    // Normalised over territory radius.
  hasTarget: number;           // 1 if pursuing something.
}

export interface Goal {
  readonly name: string;
  readonly considerations: readonly Consideration[];
  /** Multiplier applied after all considerations. Lets designers rank goals. */
  readonly priority?: number;
  /** Extra score retained while this goal is already active (hysteresis). */
  readonly commitment?: number;
}

export interface ScoredGoal {
  readonly goal: Goal;
  readonly score: number;
  /** Per-consideration breakdown, for the AI debug overlay. */
  readonly breakdown: { name: string; value: number }[];
}

/**
 * Score one goal.
 *
 * Multiplies the considerations, with per-consideration compensation for
 * goal complexity.
 *
 * Plain multiplication punishes goals for being well-specified: five
 * considerations at 0.6 each multiply to 0.078, so a nuanced goal could never
 * beat a lazy two-consideration one. The fix (from Dave Mark's utility work)
 * is to lift each term toward 1 in proportion to how many terms there are,
 * *before* multiplying — compensating once at the end does not work, because
 * by then the product has already collapsed.
 *
 * Critically, the compensation maps 0 to 0, so the zero-kills-the-goal
 * property survives: a goal with no valid target still scores nothing.
 */
export function scoreGoal(goal: Goal, facts: UtilityFacts, collectBreakdown = false): ScoredGoal {
  const n = goal.considerations.length;
  if (n === 0) {
    return { goal, score: goal.priority ?? 1, breakdown: [] };
  }

  const breakdown: { name: string; value: number }[] = [];
  let product = 1;

  // 0 for a single consideration (no compensation needed), approaching 1 as
  // the goal gains considerations.
  const modificationFactor = 1 - 1 / n;

  for (const c of goal.considerations) {
    let value = evaluateCurve(c.curve, c.input(facts));
    if (c.weight !== undefined && c.weight !== 1) {
      value = Math.pow(value, c.weight);
    }
    if (collectBreakdown) breakdown.push({ name: c.name, value });

    if (value <= 0) {
      // Early out: a zero consideration kills the goal outright, which is the
      // whole reason for multiplying rather than summing.
      if (!collectBreakdown) return { goal, score: 0, breakdown: [] };
      product = 0;
      continue;
    }

    if (product !== 0) {
      const makeUp = (1 - value) * modificationFactor;
      product *= value + makeUp * value;
    }
  }

  if (product === 0) return { goal, score: 0, breakdown };

  return {
    goal,
    score: product * (goal.priority ?? 1),
    breakdown,
  };
}

/**
 * Pick the best goal.
 *
 * `currentGoal` receives its commitment bonus, which is what prevents
 * goal-flicker. Without it an agent whose "flee" and "forage" scores sit at
 * 0.51 and 0.50 will alternate every tick and appear to twitch in place.
 */
export function selectGoal(
  goals: readonly Goal[],
  facts: UtilityFacts,
  currentGoal: string | null = null,
  collectBreakdown = false,
): ScoredGoal | null {
  let best: ScoredGoal | null = null;

  for (const goal of goals) {
    const scored = scoreGoal(goal, facts, collectBreakdown);
    let score = scored.score;

    if (currentGoal === goal.name && score > 0) {
      score += goal.commitment ?? 0.12;
    }

    if (best === null || score > best.score) {
      best = { goal, score, breakdown: scored.breakdown };
    }
  }

  return best !== null && best.score > 0 ? best : null;
}

/** Score every goal and return them sorted — for the AI inspector. */
export function scoreAll(goals: readonly Goal[], facts: UtilityFacts): ScoredGoal[] {
  return goals
    .map((g) => scoreGoal(g, facts, true))
    .sort((a, b) => b.score - a.score);
}

/** Neutral facts, used as a base that callers fill in. */
export function emptyFacts(): UtilityFacts {
  return {
    hunger: 0, fatigue: 0, fear: 0, aggression: 0, curiosity: 0,
    sociability: 0, drowsiness: 0,
    threatDistance: 1, threatLevel: 0, preyDistance: 1,
    packmateDistance: 1, playerDistance: 1, packCount: 0,
    playerAffinity: 0.5, playerFamiliarity: 0,
    healthFraction: 1, inTerritory: 1, isActiveHour: 1,
    distanceFromHome: 0, hasTarget: 0,
  };
}
