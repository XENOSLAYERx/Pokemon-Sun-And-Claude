/** Move definition schema. */
import type { PokemonType } from '../types.ts';
import type { StatKey } from '../species/schema.ts';

export type MoveCategory = 'physical' | 'special' | 'status';

export type StatusCondition =
  | 'none' | 'burn' | 'freeze' | 'paralysis' | 'poison' | 'badly-poison' | 'sleep';

export type MoveTarget =
  | 'normal'          // One adjacent target, chosen by the player.
  | 'self'
  | 'all-adjacent-foes'
  | 'all-adjacent'    // Includes the ally in doubles.
  | 'all'             // Whole field.
  | 'ally'
  | 'random-foe';

/**
 * Contact / sound / punch etc. Flags exist so abilities and items can key off
 * a move's properties without the engine hardcoding move lists.
 */
export interface MoveFlags {
  contact?: boolean;
  sound?: boolean;
  punch?: boolean;
  bite?: boolean;
  pulse?: boolean;
  dance?: boolean;
  /** Bypasses substitute and most protection. */
  authentic?: boolean;
  /** Blocked by Protect and friends. */
  protectable?: boolean;
  /** Can be reflected by Magic Coat. */
  reflectable?: boolean;
  /** Cannot be used twice in a row (Torment) / requires a recharge turn. */
  recharge?: boolean;
  /** Two-turn move: charges, then strikes. */
  charge?: boolean;
  /** Ignores accuracy checks entirely. */
  alwaysHits?: boolean;
  /** Hits airborne targets even when they are semi-invulnerable. */
  hitsAirborne?: boolean;
}

export interface SecondaryEffect {
  /** Percent chance, 0–100. */
  chance: number;
  status?: StatusCondition;
  /** Stat stage changes applied to the target (or self, if `self` is true). */
  boosts?: Partial<Record<StatKey, number>>;
  self?: boolean;
  /** Causes the target to flinch this turn. */
  flinch?: boolean;
  /** Confuses the target. */
  confuse?: boolean;
}

export interface MoveDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: PokemonType;
  readonly category: MoveCategory;
  /** Null for status moves. */
  readonly power: number | null;
  /** Null means "never misses". */
  readonly accuracy: number | null;
  readonly pp: number;
  /** Move order modifier. +1 Quick Attack, -6 Trick Room. */
  readonly priority: number;
  readonly target: MoveTarget;
  readonly flags: MoveFlags;
  readonly secondary?: SecondaryEffect;
  /** Multi-hit range, e.g. [2, 5] for Bullet Seed. */
  readonly multiHit?: readonly [number, number];
  /** Fraction of damage dealt recovered by the user. */
  readonly drain?: number;
  /** Fraction of damage dealt taken as recoil. */
  readonly recoil?: number;
  /** Fraction of the user's max HP restored. */
  readonly heal?: number;
  /** Bumps the critical-hit stage. */
  readonly critStage?: number;
  /** Field effect this move sets. */
  readonly setsWeather?: string;
  readonly setsTerrain?: string;
  readonly description: string;
  /** VFX/camera key used by the battle presentation layer. */
  readonly animation: string;
}
