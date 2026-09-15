/**
 * Damage calculation.
 *
 * Implements the mainline damage formula, with the standard order of
 * operations preserved exactly. The order matters far more than it looks:
 * the series applies integer truncation at specific points, and reordering
 * two multiplications changes the final number by 1–2 HP. Competitive players
 * notice, and a mismatch between client prediction and server authority
 * desyncs the battle.
 *
 * The formula:
 *   base = floor(floor(floor(2*L/5 + 2) * P * A/D) / 50) + 2
 *   then modifiers are applied in a fixed sequence.
 */
import { Rng, clamp } from '@alola/core';
import {
  effectivenessAgainst,
  type MoveDefinition,
  type PokemonType,
  type StatKey,
} from '@alola/data';
import type { BattlePokemon, StatStages } from '../engine/state.ts';

/** Stat stage multipliers. Index = stage + 6, so index 6 is stage 0. */
const STAGE_MULTIPLIERS = [
  2 / 8, 2 / 7, 2 / 6, 2 / 5, 2 / 4, 2 / 3,
  1,
  3 / 2, 4 / 2, 5 / 2, 6 / 2, 7 / 2, 8 / 2,
] as const;

/** Accuracy/evasion use a 3/3-based table rather than 2/2. */
const ACCURACY_STAGE_MULTIPLIERS = [
  3 / 9, 3 / 8, 3 / 7, 3 / 6, 3 / 5, 3 / 4,
  1,
  4 / 3, 5 / 3, 6 / 3, 7 / 3, 8 / 3, 9 / 3,
] as const;

export const MAX_STAGE = 6;
export const MIN_STAGE = -6;

export function stageMultiplier(stage: number): number {
  return STAGE_MULTIPLIERS[clamp(stage, MIN_STAGE, MAX_STAGE) + 6];
}

export function accuracyStageMultiplier(stage: number): number {
  return ACCURACY_STAGE_MULTIPLIERS[clamp(stage, MIN_STAGE, MAX_STAGE) + 6];
}

/**
 * Effective stat after stages.
 * `ignoreStages` supports moves and abilities that bypass them (Darkest
 * Lariat, Sunsteel Strike, a critical hit ignoring defensive boosts).
 */
export function effectiveStat(
  pokemon: BattlePokemon,
  stat: Exclude<StatKey, 'hp'>,
  ignoreStages = false,
): number {
  const base = pokemon.stats[stat];
  if (ignoreStages) return base;
  const stage = pokemon.stages[stat as keyof StatStages] ?? 0;
  return Math.floor(base * stageMultiplier(stage));
}

export interface DamageContext {
  readonly attacker: BattlePokemon;
  readonly defender: BattlePokemon;
  readonly move: MoveDefinition;
  /** Overrides the move's base power (Z-Moves, variable-power moves). */
  readonly powerOverride?: number;
  /** Overrides the move's type (Normalize, plate items). */
  readonly typeOverride?: PokemonType;
  readonly weather: string | null;
  readonly terrain: string | null;
  /** How many targets the move is hitting — spread moves lose power. */
  readonly targetCount: number;
  /** Is this a critical hit? Decided by the caller so it can be rolled once. */
  readonly critical: boolean;
  /** Suppresses the random 85–100% roll. Used by the AI's damage estimate. */
  readonly noRandom?: boolean;
  /** Ignores the defender's ability (Mold Breaker, Sunsteel Strike). */
  readonly ignoreAbility?: boolean;
}

export interface DamageResult {
  readonly damage: number;
  readonly effectiveness: number;
  readonly critical: boolean;
  /** True when the move cannot damage this target at all. */
  readonly immune: boolean;
  /** Breakdown for the damage-calculator UI and for debugging. */
  readonly breakdown: {
    base: number;
    stab: number;
    typeEffectiveness: number;
    weatherMod: number;
    terrainMod: number;
    critMod: number;
    burnMod: number;
    spreadMod: number;
    randomMod: number;
  };
}

/** Critical-hit probability by stage. */
const CRIT_CHANCE = [1 / 24, 1 / 8, 1 / 2, 1, 1] as const;

export function critChance(stage: number): number {
  return CRIT_CHANCE[clamp(stage, 0, 4)];
}

export function rollCritical(rng: Rng, stage: number): boolean {
  const chance = critChance(stage);
  if (chance >= 1) return true;
  return rng.next() < chance;
}

/**
 * The full damage calculation.
 *
 * Returns 0 damage with `immune: true` when type effectiveness is zero, so
 * callers can emit the correct "It doesn't affect..." message rather than
 * silently dealing nothing.
 */
export function calculateDamage(ctx: DamageContext, rng: Rng): DamageResult {
  const { attacker, defender, move } = ctx;

  const moveType = ctx.typeOverride ?? move.type;
  const power = ctx.powerOverride ?? move.power ?? 0;

  const emptyBreakdown = {
    base: 0, stab: 1, typeEffectiveness: 1, weatherMod: 1, terrainMod: 1,
    critMod: 1, burnMod: 1, spreadMod: 1, randomMod: 1,
  };

  if (move.category === 'status' || power <= 0) {
    return { damage: 0, effectiveness: 1, critical: false, immune: false, breakdown: emptyBreakdown };
  }

  // --- Type effectiveness. Checked first: immunity short-circuits everything.
  const typeEffectiveness = effectivenessAgainst(moveType, defender.types);
  if (typeEffectiveness === 0) {
    return {
      damage: 0, effectiveness: 0, critical: false, immune: true,
      breakdown: { ...emptyBreakdown, typeEffectiveness: 0 },
    };
  }

  // --- Attack and defence stats.
  const isPhysical = move.category === 'physical';
  const attackStat: Exclude<StatKey, 'hp'> = isPhysical ? 'atk' : 'spa';
  const defenseStat: Exclude<StatKey, 'hp'> = isPhysical ? 'def' : 'spd';

  // A critical hit ignores the attacker's negative offensive stages and the
  // defender's positive defensive ones — it cannot be worsened by debuffs.
  const attackerStage = attacker.stages[attackStat as keyof StatStages] ?? 0;
  const defenderStage = defender.stages[defenseStat as keyof StatStages] ?? 0;
  const attack = effectiveStat(attacker, attackStat, ctx.critical && attackerStage < 0);
  const defense = effectiveStat(defender, defenseStat, ctx.critical && defenderStage > 0);

  // --- Base damage. Truncation points are load-bearing; do not "simplify".
  const levelTerm = Math.floor((2 * attacker.level) / 5) + 2;
  let base = Math.floor(Math.floor((levelTerm * power * attack) / Math.max(1, defense)) / 50) + 2;

  // --- Modifier chain, applied in the canonical order.

  // Spread: a move hitting multiple targets deals less to each.
  const spreadMod = ctx.targetCount > 1 ? 0.75 : 1;
  base = Math.floor(base * spreadMod);

  // Weather.
  let weatherMod = 1;
  if (ctx.weather === 'rain' || ctx.weather === 'heavy-rain') {
    if (moveType === 'water') weatherMod = 1.5;
    else if (moveType === 'fire') weatherMod = 0.5;
  } else if (ctx.weather === 'harsh-sunlight') {
    if (moveType === 'fire') weatherMod = 1.5;
    else if (moveType === 'water') weatherMod = 0.5;
  }
  base = Math.floor(base * weatherMod);

  // Terrain. Only affects grounded Pokémon; flyers and Levitate are exempt.
  let terrainMod = 1;
  const attackerGrounded = !attacker.types.includes('flying') && attacker.ability !== 'levitate';
  const defenderGrounded = !defender.types.includes('flying') && defender.ability !== 'levitate';
  if (ctx.terrain === 'electric' && moveType === 'electric' && attackerGrounded) terrainMod = 1.3;
  else if (ctx.terrain === 'grassy' && moveType === 'grass' && attackerGrounded) terrainMod = 1.3;
  else if (ctx.terrain === 'psychic' && moveType === 'psychic' && attackerGrounded) terrainMod = 1.3;
  else if (ctx.terrain === 'misty' && moveType === 'dragon' && defenderGrounded) terrainMod = 0.5;
  base = Math.floor(base * terrainMod);

  // Critical hit.
  const critMod = ctx.critical ? 1.5 : 1;
  base = Math.floor(base * critMod);

  // Random roll, 85–100%. Uniform over 16 integer values, as in the series.
  const randomMod = ctx.noRandom ? 1 : rng.int(85, 100) / 100;
  base = Math.floor(base * randomMod);

  // STAB.
  let stab = 1;
  if (attacker.types.includes(moveType)) {
    stab = attacker.ability === 'adaptability' ? 2 : 1.5;
  }
  base = Math.floor(base * stab);

  // Type effectiveness.
  base = Math.floor(base * typeEffectiveness);

  // Burn halves physical damage, unless the attacker has Guts.
  const burnMod = attacker.status === 'burn' && isPhysical && attacker.ability !== 'guts' ? 0.5 : 1;
  base = Math.floor(base * burnMod);

  // Defensive abilities.
  if (!ctx.ignoreAbility) {
    if (defender.ability === 'fluffy') {
      // Halves contact damage, doubles Fire damage. Both can apply at once.
      if (move.flags.contact) base = Math.floor(base * 0.5);
      if (moveType === 'fire') base = Math.floor(base * 2);
    }
    if (defender.ability === 'thick-fat' && (moveType === 'fire' || moveType === 'ice')) {
      base = Math.floor(base * 0.5);
    }
    if (defender.ability === 'prism-armor' && typeEffectiveness > 1) {
      base = Math.floor(base * 0.75);
    }
  }

  // Items.
  if (attacker.item === 'life-orb') base = Math.floor(base * 1.3);
  if (attacker.item === 'choice-band' && isPhysical) base = Math.floor(base * 1.5);

  // A damaging move always deals at least 1.
  const damage = Math.max(1, base);

  return {
    damage,
    effectiveness: typeEffectiveness,
    critical: ctx.critical,
    immune: false,
    breakdown: {
      base: Math.floor(Math.floor((levelTerm * power * attack) / Math.max(1, defense)) / 50) + 2,
      stab,
      typeEffectiveness,
      weatherMod,
      terrainMod,
      critMod,
      burnMod,
      spreadMod,
      randomMod,
    },
  };
}

/**
 * Accuracy check.
 * Returns true when the move hits. Moves with null accuracy never miss.
 */
export function accuracyCheck(
  move: MoveDefinition,
  attacker: BattlePokemon,
  defender: BattlePokemon,
  weather: string | null,
  rng: Rng,
): boolean {
  if (move.accuracy === null || move.flags.alwaysHits) return true;

  // Weather overrides: Thunder and Hurricane never miss in rain; Blizzard
  // never misses in hail.
  if ((weather === 'rain' || weather === 'heavy-rain') && move.id === 'thunder') return true;
  if ((weather === 'hail' || weather === 'snow') && move.id === 'blizzard') return true;
  // Harsh sunlight makes Thunder less reliable.
  let accuracy = move.accuracy;
  if (weather === 'harsh-sunlight' && move.id === 'thunder') accuracy = 50;

  const accStage = attacker.stages.accuracy - defender.stages.evasion;
  const modifier = accuracyStageMultiplier(accStage);
  const finalAccuracy = accuracy * modifier;

  return rng.int(1, 100) <= finalAccuracy;
}

/**
 * Turn order.
 *
 * Priority bracket first, then Speed, then a random tiebreak. Trick Room
 * inverts the Speed comparison but not priority — a detail that is wrong in a
 * surprising number of implementations.
 */
export interface OrderEntry {
  readonly pokemonId: number;
  readonly priority: number;
  readonly speed: number;
  /** Deterministic tiebreak roll. */
  readonly tiebreak: number;
}

export function sortByTurnOrder(entries: OrderEntry[], trickRoom: boolean): OrderEntry[] {
  return entries.slice().sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.speed !== b.speed) return trickRoom ? a.speed - b.speed : b.speed - a.speed;
    return a.tiebreak - b.tiebreak;
  });
}

/** Effective speed, including paralysis, items and Tailwind. */
export function effectiveSpeed(
  pokemon: BattlePokemon,
  weather: string | null,
  tailwind: boolean,
): number {
  let speed = effectiveStat(pokemon, 'spe');

  if (pokemon.status === 'paralysis' && pokemon.ability !== 'quick-feet') {
    speed = Math.floor(speed * 0.5);
  }
  if (pokemon.ability === 'swift-swim' && (weather === 'rain' || weather === 'heavy-rain')) {
    speed = Math.floor(speed * 2);
  }
  if (pokemon.ability === 'slush-rush' && (weather === 'hail' || weather === 'snow')) {
    speed = Math.floor(speed * 2);
  }
  if (pokemon.ability === 'sand-rush' && weather === 'sandstorm') {
    speed = Math.floor(speed * 2);
  }
  if (tailwind) speed = Math.floor(speed * 2);

  return speed;
}

/** Stat computation from base stats, IVs, EVs and nature. */
export function computeStat(
  base: number,
  iv: number,
  ev: number,
  level: number,
  natureMod: number,
  isHp: boolean,
): number {
  if (isHp) {
    // Shedinja's 1 HP is the only exception; base 1 always yields 1.
    if (base === 1) return 1;
    return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
  }
  return Math.floor(
    (Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * natureMod,
  );
}

/** Catch rate calculation, for the overworld capture system. */
export function catchProbability(
  maxHp: number,
  currentHp: number,
  catchRate: number,
  ballMultiplier: number,
  statusMultiplier: number,
): number {
  const a =
    (((3 * maxHp - 2 * currentHp) * catchRate * ballMultiplier) / (3 * maxHp)) * statusMultiplier;
  if (a >= 255) return 1;
  const b = 65536 / Math.pow(255 / a, 0.1875);
  // Four consecutive shake checks.
  return Math.pow(b / 65536, 4);
}
