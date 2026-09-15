/**
 * The battle engine.
 *
 * A deterministic state machine: given the same state, the same actions and
 * the same RNG seed, it produces the same events every time. Everything the
 * presentation layer needs comes out as an event stream, so the renderer,
 * audio, battle log and netcode all read one source of truth.
 *
 * Turn structure:
 *   1. Collect actions for every active Pokémon.
 *   2. Resolve switches and items (they happen before moves).
 *   3. Sort moves by priority, then Speed.
 *   4. Execute each move, checking the user is still able to act.
 *   5. End-of-turn residuals: weather, status, item healing, field timers.
 *   6. Check for faints and battle end.
 */
import { Rng, clamp } from '@alola/core';
import {
  getMove, getSpecies, getZMove, zMoveForCrystal, effectivenessMessage,
  type MoveDefinition, type StatusCondition,
} from '@alola/data';
import {
  activePokemon, opponentsOf, sideHasFighters,
  type BattleState, type BattlePokemon, type BattleAction, type BattleEvent, type StatStages,
} from './state.ts';
import {
  calculateDamage, accuracyCheck, sortByTurnOrder, effectiveSpeed,
  rollCritical, MAX_STAGE, MIN_STAGE, type OrderEntry,
} from '../calc/damage.ts';
import { applyTotemPhases } from '../totem/totem.ts';

export interface EngineOptions {
  /** Seed for every roll this battle makes. */
  readonly seed: number;
  /** Cap on turns before the battle is declared a draw. Prevents stalls. */
  readonly maxTurns?: number;
}

export class BattleEngine {
  readonly state: BattleState;
  private readonly rng: Rng;
  private readonly maxTurns: number;
  private events: BattleEvent[] = [];

  constructor(state: BattleState, opts: EngineOptions) {
    this.state = state;
    this.rng = new Rng(opts.seed);
    this.maxTurns = opts.maxTurns ?? 300;
  }

  /** Drain the events emitted since the last call. */
  drainEvents(): BattleEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private emit(event: BattleEvent): void {
    this.events.push(event);
  }

  /**
   * Execute one full turn.
   * `actions` must contain an action for every non-fainted active Pokémon.
   */
  executeTurn(actions: readonly BattleAction[]): BattleEvent[] {
    if (this.state.ended) return this.drainEvents();

    this.state.turn++;
    this.emit({ type: 'turn-start', turn: this.state.turn });

    for (const p of this.state.pokemon.values()) p.hasActed = false;

    // 1. Switches and items resolve before any move.
    for (const action of actions) {
      if (action.kind === 'switch') this.resolveSwitch(action);
      else if (action.kind === 'item') this.resolveItem(action);
    }

    // 2. Order the move actions.
    const moveActions = actions.filter((a) => a.kind === 'move');
    const trickRoom = this.state.field.effects.has('trick-room');

    const entries: OrderEntry[] = [];
    for (const action of moveActions) {
      const pokemon = this.state.pokemon.get(action.pokemonId);
      if (!pokemon || pokemon.fainted) continue;
      const move = getMove(action.moveId);
      const side = this.state.sides[pokemon.side];
      entries.push({
        pokemonId: pokemon.id,
        priority: move.priority,
        speed: effectiveSpeed(pokemon, this.state.field.weather, side?.conditions.has('tailwind') ?? false),
        // Deterministic tiebreak drawn from the battle RNG, so replays match.
        tiebreak: this.rng.nextUint32(),
      });
    }

    const order = sortByTurnOrder(entries, trickRoom);

    // 3. Execute moves in order.
    for (const entry of order) {
      if (this.state.ended) break;
      const action = moveActions.find((a) => a.pokemonId === entry.pokemonId);
      if (!action || action.kind !== 'move') continue;
      this.resolveMove(action);
      this.checkFaints();
    }

    // 4. End-of-turn residuals.
    if (!this.state.ended) {
      this.endOfTurn();
      this.checkFaints();
    }

    // 5. Battle end conditions.
    this.checkBattleEnd();

    return this.drainEvents();
  }

  // ------------------------------------------------------------- actions

  private resolveSwitch(action: Extract<BattleAction, { kind: 'switch' }>): void {
    const outgoing = this.state.pokemon.get(action.pokemonId);
    const incoming = this.state.pokemon.get(action.incomingId);
    if (!incoming || incoming.fainted) return;

    if (outgoing) {
      this.emit({ type: 'switch-out', pokemonId: outgoing.id });
      // Stat stages and most volatiles reset on switch — this is what makes
      // switching a real cost rather than a free reset of a bad position.
      outgoing.stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };
      outgoing.volatiles.clear();
      const side = this.state.sides[outgoing.side];
      const slotIndex = side.active.indexOf(outgoing.id);
      if (slotIndex >= 0) {
        side.active[slotIndex] = incoming.id;
        incoming.side = outgoing.side;
        incoming.slot = slotIndex;
      }
      outgoing.slot = -1;
    }

    this.emit({ type: 'switch-in', pokemonId: incoming.id, side: incoming.side, slot: incoming.slot });
    this.applySwitchInAbility(incoming);
  }

  /** Entry abilities: Intimidate, weather setters, terrain surges. */
  private applySwitchInAbility(pokemon: BattlePokemon): void {
    switch (pokemon.ability) {
      case 'intimidate':
        for (const foe of opponentsOf(this.state, pokemon.side)) {
          this.applyStatChange(foe, 'atk', -1, pokemon);
        }
        break;
      case 'electric-surge':
        this.setTerrain('electric', 5);
        break;
      case 'grassy-surge':
        this.setTerrain('grassy', 5);
        break;
      case 'misty-surge':
        this.setTerrain('misty', 5);
        break;
      case 'psychic-surge':
        this.setTerrain('psychic', 5);
        break;
      case 'snow-warning':
        this.setWeather('hail', 5);
        break;
      case 'drizzle':
        this.setWeather('rain', 5);
        break;
      case 'drought':
        this.setWeather('harsh-sunlight', 5);
        break;
      default:
        break;
    }
  }

  private resolveItem(action: Extract<BattleAction, { kind: 'item' }>): void {
    const target = this.state.pokemon.get(action.targetId);
    if (!target) return;
    this.emit({ type: 'item-used', pokemonId: action.pokemonId, itemId: action.itemId });

    switch (action.itemId) {
      case 'potion':
        this.heal(target, 20);
        break;
      case 'super-potion':
        this.heal(target, 60);
        break;
      case 'hyper-potion':
        this.heal(target, 120);
        break;
      case 'max-potion':
        this.heal(target, target.maxHp);
        break;
      case 'revive':
        if (target.fainted) {
          target.fainted = false;
          target.hp = Math.floor(target.maxHp / 2);
          this.emit({ type: 'heal', targetId: target.id, amount: target.hp, remaining: target.hp });
        }
        break;
      case 'full-heal':
      case 'lum-berry':
        if (target.status !== 'none') {
          this.emit({ type: 'status-cured', targetId: target.id, status: target.status });
          target.status = 'none';
          target.statusTurns = 0;
        }
        break;
      default:
        break;
    }
  }

  // --------------------------------------------------------------- moves

  private resolveMove(action: Extract<BattleAction, { kind: 'move' }>): void {
    const user = this.state.pokemon.get(action.pokemonId);
    if (!user || user.fainted) return;

    // Pre-move status checks that can prevent acting entirely.
    if (!this.canAct(user)) return;

    let move = getMove(action.moveId);
    let isZMove = false;
    let powerOverride: number | undefined;

    // Z-Move conversion.
    if (action.zMove) {
      const side = this.state.sides[user.side];
      if (side.zUsed || !side.zCrystal) {
        this.emit({ type: 'move-failed', userId: user.id, reason: 'z-power-unavailable' });
      } else {
        const zDef = zMoveForCrystal(side.zCrystal);
        if (zDef && (zDef.type === move.type || zDef.exclusiveTo?.baseMove === move.id)) {
          side.zUsed = true;
          isZMove = true;
          powerOverride = zDef.power ?? undefined;
          // The pose is performed by the player; a missed pose costs power.
          // The engine records the beat here and the presentation layer plays
          // the cinematic — see zmove/cinematic.ts.
          this.emit({ type: 'z-power', userId: user.id, zMoveId: zDef.id, poseHit: true });
          if (zDef.power === null) {
            // Status Z-Move: the effect is the reward, not damage.
            this.emit({ type: 'message', text: `${user.name} unleashed ${zDef.name}!` });
          }
        }
      }
    }

    // PP.
    const slot = user.moves.find((m) => m.id === move.id);
    if (slot) {
      if (slot.pp <= 0 && !isZMove) {
        this.emit({ type: 'move-failed', userId: user.id, reason: 'no-pp' });
        return;
      }
      if (!isZMove) slot.pp--;
    }

    const targets = this.selectTargets(user, move, action.targetId);
    if (targets.length === 0) {
      this.emit({ type: 'move-failed', userId: user.id, reason: 'no-target' });
      return;
    }

    this.emit({
      type: 'move-used',
      userId: user.id,
      moveId: isZMove ? `z-${move.id}` : move.id,
      targetIds: targets.map((t) => t.id),
      isZMove,
    });

    // Status moves that set the field.
    if (move.setsWeather) this.setWeather(move.setsWeather, 5);
    if (move.setsTerrain) this.setTerrain(move.setsTerrain, 5);

    // Self-healing moves.
    if (move.heal) {
      this.heal(user, Math.floor(user.maxHp * move.heal));
    }

    for (const target of targets) {
      if (target.fainted) continue;

      // Protect.
      if (target.volatiles.has('protect') && (move.flags.protectable ?? true) && !isZMove) {
        this.emit({ type: 'move-failed', userId: user.id, reason: 'protected' });
        continue;
      }

      // Accuracy. Z-Moves still check accuracy, but never miss through Protect.
      if (!accuracyCheck(move, user, target, this.state.field.weather, this.rng)) {
        this.emit({ type: 'move-missed', userId: user.id, targetId: target.id });
        continue;
      }

      if (move.category === 'status') {
        this.applyStatusMove(user, target, move);
        continue;
      }

      // Fixed-damage moves: a damaging move with no fixed power computes its
      // damage from the target instead of from the formula. Nature's Madness
      // halves the target's current HP.
      if (move.power === null) {
        const amount = Math.max(1, Math.floor(target.hp / 2));
        this.dealDamage(target, amount, 1, false);
        continue;
      }

      // Multi-hit.
      const hits = move.multiHit ? this.rollHitCount(move.multiHit) : 1;
      let totalDamage = 0;

      for (let hit = 0; hit < hits; hit++) {
        if (target.fainted) break;

        const critical = rollCritical(this.rng, (move.critStage ?? 0) + (user.volatiles.get('focus-energy') ?? 0));
        const result = calculateDamage(
          {
            attacker: user,
            defender: target,
            move,
            powerOverride,
            weather: this.state.field.weather,
            terrain: this.state.field.terrain,
            targetCount: targets.length,
            critical,
            ignoreAbility: move.id === 'sunsteel-strike' || move.id === 'moongeist-beam',
          },
          this.rng,
        );

        if (result.immune) {
          this.emit({ type: 'move-failed', userId: user.id, reason: 'immune' });
          break;
        }

        this.dealDamage(target, result.damage, result.effectiveness, result.critical);
        totalDamage += result.damage;

        const message = effectivenessMessage(result.effectiveness);
        if (message && hit === 0) this.emit({ type: 'message', text: message });
      }

      // Drain.
      if (move.drain && totalDamage > 0) {
        this.heal(user, Math.max(1, Math.floor(totalDamage * move.drain)));
      }

      // Recoil.
      if (move.recoil && totalDamage > 0 && user.ability !== 'rock-head') {
        const recoil = Math.max(1, Math.floor(totalDamage * move.recoil));
        this.dealDamage(user, recoil, 1, false);
      }

      // Secondary effects.
      if (move.secondary && !target.fainted) {
        this.applySecondary(user, target, move, isZMove);
      }
    }

    // Life Orb recoil.
    if (user.item === 'life-orb' && move.category !== 'status' && !user.fainted) {
      this.dealDamage(user, Math.max(1, Math.floor(user.maxHp / 10)), 1, false);
    }

    user.hasActed = true;
  }

  /** Status checks that can prevent a Pokémon acting at all. */
  private canAct(user: BattlePokemon): boolean {
    // Flinch.
    if (user.volatiles.has('flinch')) {
      user.volatiles.delete('flinch');
      this.emit({ type: 'flinch', targetId: user.id });
      return false;
    }

    // Sleep.
    if (user.status === 'sleep') {
      user.statusTurns--;
      if (user.statusTurns <= 0) {
        user.status = 'none';
        this.emit({ type: 'status-cured', targetId: user.id, status: 'sleep' });
      } else {
        this.emit({ type: 'move-failed', userId: user.id, reason: 'asleep' });
        return false;
      }
    }

    // Freeze: 20% thaw chance per turn.
    if (user.status === 'freeze') {
      if (this.rng.chance(0.2)) {
        user.status = 'none';
        this.emit({ type: 'status-cured', targetId: user.id, status: 'freeze' });
      } else {
        this.emit({ type: 'move-failed', userId: user.id, reason: 'frozen' });
        return false;
      }
    }

    // Paralysis: 25% full-paralysis chance.
    if (user.status === 'paralysis' && this.rng.chance(0.25)) {
      this.emit({ type: 'move-failed', userId: user.id, reason: 'paralysed' });
      return false;
    }

    // Confusion: 33% chance to hit itself.
    const confusion = user.volatiles.get('confusion');
    if (confusion !== undefined) {
      if (confusion <= 0) {
        user.volatiles.delete('confusion');
      } else {
        user.volatiles.set('confusion', confusion - 1);
        if (this.rng.chance(1 / 3)) {
          // Self-hit uses a 40-power typeless physical attack against itself.
          const selfDamage = Math.max(
            1,
            Math.floor(
              (Math.floor(((Math.floor((2 * user.level) / 5) + 2) * 40 * user.stats.atk) / user.stats.def) / 50 + 2),
            ),
          );
          this.emit({ type: 'confusion-hit', targetId: user.id, amount: selfDamage });
          this.dealDamage(user, selfDamage, 1, false);
          return false;
        }
      }
    }

    return true;
  }

  private rollHitCount(range: readonly [number, number]): number {
    const [min, max] = range;
    if (min === max) return min;
    // The canonical 2-5 distribution: 2 and 3 at 35% each, 4 and 5 at 15%.
    if (min === 2 && max === 5) {
      const roll = this.rng.int(1, 100);
      if (roll <= 35) return 2;
      if (roll <= 70) return 3;
      if (roll <= 85) return 4;
      return 5;
    }
    return this.rng.int(min, max);
  }

  private selectTargets(user: BattlePokemon, move: MoveDefinition, preferredId: number): BattlePokemon[] {
    switch (move.target) {
      case 'self':
        return [user];
      case 'all-adjacent-foes':
        return opponentsOf(this.state, user.side);
      case 'all-adjacent': {
        const allies = activePokemon(this.state, user.side).filter((p) => p.id !== user.id);
        return [...opponentsOf(this.state, user.side), ...allies];
      }
      case 'all':
        return [user];
      case 'ally': {
        const allies = activePokemon(this.state, user.side).filter((p) => p.id !== user.id);
        return allies.length > 0 ? [allies[0]] : [user];
      }
      case 'random-foe': {
        const foes = opponentsOf(this.state, user.side);
        return foes.length > 0 ? [this.rng.pick(foes)] : [];
      }
      default: {
        const preferred = this.state.pokemon.get(preferredId);
        if (preferred && !preferred.fainted && preferred.side !== user.side) return [preferred];
        // The chosen target fainted before the move resolved — redirect rather
        // than wasting the turn, which is what the series does.
        const foes = opponentsOf(this.state, user.side);
        return foes.length > 0 ? [foes[0]] : [];
      }
    }
  }

  private applyStatusMove(user: BattlePokemon, target: BattlePokemon, move: MoveDefinition): void {
    if (move.id === 'protect') {
      user.volatiles.set('protect', 1);
      this.emit({ type: 'message', text: `${user.name} protected itself!` });
      return;
    }

    if (move.secondary) {
      this.applySecondary(user, target, move, false);
    }
  }

  private applySecondary(
    user: BattlePokemon,
    target: BattlePokemon,
    move: MoveDefinition,
    isZMove: boolean,
  ): void {
    const secondary = move.secondary;
    if (!secondary) return;

    // Z-Moves guarantee their secondary effects.
    const chance = isZMove ? 100 : secondary.chance;
    if (chance < 100 && this.rng.int(1, 100) > chance) return;

    const recipient = secondary.self ? user : target;

    if (secondary.status && secondary.status !== 'none') {
      this.applyStatus(recipient, secondary.status);
    }

    if (secondary.boosts) {
      for (const [stat, delta] of Object.entries(secondary.boosts)) {
        this.applyStatChange(recipient, stat as keyof StatStages, delta as number, user);
      }
    }

    if (secondary.flinch && !secondary.self) {
      // Flinch only lands if the target has not already moved.
      if (!target.hasActed) target.volatiles.set('flinch', 1);
    }

    if (secondary.confuse) {
      if (!recipient.volatiles.has('confusion')) {
        recipient.volatiles.set('confusion', this.rng.int(2, 5));
      }
    }
  }

  applyStatus(target: BattlePokemon, status: StatusCondition): boolean {
    if (target.fainted || status === 'none') return false;
    if (target.status !== 'none') return false;

    // Type immunities.
    if (status === 'burn' && target.types.includes('fire')) return false;
    if (status === 'freeze' && target.types.includes('ice')) return false;
    if ((status === 'poison' || status === 'badly-poison')) {
      if (target.types.includes('poison') || target.types.includes('steel')) return false;
    }
    if (status === 'paralysis' && target.types.includes('electric')) return false;

    // Ability immunities.
    if (target.ability === 'limber' && status === 'paralysis') return false;
    if (target.ability === 'water-veil' && status === 'burn') return false;
    if (target.ability === 'insomnia' && status === 'sleep') return false;

    // Misty Terrain blocks status on grounded Pokémon.
    if (this.state.field.terrain === 'misty' && !target.types.includes('flying')) return false;
    // Electric Terrain blocks sleep on grounded Pokémon.
    if (this.state.field.terrain === 'electric' && status === 'sleep' && !target.types.includes('flying')) {
      return false;
    }

    target.status = status;
    target.statusTurns = status === 'sleep' ? this.rng.int(1, 3) : 0;
    this.emit({ type: 'status-applied', targetId: target.id, status });
    return true;
  }

  applyStatChange(
    target: BattlePokemon,
    stat: keyof StatStages,
    delta: number,
    source: BattlePokemon,
  ): void {
    if (target.fainted || delta === 0) return;

    // Ability protections against opposing stat drops.
    if (delta < 0 && target.id !== source.id) {
      if (target.ability === 'clear-body' || target.ability === 'full-metal-body') {
        this.emit({ type: 'stat-change-failed', targetId: target.id, stat, reason: 'protected' });
        return;
      }
      if (target.ability === 'hyper-cutter' && stat === 'atk') {
        this.emit({ type: 'stat-change-failed', targetId: target.id, stat, reason: 'protected' });
        return;
      }
    }

    // Contrary inverts.
    const effective = target.ability === 'contrary' ? -delta : delta;

    const current = target.stages[stat];
    const next = clamp(current + effective, MIN_STAGE, MAX_STAGE);

    if (next === current) {
      this.emit({
        type: 'stat-change-failed',
        targetId: target.id,
        stat,
        reason: effective > 0 ? 'already-maxed' : 'already-minimised',
      });
      return;
    }

    target.stages[stat] = next;
    this.emit({ type: 'stat-change', targetId: target.id, stat, delta: effective, newStage: next });
  }

  // ------------------------------------------------------------- damage

  dealDamage(target: BattlePokemon, amount: number, effectiveness: number, critical: boolean): void {
    if (target.fainted) return;

    let applied = Math.min(amount, target.hp);

    // Focus Sash / Sturdy: survive a would-be lethal hit from full HP.
    if (
      applied >= target.hp &&
      target.hp === target.maxHp &&
      (target.item === 'focus-sash' || target.ability === 'sturdy')
    ) {
      applied = target.hp - 1;
      if (target.item === 'focus-sash') target.item = null;
    }

    target.hp -= applied;
    this.emit({
      type: 'damage',
      targetId: target.id,
      amount: applied,
      effectiveness,
      critical,
      remaining: target.hp,
    });

    if (target.hp <= 0) {
      target.hp = 0;
      target.fainted = true;
      this.emit({ type: 'faint', pokemonId: target.id });
    } else if (target.isTotem) {
      // Totem phase transitions are checked on every damage tick, so a big hit
      // can skip a phase rather than queueing them up.
      applyTotemPhases(this, target);
    }
  }

  heal(target: BattlePokemon, amount: number): void {
    if (target.fainted || target.hp >= target.maxHp) return;
    const applied = Math.min(amount, target.maxHp - target.hp);
    target.hp += applied;
    this.emit({ type: 'heal', targetId: target.id, amount: applied, remaining: target.hp });
  }

  // ---------------------------------------------------------- field state

  setWeather(weather: string, turns: number): void {
    if (this.state.field.weather === weather) return;
    if (this.state.field.weather) {
      this.emit({ type: 'weather-end', weather: this.state.field.weather });
    }
    this.state.field.weather = weather;
    this.state.field.weatherTurns = turns;
    this.emit({ type: 'weather-start', weather });
  }

  setTerrain(terrain: string, turns: number): void {
    if (this.state.field.terrain === terrain) return;
    if (this.state.field.terrain) {
      this.emit({ type: 'terrain-end', terrain: this.state.field.terrain });
    }
    this.state.field.terrain = terrain;
    this.state.field.terrainTurns = turns;
    this.emit({ type: 'terrain-start', terrain });
  }

  /** Public so Totem phase logic can emit through the same stream. */
  emitEvent(event: BattleEvent): void {
    this.emit(event);
  }

  get random(): Rng {
    return this.rng;
  }

  // --------------------------------------------------------- end of turn

  private endOfTurn(): void {
    // Weather damage and timers.
    const field = this.state.field;
    if (field.weather) {
      for (const side of this.state.sides) {
        for (const pokemon of activePokemon(this.state, side.index)) {
          const damage = this.weatherDamageFor(pokemon, field.weather);
          if (damage > 0) {
            this.emit({
              type: 'weather-damage',
              targetId: pokemon.id,
              weather: field.weather,
              amount: damage,
            });
            this.dealDamage(pokemon, damage, 1, false);
          }
        }
      }

      field.weatherTurns--;
      if (field.weatherTurns <= 0) {
        this.emit({ type: 'weather-end', weather: field.weather });
        field.weather = null;
      }
    }

    if (field.terrain) {
      // Grassy Terrain heals grounded Pokémon.
      if (field.terrain === 'grassy') {
        for (const side of this.state.sides) {
          for (const pokemon of activePokemon(this.state, side.index)) {
            if (!pokemon.types.includes('flying') && pokemon.ability !== 'levitate') {
              this.heal(pokemon, Math.max(1, Math.floor(pokemon.maxHp / 16)));
            }
          }
        }
      }
      field.terrainTurns--;
      if (field.terrainTurns <= 0) {
        this.emit({ type: 'terrain-end', terrain: field.terrain });
        field.terrain = null;
      }
    }

    // Status residuals and item healing.
    for (const side of this.state.sides) {
      for (const pokemon of activePokemon(this.state, side.index)) {
        this.applyStatusResidual(pokemon);
        if (pokemon.item === 'leftovers' && !pokemon.fainted) {
          this.heal(pokemon, Math.max(1, Math.floor(pokemon.maxHp / 16)));
        }
      }
    }

    // Clear single-turn volatiles.
    for (const pokemon of this.state.pokemon.values()) {
      pokemon.volatiles.delete('protect');
      pokemon.volatiles.delete('flinch');
    }

    // Side condition timers.
    for (const side of this.state.sides) {
      for (const [key, turns] of side.conditions) {
        if (turns <= 1) side.conditions.delete(key);
        else side.conditions.set(key, turns - 1);
      }
    }

    // Field effect timers.
    for (const [key, turns] of field.effects) {
      if (turns <= 1) field.effects.delete(key);
      else field.effects.set(key, turns - 1);
    }
  }

  private weatherDamageFor(pokemon: BattlePokemon, weather: string): number {
    if (weather === 'sandstorm') {
      if (
        pokemon.types.includes('rock') ||
        pokemon.types.includes('ground') ||
        pokemon.types.includes('steel') ||
        pokemon.ability === 'sand-veil' ||
        pokemon.ability === 'sand-rush'
      ) {
        return 0;
      }
      return Math.max(1, Math.floor(pokemon.maxHp / 16));
    }
    if (weather === 'hail') {
      if (pokemon.types.includes('ice') || pokemon.ability === 'snow-cloak' || pokemon.ability === 'ice-body') {
        return 0;
      }
      return Math.max(1, Math.floor(pokemon.maxHp / 16));
    }
    return 0;
  }

  private applyStatusResidual(pokemon: BattlePokemon): void {
    if (pokemon.fainted || pokemon.status === 'none') return;

    let damage = 0;
    switch (pokemon.status) {
      case 'burn':
        damage = Math.max(1, Math.floor(pokemon.maxHp / 16));
        break;
      case 'poison':
        damage = Math.max(1, Math.floor(pokemon.maxHp / 8));
        break;
      case 'badly-poison':
        pokemon.statusTurns++;
        // Toxic ramps: n/16 of max HP on turn n.
        damage = Math.max(1, Math.floor((pokemon.maxHp * pokemon.statusTurns) / 16));
        break;
      default:
        return;
    }

    if (damage > 0) {
      this.emit({
        type: 'status-damage',
        targetId: pokemon.id,
        status: pokemon.status,
        amount: damage,
      });
      this.dealDamage(pokemon, damage, 1, false);
    }
  }

  private checkFaints(): void {
    for (const pokemon of this.state.pokemon.values()) {
      if (pokemon.hp <= 0 && !pokemon.fainted) {
        pokemon.fainted = true;
        this.emit({ type: 'faint', pokemonId: pokemon.id });
      }
    }
  }

  private checkBattleEnd(): void {
    if (this.state.ended) return;

    const alive = this.state.sides.filter((s) => sideHasFighters(this.state, s.index));

    if (alive.length <= 1) {
      this.state.ended = true;
      this.state.winner = alive.length === 1 ? alive[0].index : null;
      this.emit({
        type: 'battle-end',
        winner: this.state.winner,
        reason: alive.length === 1 ? 'defeat' : 'draw',
      });
      return;
    }

    if (this.state.turn >= this.maxTurns) {
      this.state.ended = true;
      this.state.winner = null;
      this.emit({ type: 'battle-end', winner: null, reason: 'turn-limit' });
    }
  }

  /** Force the battle to end — used when the player runs or a cutscene takes over. */
  forceEnd(winner: number | null, reason: string): void {
    if (this.state.ended) return;
    this.state.ended = true;
    this.state.winner = winner;
    this.emit({ type: 'battle-end', winner, reason });
  }
}

/** Convenience: build a battle-ready Pokémon from species data. */
export function makeBattlePokemon(params: {
  id: number;
  speciesId: string;
  level: number;
  moves: readonly string[];
  ability?: string;
  item?: string | null;
  side: number;
  slot: number;
  nickname?: string;
  shiny?: boolean;
  scale?: number;
  isTotem?: boolean;
  /**
   * IVs. A single number applies to every stat (the common case for a wild
   * Pokémon or a test); a per-stat record carries a real spread, which is what
   * a captured Pokémon has once it is stored in a save.
   */
  ivs?: number | Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  evs?: number;
}): BattlePokemon {
  const species = getSpecies(params.speciesId);
  const ivSpec = params.ivs ?? 31;
  const ivFor = (key: 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'): number =>
    typeof ivSpec === 'number' ? ivSpec : ivSpec[key] ?? 31;
  const ev = params.evs ?? 0;
  const level = params.level;

  const stat = (base: number, iv: number, isHp: boolean): number => {
    if (isHp) return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
    return Math.floor((Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * 1);
  };

  const stats = {
    hp: stat(species.baseStats.hp, ivFor('hp'), true),
    atk: stat(species.baseStats.atk, ivFor('atk'), false),
    def: stat(species.baseStats.def, ivFor('def'), false),
    spa: stat(species.baseStats.spa, ivFor('spa'), false),
    spd: stat(species.baseStats.spd, ivFor('spd'), false),
    spe: stat(species.baseStats.spe, ivFor('spe'), false),
  };

  return {
    id: params.id,
    speciesId: species.id,
    name: params.nickname ?? species.name,
    level,
    types: species.types,
    shiny: params.shiny ?? false,
    stats,
    hp: stats.hp,
    maxHp: stats.hp,
    stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
    status: 'none',
    statusTurns: 0,
    volatiles: new Map(),
    moves: params.moves.map((id) => {
      const def = getMove(id);
      return { id, pp: def.pp, maxPp: def.pp, disabled: false };
    }),
    ability: params.ability ?? species.abilities[0],
    item: params.item ?? null,
    side: params.side,
    slot: params.slot,
    fainted: false,
    hasActed: false,
    scale: params.scale ?? 1,
    isTotem: params.isTotem ?? false,
    totemPhase: 0,
  };
}

export { getZMove };
