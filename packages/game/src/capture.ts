/**
 * Capture.
 *
 * Wraps the battle package's `catchProbability` with the parts that belong to
 * the game rather than to the maths: which ball, what the target's condition
 * is, and the shake animation the player actually watches.
 */
import { Rng } from '@alola/core';
import { getItem, getSpecies } from '@alola/data';
import { catchProbability, type BattlePokemon } from '@alola/battle';

/** Status conditions make a Pokémon easier to catch. */
export function statusMultiplierFor(status: string): number {
  switch (status) {
    case 'sleep':
    case 'freeze':
      return 2.5;
    case 'paralysis':
    case 'poison':
    case 'toxic':
    case 'burn':
      return 1.5;
    default:
      return 1;
  }
}

/**
 * Situational ball multipliers.
 *
 * The item table carries a base multiplier; these balls only earn theirs under
 * the right conditions, and quietly fall back to 1× otherwise. A Dusk Ball in
 * broad daylight is a wasted Dusk Ball, and that should be true here too.
 */
export function ballMultiplierFor(
  ballId: string,
  context: { hour: number; onWater: boolean; targetTypes: readonly string[] },
): number {
  const item = getItem(ballId);
  const base = item.catchMultiplier ?? 1;

  switch (ballId) {
    case 'dusk-ball':
      // Night, roughly 20:00–04:00.
      return context.hour >= 20 || context.hour < 4 ? base : 1;
    case 'net-ball':
      return context.targetTypes.includes('water') || context.targetTypes.includes('bug') ? base : 1;
    default:
      return base;
  }
}

export interface CaptureAttempt {
  readonly caught: boolean;
  /** 0–3 wobbles before breaking out; 4 means it held. */
  readonly shakes: number;
  readonly probability: number;
  /** True for a Master Ball or a guaranteed catch — skips the shake drama. */
  readonly certain: boolean;
}

/**
 * Resolve one thrown ball.
 *
 * The shake count is derived from the *same* probability as the outcome rather
 * than rolled separately, so the animation can never contradict the result —
 * three shakes then a break-out is honest, three shakes then a catch after the
 * game already decided otherwise is not.
 */
export function attemptCapture(params: {
  target: BattlePokemon;
  ballId: string;
  rng: Rng;
  hour: number;
  onWater: boolean;
}): CaptureAttempt {
  const species = getSpecies(params.target.speciesId);
  const ballMultiplier = ballMultiplierFor(params.ballId, {
    hour: params.hour,
    onWater: params.onWater,
    targetTypes: species.types,
  });

  if (ballMultiplier >= 255) {
    return { caught: true, shakes: 4, probability: 1, certain: true };
  }

  const probability = catchProbability(
    params.target.maxHp,
    params.target.hp,
    species.catchRate,
    ballMultiplier,
    statusMultiplierFor(params.target.status),
  );

  // Four independent shake checks, each at the fourth root of the overall
  // probability — which is exactly how `catchProbability` derives its number,
  // inverted.
  const perShake = Math.pow(Math.max(probability, 1e-9), 0.25);
  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    if (!params.rng.chance(perShake)) break;
    shakes++;
  }

  return { caught: shakes === 4, shakes, probability, certain: false };
}
