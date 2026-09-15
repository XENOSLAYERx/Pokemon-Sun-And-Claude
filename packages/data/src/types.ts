/**
 * Elemental types and the effectiveness chart.
 *
 * The chart is stored as a flat Float32Array indexed by (attacker * 18 + defender).
 * A nested object lookup costs two hash lookups per call; the battle engine
 * evaluates effectiveness several times per move (once per defending type, per
 * target, plus AI lookahead scoring dozens of candidate moves per turn), so a
 * contiguous typed array with integer indexing is measurably better and — more
 * importantly — allocation-free.
 */

export const PokemonTypes = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const;

export type PokemonType = (typeof PokemonTypes)[number];

export const TYPE_COUNT = PokemonTypes.length;

const TYPE_INDEX: Readonly<Record<PokemonType, number>> = Object.freeze(
  Object.fromEntries(PokemonTypes.map((t, i) => [t, i])) as Record<PokemonType, number>,
);

export function typeIndex(t: PokemonType): number {
  return TYPE_INDEX[t];
}

/**
 * Effectiveness multipliers. Rows = attacking type, columns = defending type.
 * 0 = immune, 0.5 = not very effective, 1 = neutral, 2 = super effective.
 */
const CHART = new Float32Array(TYPE_COUNT * TYPE_COUNT).fill(1);

function setEffect(attacker: PokemonType, multiplier: number, defenders: readonly PokemonType[]): void {
  const row = TYPE_INDEX[attacker] * TYPE_COUNT;
  for (const d of defenders) CHART[row + TYPE_INDEX[d]] = multiplier;
}

setEffect('normal', 0.5, ['rock', 'steel']);
setEffect('normal', 0, ['ghost']);

setEffect('fire', 2, ['grass', 'ice', 'bug', 'steel']);
setEffect('fire', 0.5, ['fire', 'water', 'rock', 'dragon']);

setEffect('water', 2, ['fire', 'ground', 'rock']);
setEffect('water', 0.5, ['water', 'grass', 'dragon']);

setEffect('electric', 2, ['water', 'flying']);
setEffect('electric', 0.5, ['electric', 'grass', 'dragon']);
setEffect('electric', 0, ['ground']);

setEffect('grass', 2, ['water', 'ground', 'rock']);
setEffect('grass', 0.5, ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel']);

setEffect('ice', 2, ['grass', 'ground', 'flying', 'dragon']);
setEffect('ice', 0.5, ['fire', 'water', 'ice', 'steel']);

setEffect('fighting', 2, ['normal', 'ice', 'rock', 'dark', 'steel']);
setEffect('fighting', 0.5, ['poison', 'flying', 'psychic', 'bug', 'fairy']);
setEffect('fighting', 0, ['ghost']);

setEffect('poison', 2, ['grass', 'fairy']);
setEffect('poison', 0.5, ['poison', 'ground', 'rock', 'ghost']);
setEffect('poison', 0, ['steel']);

setEffect('ground', 2, ['fire', 'electric', 'poison', 'rock', 'steel']);
setEffect('ground', 0.5, ['grass', 'bug']);
setEffect('ground', 0, ['flying']);

setEffect('flying', 2, ['grass', 'fighting', 'bug']);
setEffect('flying', 0.5, ['electric', 'rock', 'steel']);

setEffect('psychic', 2, ['fighting', 'poison']);
setEffect('psychic', 0.5, ['psychic', 'steel']);
setEffect('psychic', 0, ['dark']);

setEffect('bug', 2, ['grass', 'psychic', 'dark']);
setEffect('bug', 0.5, ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy']);

setEffect('rock', 2, ['fire', 'ice', 'flying', 'bug']);
setEffect('rock', 0.5, ['fighting', 'ground', 'steel']);

setEffect('ghost', 2, ['psychic', 'ghost']);
setEffect('ghost', 0.5, ['dark']);
setEffect('ghost', 0, ['normal']);

setEffect('dragon', 2, ['dragon']);
setEffect('dragon', 0.5, ['steel']);
setEffect('dragon', 0, ['fairy']);

setEffect('dark', 2, ['psychic', 'ghost']);
setEffect('dark', 0.5, ['fighting', 'dark', 'fairy']);

setEffect('steel', 2, ['ice', 'rock', 'fairy']);
setEffect('steel', 0.5, ['fire', 'water', 'electric', 'steel']);

setEffect('fairy', 2, ['fighting', 'dragon', 'dark']);
setEffect('fairy', 0.5, ['fire', 'poison', 'steel']);

/** Single-type effectiveness lookup. */
export function effectiveness(attacking: PokemonType, defending: PokemonType): number {
  return CHART[TYPE_INDEX[attacking] * TYPE_COUNT + TYPE_INDEX[defending]];
}

/**
 * Effectiveness against a (possibly dual-typed) defender.
 * Multiplicative, so a 4x or 0.25x result is possible — and 0 dominates.
 */
export function effectivenessAgainst(
  attacking: PokemonType,
  defenderTypes: readonly PokemonType[],
): number {
  let mult = 1;
  const row = TYPE_INDEX[attacking] * TYPE_COUNT;
  for (const d of defenderTypes) {
    mult *= CHART[row + TYPE_INDEX[d]];
    if (mult === 0) return 0;
  }
  return mult;
}

/** The message the battle log shows for a given multiplier. */
export function effectivenessMessage(mult: number): string | null {
  if (mult === 0) return "It doesn't affect the target...";
  if (mult >= 4) return "It's devastatingly effective!";
  if (mult > 1) return "It's super effective!";
  if (mult < 1) return "It's not very effective...";
  return null;
}

/** Defensive profile — used by team-builder UI and by the trainer AI when switching. */
export function defensiveProfile(defenderTypes: readonly PokemonType[]): Record<PokemonType, number> {
  const out = {} as Record<PokemonType, number>;
  for (const atk of PokemonTypes) out[atk] = effectivenessAgainst(atk, defenderTypes);
  return out;
}

/** Types this defender is weak to (>1x). */
export function weaknessesOf(defenderTypes: readonly PokemonType[]): PokemonType[] {
  return PokemonTypes.filter((t) => effectivenessAgainst(t, defenderTypes) > 1);
}

/** Types this defender resists or is immune to (<1x). */
export function resistancesOf(defenderTypes: readonly PokemonType[]): PokemonType[] {
  return PokemonTypes.filter((t) => effectivenessAgainst(t, defenderTypes) < 1);
}
