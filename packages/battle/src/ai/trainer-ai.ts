/**
 * Battle AI.
 *
 * Scores every legal action by simulating its immediate outcome, then picks
 * from the top by a difficulty-dependent policy. Deliberately *not* a deep
 * search: a full minimax over Pokémon battles is both expensive and produces
 * an opponent that feels inhuman. One-ply lookahead with good heuristics and a
 * tunable mistake rate produces an opponent that plays sensibly and can still
 * be outplayed — which is the actual design goal.
 *
 * Difficulty is expressed as *what the AI is allowed to know and do*, not as a
 * stat bonus. A Youngster genuinely does not think about type matchups; a
 * Kahuna does, and will switch. That reads as a skill difference rather than
 * as cheating.
 */
import { Rng } from '@alola/core';
import { getMove, effectivenessAgainst, getSpecies } from '@alola/data';
import { calculateDamage } from '../calc/damage.ts';
import {
  activePokemon, opponentsOf,
  type BattleState, type BattlePokemon, type BattleAction,
} from '../engine/state.ts';

export type AiDifficulty = 'wild' | 'novice' | 'trainer' | 'ace' | 'captain' | 'kahuna' | 'champion';

export interface AiConfig {
  /** Probability of taking the best action rather than sampling. */
  readonly optimality: number;
  /** Does it understand type effectiveness? */
  readonly usesTypeMatchups: boolean;
  /** Will it switch out of a bad matchup? */
  readonly willSwitch: boolean;
  /** Does it consider status moves and setup? */
  readonly usesStatus: boolean;
  /** Does it play around the opponent's likely move? */
  readonly predictsOpponent: boolean;
  /** Will it use items mid-battle? */
  readonly usesItems: boolean;
}

const DIFFICULTY_CONFIG: Readonly<Record<AiDifficulty, AiConfig>> = {
  // A wild Pokémon is not a tactician. It attacks, mostly at random, and
  // favours what it is good at without reasoning about the opponent.
  wild: {
    optimality: 0.35, usesTypeMatchups: false, willSwitch: false,
    usesStatus: false, predictsOpponent: false, usesItems: false,
  },
  novice: {
    optimality: 0.5, usesTypeMatchups: false, willSwitch: false,
    usesStatus: false, predictsOpponent: false, usesItems: false,
  },
  trainer: {
    optimality: 0.7, usesTypeMatchups: true, willSwitch: false,
    usesStatus: true, predictsOpponent: false, usesItems: true,
  },
  ace: {
    optimality: 0.85, usesTypeMatchups: true, willSwitch: true,
    usesStatus: true, predictsOpponent: false, usesItems: true,
  },
  captain: {
    optimality: 0.9, usesTypeMatchups: true, willSwitch: true,
    usesStatus: true, predictsOpponent: true, usesItems: true,
  },
  kahuna: {
    optimality: 0.95, usesTypeMatchups: true, willSwitch: true,
    usesStatus: true, predictsOpponent: true, usesItems: true,
  },
  champion: {
    optimality: 1.0, usesTypeMatchups: true, willSwitch: true,
    usesStatus: true, predictsOpponent: true, usesItems: true,
  },
};

export interface ScoredAction {
  readonly action: BattleAction;
  readonly score: number;
  readonly reason: string;
}

export class BattleAi {
  private readonly config: AiConfig;
  private readonly rng: Rng;

  readonly difficulty: AiDifficulty;

  constructor(difficulty: AiDifficulty, seed: number) {
    this.difficulty = difficulty;
    this.config = DIFFICULTY_CONFIG[difficulty];
    this.rng = new Rng(seed);
  }

  /** Choose an action for one Pokémon. */
  chooseAction(state: BattleState, pokemon: BattlePokemon): BattleAction {
    const options = this.scoreActions(state, pokemon);
    if (options.length === 0) {
      return { kind: 'pass', pokemonId: pokemon.id };
    }

    options.sort((a, b) => b.score - a.score);

    // Take the best with probability `optimality`; otherwise sample from the
    // top few weighted by score. This produces an opponent that usually plays
    // well and occasionally makes a *plausible* mistake, rather than a random
    // one — which is what makes a loss feel fair.
    if (this.rng.next() < this.config.optimality) {
      return options[0].action;
    }

    const pool = options.slice(0, Math.min(3, options.length));
    const weights = pool.map((o) => Math.max(0.01, o.score));
    const idx = this.rng.weightedIndex(weights);
    return pool[idx >= 0 ? idx : 0].action;
  }

  /** Score every legal action. Exposed so the AI can be inspected and tested. */
  scoreActions(state: BattleState, pokemon: BattlePokemon): ScoredAction[] {
    const out: ScoredAction[] = [];
    const foes = opponentsOf(state, pokemon.side);
    if (foes.length === 0) return out;

    for (const slot of pokemon.moves) {
      if (slot.pp <= 0 || slot.disabled) continue;
      const move = getMove(slot.id);

      for (const foe of foes) {
        out.push(this.scoreMove(state, pokemon, move, foe));
      }
    }

    if (this.config.willSwitch) {
      const switchOption = this.considerSwitch(state, pokemon, foes);
      if (switchOption) out.push(switchOption);
    }

    return out;
  }

  private scoreMove(
    state: BattleState,
    user: BattlePokemon,
    move: ReturnType<typeof getMove>,
    target: BattlePokemon,
  ): ScoredAction {
    const action: BattleAction = {
      kind: 'move',
      pokemonId: user.id,
      moveId: move.id,
      targetId: target.id,
    };

    if (move.category === 'status') {
      return { action, score: this.scoreStatusMove(state, user, move, target), reason: 'status' };
    }

    // Estimate damage with the random roll suppressed, so the AI reasons about
    // the expected case rather than getting lucky in its own head.
    const estimate = calculateDamage(
      {
        attacker: user,
        defender: target,
        move,
        weather: state.field.weather,
        terrain: state.field.terrain,
        targetCount: 1,
        critical: false,
        noRandom: true,
      },
      this.rng,
    );

    if (estimate.immune) {
      return { action, score: 0, reason: 'immune' };
    }

    // Base score: fraction of the target's remaining HP this removes.
    let score = Math.min(1, estimate.damage / Math.max(1, target.hp));

    // A guaranteed knockout is worth far more than proportional damage —
    // removing a Pokémon from the field is the single biggest swing available.
    if (estimate.damage >= target.hp) {
      score = 2 + (move.priority > 0 ? 0.5 : 0);
    }

    // Accuracy discount.
    const accuracy = move.accuracy ?? 100;
    score *= accuracy / 100;

    // Priority is valuable when the AI would otherwise be outsped and is low.
    if (move.priority > 0 && user.hp < user.maxHp * 0.35) {
      score *= 1.25;
    }

    if (!this.config.usesTypeMatchups) {
      // A naive AI does not reason about effectiveness, so flatten the signal
      // it would have provided — but keep raw power, since "this move hits
      // hard" is something even a novice notices.
      score = Math.min(1, (move.power ?? 0) / 120) * (accuracy / 100);
      if (estimate.damage >= target.hp) score += 0.6;
    }

    // Recoil is a real cost.
    if (move.recoil) score *= 0.88;

    // Do not waste a spread move's power on a single target in a double battle.
    if (move.target === 'all-adjacent-foes' && opponentsOf(state, user.side).length > 1) {
      score *= 1.3;
    }

    return { action, score, reason: `dmg=${estimate.damage} eff=${estimate.effectiveness}` };
  }

  private scoreStatusMove(
    state: BattleState,
    user: BattlePokemon,
    move: ReturnType<typeof getMove>,
    target: BattlePokemon,
  ): number {
    if (!this.config.usesStatus) return 0.05;

    let score = 0;

    // Healing, weighted by how much is actually missing.
    if (move.heal) {
      const missing = 1 - user.hp / user.maxHp;
      // Healing at full HP is a wasted turn; healing at 30% is excellent.
      score += missing > 0.45 ? missing * 1.4 : missing * 0.2;
    }

    // Status infliction.
    const secondary = move.secondary;
    if (secondary?.status && secondary.status !== 'none') {
      if (target.status !== 'none') return 0.02; // Already statused: pointless.
      // Immunity check — a smart AI does not Thunder Wave a Ground type.
      if (this.config.usesTypeMatchups) {
        if (secondary.status === 'paralysis' && target.types.includes('electric')) return 0.02;
        if (secondary.status === 'burn' && target.types.includes('fire')) return 0.02;
        if (
          (secondary.status === 'poison' || secondary.status === 'badly-poison') &&
          (target.types.includes('poison') || target.types.includes('steel'))
        ) {
          return 0.02;
        }
      }
      // Status is most valuable early, when there are turns left to benefit.
      score += target.hp > target.maxHp * 0.6 ? 0.75 : 0.35;
    }

    // Stat boosts on self.
    if (secondary?.boosts && secondary.self) {
      let total = 0;
      for (const delta of Object.values(secondary.boosts)) total += delta as number;
      // Setting up is good when healthy and safe, bad when about to faint.
      const healthFactor = user.hp / user.maxHp;
      score += total * 0.22 * healthFactor;
      // Do not set up into a maxed stat.
      for (const [stat, delta] of Object.entries(secondary.boosts)) {
        const current = user.stages[stat as keyof typeof user.stages] ?? 0;
        if ((delta as number) > 0 && current >= 4) score *= 0.25;
      }
    }

    // Debuffs on the target.
    if (secondary?.boosts && !secondary.self) {
      let total = 0;
      for (const delta of Object.values(secondary.boosts)) total += delta as number;
      score += Math.abs(total) * 0.18;
    }

    // Weather and terrain setting.
    if (move.setsWeather && state.field.weather !== move.setsWeather) score += 0.4;
    if (move.setsTerrain && state.field.terrain !== move.setsTerrain) score += 0.4;

    // Protect: valuable when low, wasteful when used repeatedly.
    if (move.id === 'protect') {
      score += user.hp < user.maxHp * 0.3 ? 0.5 : 0.15;
      if (user.volatiles.has('protect')) score = 0.01;
    }

    return score;
  }

  /**
   * Should the AI switch?
   * Only considered when the current matchup is genuinely bad and a clearly
   * better option is on the bench — switching for marginal gain wastes a turn
   * and reads as indecisive.
   */
  private considerSwitch(
    state: BattleState,
    pokemon: BattlePokemon,
    foes: readonly BattlePokemon[],
  ): ScoredAction | null {
    const side = state.sides[pokemon.side];
    if (!side) return null;

    const currentThreat = this.threatLevel(pokemon, foes);
    // Not in enough trouble to justify losing a turn.
    if (currentThreat < 0.6) return null;

    let bestId = -1;
    let bestImprovement = 0;

    for (const id of side.party) {
      if (id === pokemon.id) continue;
      const candidate = state.pokemon.get(id);
      if (!candidate || candidate.fainted) continue;
      // Already on the field.
      if (side.active.includes(id)) continue;

      const candidateThreat = this.threatLevel(candidate, foes);
      const improvement = currentThreat - candidateThreat;
      if (improvement > bestImprovement) {
        bestImprovement = improvement;
        bestId = id;
      }
    }

    // Require a substantial improvement to pay for the free hit taken.
    if (bestId < 0 || bestImprovement < 0.35) return null;

    return {
      action: { kind: 'switch', pokemonId: pokemon.id, incomingId: bestId },
      score: 0.8 + bestImprovement,
      reason: `switch improves matchup by ${bestImprovement.toFixed(2)}`,
    };
  }

  /** How dangerous is this matchup for `pokemon`? 0 = safe, 1 = dire. */
  private threatLevel(pokemon: BattlePokemon, foes: readonly BattlePokemon[]): number {
    let worst = 0;
    for (const foe of foes) {
      // Defensive: how hard can the foe's types hit us?
      let incoming = 0;
      for (const type of foe.types) {
        incoming = Math.max(incoming, effectivenessAgainst(type, pokemon.types));
      }
      // Offensive: how well can we hit back?
      let outgoing = 0;
      for (const type of pokemon.types) {
        outgoing = Math.max(outgoing, effectivenessAgainst(type, foe.types));
      }

      // Normalise: 4x incoming and 0.25x outgoing is the worst case.
      const matchup = Math.min(1, incoming / 2) * 0.6 + Math.min(1, (1 / Math.max(0.25, outgoing)) / 2) * 0.4;
      worst = Math.max(worst, matchup);
    }

    // Low HP makes any matchup more dangerous.
    const healthPenalty = 1 - pokemon.hp / pokemon.maxHp;
    return Math.min(1, worst * 0.7 + healthPenalty * 0.3);
  }

  /**
   * Should this wild Pokémon flee the battle?
   * Wild encounters can end without a knockout, which matters for the
   * overworld: a Wingull that loses interest and leaves is more believable
   * than one that fights to the death.
   */
  shouldFlee(pokemon: BattlePokemon, foes: readonly BattlePokemon[]): boolean {
    if (this.difficulty !== 'wild') return false;
    const species = getSpecies(pokemon.speciesId);
    if (species.temperament === 'apex' || species.temperament === 'aggressive') return false;

    const healthFraction = pokemon.hp / pokemon.maxHp;
    if (healthFraction > 0.3) return false;

    const threat = this.threatLevel(pokemon, foes);
    const fleeChance = (1 - healthFraction) * threat * 0.5;
    return this.rng.next() < fleeChance;
  }

  /** All active Pokémon on a side need an action each turn. */
  chooseActionsForSide(state: BattleState, side: number): BattleAction[] {
    return activePokemon(state, side).map((p) => this.chooseAction(state, p));
  }
}
