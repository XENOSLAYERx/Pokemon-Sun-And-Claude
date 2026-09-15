/**
 * Moveset selection.
 *
 * The species table deliberately carries no learnset. Hand-authoring level-up
 * tables for 53 species against a 50-move pool would be a large amount of data
 * that says very little — and it would rot every time a move is added or
 * retuned. Instead a moveset is *derived* from what the species is: its types,
 * whether it hits harder physically or specially, and how far along it is.
 *
 * Two properties this has to hold, because saves and battles both depend on
 * them:
 *
 * 1. **Deterministic.** The same species at the same level always produces the
 *    same moveset, on any machine. A wild Pikachu the player meets twice has
 *    the same moves, and a save that stores only `(species, level)` can
 *    reconstruct one exactly.
 * 2. **Level-appropriate.** A level 5 Rowlet must not open with Brave Bird.
 *    Power is gated behind a curve, so early encounters are survivable and
 *    late ones are not trivial.
 */
import { hashString } from '@alola/core';
import { MOVE_LIST, getMove, getSpecies, type MoveDefinition } from '@alola/data';

/**
 * Highest base power a Pokémon may know at a given level.
 *
 * Tuned so the starter-versus-route-one band (levels 5-12) sits on 40-60 power
 * moves — two or three turns to a knockout, which is long enough for type
 * matchups to matter and short enough that a random encounter is not a chore.
 */
export function powerCapForLevel(level: number): number {
  if (level <= 6) return 45;
  if (level <= 12) return 60;
  if (level <= 20) return 80;
  if (level <= 32) return 95;
  if (level <= 45) return 110;
  return 130;
}

/** Status moves unlock later — they are only interesting once fights last. */
const STATUS_MOVE_LEVEL = 14;

function isDamaging(move: MoveDefinition): boolean {
  return move.category !== 'status' && move.power !== null;
}

/**
 * Moves are ranked by power, but a move whose category does not match the
 * user's better attacking stat is discounted. A physical attacker holding a
 * special move it cannot leverage is a wasted slot, and the AI will pick it.
 */
function scoreFor(move: MoveDefinition, physical: boolean, cap: number): number {
  const power = move.power ?? 0;
  if (power > cap) return -Infinity;
  const matchesCategory = physical ? move.category === 'physical' : move.category === 'special';
  const accuracy = move.accuracy ?? 100;
  // Accuracy matters: Hydro Pump at 110/80 is not strictly better than Surf.
  return power * (accuracy / 100) * (matchesCategory ? 1 : 0.55);
}

/**
 * Pick the status move that suits this species, or null.
 *
 * Deliberately narrow: a setup move for a physical attacker, recovery for a
 * bulky one, Protect otherwise. A wild Pokémon that spends its turns on
 * situational status moves is not challenging, it is tedious.
 */
function statusMoveFor(speciesId: string, level: number): string | null {
  if (level < STATUS_MOVE_LEVEL) return null;
  const species = getSpecies(speciesId);
  const { atk, spa, def, spd, hp } = species.baseStats;
  const bulk = hp + def + spd;

  if (bulk >= 300 && level >= 24) return 'recover';
  if (atk >= spa && atk >= 95 && level >= 20) return 'swords-dance';
  if (level >= 30) return 'protect';
  return null;
}

/**
 * Derive a moveset for a species at a level.
 *
 * Order of preference: strongest legal STAB in each of its types, then the
 * best remaining legal move of any type for coverage, then a status move, then
 * whatever normal-type filler is left. A species always gets at least one
 * damaging move — a Pokémon with an empty moveset softlocks a battle.
 */
export function movesetFor(speciesId: string, level: number): string[] {
  const species = getSpecies(speciesId);
  const cap = powerCapForLevel(level);
  const physical = species.baseStats.atk >= species.baseStats.spa;
  const chosen: string[] = [];

  const add = (id: string | null | undefined): void => {
    if (!id) return;
    if (chosen.length >= 4) return;
    if (chosen.includes(id)) return;
    chosen.push(id);
  };

  const legal = MOVE_LIST.filter((m) => isDamaging(m) && (m.power ?? 0) <= cap);

  // 1. Best STAB per type the species has.
  for (const type of species.types) {
    const best = legal
      .filter((m) => m.type === type)
      .sort((a, b) => scoreFor(b, physical, cap) - scoreFor(a, physical, cap))[0];
    add(best?.id);
  }

  // 2. Coverage — the best non-STAB move available, so a matchup is never
  //    completely hopeless. Ties break deterministically on the species hash
  //    rather than on array order, so two species with identical stats do not
  //    end up as clones of each other.
  const tieBreak = hashString(speciesId) >>> 0;
  const coverage = legal
    .filter((m) => !species.types.includes(m.type))
    .sort((a, b) => {
      const d = scoreFor(b, physical, cap) - scoreFor(a, physical, cap);
      if (d !== 0) return d;
      return ((hashString(a.id) ^ tieBreak) >>> 0) - ((hashString(b.id) ^ tieBreak) >>> 0);
    });
  add(coverage[0]?.id);

  // 3. A status move, once fights are long enough for one to matter.
  add(statusMoveFor(speciesId, level));

  // 4. Fill any remaining slots with the next best coverage.
  for (const move of coverage) {
    if (chosen.length >= 4) break;
    add(move.id);
  }

  // 5. Guarantee. At very low levels a species whose types have no weak moves
  //    (Fairy's cheapest is Play Rough at 90) would otherwise come up empty.
  if (chosen.length === 0) {
    const weakest = MOVE_LIST.filter(isDamaging).sort((a, b) => (a.power ?? 0) - (b.power ?? 0))[0];
    add(weakest?.id ?? 'tackle');
  }

  return chosen;
}

/** Total PP of a moveset — used by the party screen and by healing. */
export function totalPp(moves: readonly string[]): number {
  return moves.reduce((sum, id) => sum + getMove(id).pp, 0);
}
