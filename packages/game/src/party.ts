/**
 * Party Pokémon — the player's own, as they exist outside a battle.
 *
 * This is the persistent form. `BattlePokemon` is the transient one the engine
 * works with, and the two are deliberately different types: a battle Pokémon
 * has stages, volatiles and a slot, none of which survive the fight. Keeping
 * them separate is what stops battle state leaking into a save file.
 */
import { Rng, clamp } from '@alola/core';
import { getSpecies, getMove } from '@alola/data';
import { makeBattlePokemon, computeStat, type BattlePokemon } from '@alola/battle';
import type { SavedPokemon } from '@alola/save';
import { movesetFor } from './moveset.ts';

export interface PartyPokemon {
  /** Stable within a save. */
  readonly uid: number;
  readonly species: string;
  nickname: string | null;
  level: number;
  exp: number;
  /** Personality value — every cosmetic roll derives from it. */
  readonly personality: number;
  readonly shiny: boolean;
  readonly alpha: boolean;
  readonly gender: 'male' | 'female' | 'genderless';
  readonly nature: string;
  readonly ability: string;
  item: string | null;
  moves: { id: string; pp: number }[];
  readonly ivs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  currentHp: number;
  status: string;
  friendship: number;
  readonly metLocation: string;
  readonly metLevel: number;
  readonly metDate: number;
  /** Size variation. Alphas are visibly larger. */
  readonly scale: number;
}

const NATURES = [
  'hardy', 'lonely', 'brave', 'adamant', 'naughty', 'bold', 'docile', 'relaxed',
  'impish', 'lax', 'timid', 'hasty', 'serious', 'jolly', 'naive', 'modest',
  'mild', 'quiet', 'bashful', 'rash', 'calm', 'gentle', 'sassy', 'careful', 'quirky',
];

let uidCounter = 1;

/** Reset the uid counter. Tests only — a save restores its own high-water mark. */
export function resetUidCounter(next = 1): void {
  uidCounter = next;
}

export function reserveUid(): number {
  return uidCounter++;
}

/** Max HP for a party member, from its species, level and IVs. */
export function maxHpOf(mon: PartyPokemon): number {
  return computeStat(getSpecies(mon.species).baseStats.hp, mon.ivs.hp, 0, mon.level, 1, true);
}

/**
 * Create a Pokémon.
 *
 * Every roll comes from the supplied Rng, so a capture is reproducible from
 * the encounter seed — which is what lets a battle be replayed and lets a
 * desynced client be corrected rather than argued with.
 */
export function createPokemon(params: {
  species: string;
  level: number;
  rng: Rng;
  metLocation: string;
  shiny?: boolean;
  alpha?: boolean;
  /** Override the derived moveset — used when restoring a save. */
  moves?: readonly string[];
}): PartyPokemon {
  const species = getSpecies(params.species);
  const rng = params.rng;

  const gender: PartyPokemon['gender'] =
    species.genderRatio === null ? 'genderless' : rng.next() < species.genderRatio ? 'male' : 'female';

  const alpha = params.alpha ?? false;
  const moves = (params.moves ?? movesetFor(params.species, params.level)).map((id) => ({
    id,
    pp: getMove(id).pp,
  }));

  const ivs = {
    hp: rng.int(0, 31), atk: rng.int(0, 31), def: rng.int(0, 31),
    spa: rng.int(0, 31), spd: rng.int(0, 31), spe: rng.int(0, 31),
  };

  const mon: PartyPokemon = {
    uid: reserveUid(),
    species: species.id,
    nickname: null,
    level: params.level,
    exp: expForLevel(params.level),
    personality: rng.int(0, 0x7fffffff),
    // 1/4096, as an exact rational — not a float comparison that drifts.
    shiny: params.shiny ?? rng.odds(1, 4096),
    alpha,
    gender,
    nature: NATURES[rng.int(0, NATURES.length - 1)],
    ability: species.abilities[rng.int(0, species.abilities.length - 1)],
    item: null,
    moves,
    ivs,
    currentHp: 0,
    status: 'none',
    friendship: 70,
    metLocation: params.metLocation,
    metLevel: params.level,
    metDate: Date.now(),
    // Alphas are the visibly-oversized individuals the brief asks for.
    scale: alpha ? 1.35 + rng.next() * 0.2 : 0.82 + rng.next() * 0.36,
  };

  mon.currentHp = maxHpOf(mon);
  return mon;
}

// ------------------------------------------------------------- experience

/**
 * A single medium-fast curve for everything.
 *
 * The mainline uses six growth curves. They exist to pace a 30-hour linear
 * campaign, and in an open world where the player chooses their own route they
 * mostly produce confusion about why one team member is lagging. One curve
 * keeps a party levelling together.
 */
export function expForLevel(level: number): number {
  return Math.floor(Math.pow(level, 3));
}

export function levelForExp(exp: number): number {
  return clamp(Math.floor(Math.cbrt(exp)), 1, 100);
}

/** Experience awarded for defeating a Pokémon. */
export function expYield(defeatedSpecies: string, defeatedLevel: number, isTrainerBattle: boolean): number {
  const base = getSpecies(defeatedSpecies).baseExp;
  return Math.floor((base * defeatedLevel) / 7) * (isTrainerBattle ? 3 : 2);
}

export interface LevelUpResult {
  readonly levelsGained: number;
  readonly newLevel: number;
  /** Moves the Pokémon gained access to at its new level. */
  readonly learned: string[];
}

/**
 * Award experience, levelling up and relearning as needed.
 *
 * Because movesets are derived rather than stored, a level-up can make a
 * stronger move legal. Anything newly legal is offered; slots past four are
 * filled by replacing the weakest move it already knows, which is what a
 * player would do anyway and avoids a modal prompt in the middle of a fight.
 */
export function awardExp(mon: PartyPokemon, amount: number): LevelUpResult {
  const before = mon.level;
  mon.exp += Math.max(0, Math.floor(amount));
  const after = clamp(levelForExp(mon.exp), before, 100);
  if (after === before) return { levelsGained: 0, newLevel: before, learned: [] };

  const hpBefore = maxHpOf(mon);
  mon.level = after;
  // Levelling heals by the HP the level-up itself granted, so a level-up in
  // battle is a small reward rather than a full restore.
  mon.currentHp = Math.min(maxHpOf(mon), mon.currentHp + (maxHpOf(mon) - hpBefore));

  const ideal = movesetFor(mon.species, after);
  const known = new Set(mon.moves.map((m) => m.id));
  const learned: string[] = [];

  for (const id of ideal) {
    if (known.has(id)) continue;
    learned.push(id);
    if (mon.moves.length < 4) {
      mon.moves.push({ id, pp: getMove(id).pp });
    } else {
      // Replace the weakest damaging move it knows.
      let weakestIndex = -1;
      let weakestPower = Infinity;
      for (let i = 0; i < mon.moves.length; i++) {
        const power = getMove(mon.moves[i].id).power ?? 0;
        if (power < weakestPower) {
          weakestPower = power;
          weakestIndex = i;
        }
      }
      const incoming = getMove(id).power ?? 0;
      if (weakestIndex >= 0 && incoming > weakestPower) {
        mon.moves[weakestIndex] = { id, pp: getMove(id).pp };
      } else {
        learned.pop();
      }
    }
    known.add(id);
  }

  return { levelsGained: after - before, newLevel: after, learned };
}

/**
 * What level should the starter be?
 *
 * Not a constant. The player begins wherever the world put them, and the
 * spawn table around that point is not tuned to a fixed number — around the
 * opening coast it runs level 3 to 14 with a median of 8. A hardcoded level 5
 * starter therefore meets its first wild Pokemon three levels up and can quite
 * reasonably lose, which is exactly what happened the first time this was
 * played end to end: a level 5 Litten blacked out to a level 8 Grubbin on the
 * opening encounter.
 *
 * So derive it: sit slightly above the local median, which makes the first few
 * fights winnable without making them free, and still leaves the high end of
 * the local range as a genuine threat.
 */
export function starterLevelFor(nearbyLevels: readonly number[]): number {
  if (nearbyLevels.length === 0) return 5;
  const sorted = [...nearbyLevels].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return clamp(median + 2, 5, 20);
}

// ------------------------------------------------------------------ health

export function healFully(mon: PartyPokemon): void {
  mon.currentHp = maxHpOf(mon);
  mon.status = 'none';
  for (const move of mon.moves) move.pp = getMove(move.id).pp;
}

export function isFainted(mon: PartyPokemon): boolean {
  return mon.currentHp <= 0;
}

/** Heal by an absolute amount, returning how much was actually restored. */
export function healBy(mon: PartyPokemon, amount: number): number {
  const max = maxHpOf(mon);
  const before = mon.currentHp;
  mon.currentHp = clamp(mon.currentHp + amount, 0, max);
  return mon.currentHp - before;
}

// ------------------------------------------------- battle <-> party bridge

/** Project a party member into the battle engine's representation. */
export function toBattlePokemon(mon: PartyPokemon, id: number, side: number, slot: number): BattlePokemon {
  const battle = makeBattlePokemon({
    id,
    speciesId: mon.species,
    level: mon.level,
    moves: mon.moves.map((m) => m.id),
    ability: mon.ability,
    item: mon.item,
    side,
    slot,
    nickname: mon.nickname ?? undefined,
    shiny: mon.shiny,
    scale: mon.scale,
    ivs: mon.ivs,
  });
  // Carry current condition into the fight. A party member does not arrive
  // healed just because a battle started.
  battle.hp = clamp(mon.currentHp, 0, battle.maxHp);
  battle.fainted = battle.hp <= 0;
  battle.status = mon.status as BattlePokemon['status'];
  for (const slotMove of battle.moves) {
    const stored = mon.moves.find((m) => m.id === slotMove.id);
    if (stored) slotMove.pp = Math.min(stored.pp, slotMove.maxPp);
  }
  return battle;
}

/** Write a battle result back onto the party member it came from. */
export function applyBattleResult(mon: PartyPokemon, battle: BattlePokemon): void {
  mon.currentHp = clamp(battle.hp, 0, maxHpOf(mon));
  mon.status = battle.status;
  for (const slotMove of battle.moves) {
    const stored = mon.moves.find((m) => m.id === slotMove.id);
    if (stored) stored.pp = slotMove.pp;
  }
}

// ------------------------------------------------------------ persistence

export function toSaved(mon: PartyPokemon): SavedPokemon {
  return {
    species: mon.species,
    form: 0,
    nickname: mon.nickname,
    level: mon.level,
    exp: mon.exp,
    personality: mon.personality,
    shiny: mon.shiny,
    alpha: mon.alpha,
    gender: mon.gender,
    nature: mon.nature,
    ability: mon.ability,
    item: mon.item,
    moves: mon.moves.map((m) => ({ id: m.id, pp: m.pp })),
    ivs: { ...mon.ivs },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    currentHp: mon.currentHp,
    status: mon.status,
    friendship: mon.friendship,
    metLocation: mon.metLocation,
    metLevel: mon.metLevel,
    metDate: mon.metDate,
    originalTrainer: 'player',
    scale: mon.scale,
  };
}

export function fromSaved(saved: SavedPokemon): PartyPokemon {
  // A save may reference a move that no longer exists; drop it rather than
  // crashing the load, per the schema's "tolerate unknown content" rule.
  const moves = saved.moves.filter((m) => {
    try {
      getMove(m.id);
      return true;
    } catch {
      return false;
    }
  });
  if (moves.length === 0) {
    for (const id of movesetFor(saved.species, saved.level)) {
      moves.push({ id, pp: getMove(id).pp });
    }
  }

  const mon: PartyPokemon = {
    uid: reserveUid(),
    species: saved.species,
    nickname: saved.nickname,
    level: saved.level,
    exp: saved.exp,
    personality: saved.personality,
    shiny: saved.shiny,
    alpha: saved.alpha,
    gender: saved.gender,
    nature: saved.nature,
    ability: saved.ability,
    item: saved.item,
    moves: moves.map((m) => ({ id: m.id, pp: m.pp })),
    ivs: { ...saved.ivs },
    currentHp: saved.currentHp,
    status: saved.status,
    friendship: saved.friendship,
    metLocation: saved.metLocation,
    metLevel: saved.metLevel,
    metDate: saved.metDate,
    scale: saved.scale,
  };
  mon.currentHp = clamp(mon.currentHp, 0, maxHpOf(mon));
  return mon;
}
