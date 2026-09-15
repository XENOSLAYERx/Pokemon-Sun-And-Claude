/**
 * A battle session.
 *
 * Sits between the player and the deterministic engine: it owns the party
 * projection, the opponent's AI, the actions the engine does not model (throwing
 * a ball, running), and the translation of the engine's event stream into lines
 * a person can read.
 *
 * Deliberately headless. The client drives it and renders the result; it makes
 * no rendering decisions itself, which is what lets a whole battle be played
 * out in a test.
 */
import { Rng } from '@alola/core';
import {
  getSpecies, getMove, getItem, getZMove, zMoveForCrystal, effectivenessMessage,
  type ZMoveDefinition,
} from '@alola/data';
import {
  BattleEngine, BattleAi, createField, generateArena, evaluatePose,
  type BattleState, type BattlePokemon, type BattleAction, type BattleEvent,
  type BattleArena, type TerrainProbe, type AiDifficulty, type PoseInput, type PoseResult,
} from '@alola/battle';
import { attemptCapture, type CaptureAttempt } from './capture.ts';
import { canFleeFrom, type EncounterOffer } from './encounter.ts';
import {
  toBattlePokemon, applyBattleResult, awardExp, expYield, createPokemon, isFainted,
  type PartyPokemon, type LevelUpResult,
} from './party.ts';
import type { GameProfile } from './profile.ts';

export type BattleOutcome = 'ongoing' | 'won' | 'lost' | 'fled' | 'caught' | 'flee-failed';

export type PlayerChoice =
  | { kind: 'move'; moveId: string; zMove?: boolean; pose?: readonly PoseInput[] }
  | { kind: 'switch'; partyIndex: number }
  | { kind: 'item'; itemId: string; partyIndex: number }
  | { kind: 'ball'; ballId: string }
  | { kind: 'run' };

export interface TurnResult {
  readonly events: readonly BattleEvent[];
  /** Human-readable lines, in order, for the battle log. */
  readonly messages: readonly string[];
  readonly outcome: BattleOutcome;
  readonly capture: CaptureAttempt | null;
  readonly poseResult: PoseResult | null;
  readonly levelUps: readonly { mon: PartyPokemon; result: LevelUpResult }[];
  readonly expGained: number;
}

export interface BattleSessionOptions {
  readonly profile: GameProfile;
  readonly offer: EncounterOffer;
  readonly probe: TerrainProbe;
  readonly weather: string | null;
  readonly hour: number;
  readonly island: string | null;
  readonly seed: number;
  readonly enclosed?: boolean;
  /** Difficulty for the opposing side. Wild Pokémon play badly, on purpose. */
  readonly difficulty?: AiDifficulty;
}

/** The engine ids the player's and the foe's sides use. */
const PLAYER_SIDE = 0;
const FOE_SIDE = 1;

export class BattleSession {
  readonly state: BattleState;
  readonly arena: BattleArena;
  readonly engine: BattleEngine;
  readonly profile: GameProfile;
  readonly offer: EncounterOffer;
  /** The wild Pokémon, as a party member — only realised if it is caught. */
  readonly wild: PartyPokemon;

  private readonly ai: BattleAi;
  private readonly rng: Rng;
  private readonly hour: number;
  private readonly onWater: boolean;
  /** engine id -> the party member it projects. */
  private readonly partyByBattleId = new Map<number, PartyPokemon>();

  outcome: BattleOutcome = 'ongoing';
  /** Set when the player caught the wild Pokémon. */
  captured: PartyPokemon | null = null;

  constructor(opts: BattleSessionOptions) {
    this.profile = opts.profile;
    this.offer = opts.offer;
    this.rng = new Rng(opts.seed).fork('session');
    this.hour = opts.hour;

    const candidate = opts.offer.candidate;
    this.arena = generateArena(opts.probe, {
      x: candidate.position.x,
      z: candidate.position.z,
      weather: opts.weather,
      hour: opts.hour,
      island: opts.island,
      enclosed: opts.enclosed ?? false,
    });
    this.onWater = this.arena.surface === 'water';

    // The wild Pokémon is built through the ordinary creation path, so a
    // capture is just "keep the object we already had" rather than a second,
    // subtly different construction.
    this.wild = createPokemon({
      species: candidate.speciesId,
      level: candidate.level,
      rng: new Rng(opts.seed).fork('wild'),
      metLocation: opts.island ?? 'Alola',
    });

    const pokemon = new Map<number, BattlePokemon>();
    let nextId = 1;

    const playerIds: number[] = [];
    for (const mon of this.profile.party) {
      const id = nextId++;
      const battle = toBattlePokemon(mon, id, PLAYER_SIDE, playerIds.length === 0 ? 0 : -1);
      pokemon.set(id, battle);
      this.partyByBattleId.set(id, mon);
      playerIds.push(id);
    }

    const wildId = nextId++;
    pokemon.set(wildId, toBattlePokemon(this.wild, wildId, FOE_SIDE, 0));

    // Lead with the first Pokémon that can actually fight.
    const leadIndex = this.profile.party.findIndex((p) => !isFainted(p));
    const lead = playerIds[leadIndex >= 0 ? leadIndex : 0];
    for (const id of playerIds) {
      const p = pokemon.get(id)!;
      p.slot = id === lead ? 0 : -1;
    }

    this.state = {
      format: 'single',
      slotsPerSide: 1,
      sides: [
        {
          index: PLAYER_SIDE, trainerName: this.profile.name, isPlayer: true,
          active: [lead], party: playerIds, conditions: new Map(),
          zUsed: false, zCrystal: this.equippedCrystal(),
        },
        {
          index: FOE_SIDE, trainerName: getSpecies(candidate.speciesId).name, isPlayer: false,
          active: [wildId], party: [wildId], conditions: new Map(),
          zUsed: false, zCrystal: null,
        },
      ],
      pokemon,
      field: createField(),
      turn: 0,
      winner: null,
      ended: false,
      arena: this.arena,
    };

    // Inherit the overworld's weather, so a fight in a thunderstorm is a fight
    // in a thunderstorm.
    if (opts.weather && opts.weather !== 'clear' && opts.weather !== 'cloudy') {
      this.state.field.weather = opts.weather;
      this.state.field.weatherTurns = 999;
    }

    this.engine = new BattleEngine(this.state, { seed: opts.seed });
    this.ai = new BattleAi(opts.difficulty ?? 'wild', opts.seed ^ 0x5f3a);

    this.profile.recordSeen(candidate.speciesId);
  }

  // ------------------------------------------------------------ accessors

  get playerActive(): BattlePokemon {
    return this.state.pokemon.get(this.state.sides[PLAYER_SIDE].active[0])!;
  }

  get foeActive(): BattlePokemon {
    return this.state.pokemon.get(this.state.sides[FOE_SIDE].active[0])!;
  }

  get playerActiveParty(): PartyPokemon | null {
    return this.partyByBattleId.get(this.playerActive.id) ?? null;
  }

  get canFlee(): boolean {
    return canFleeFrom(this.offer);
  }

  /** The Z-Crystal the player can use, if any. */
  private equippedCrystal(): string | null {
    if (!this.profile.bag.hasKeyItem('z-ring')) return null;
    // Prefer a crystal matching a move the lead actually knows; the UI can
    // override by setting `zCrystal` directly.
    for (const crystal of this.profile.zCrystals) return crystal;
    return null;
  }

  /** The Z-Move available to the active Pokémon right now, or null. */
  availableZMove(): ZMoveDefinition | null {
    const side = this.state.sides[PLAYER_SIDE];
    if (side.zUsed || !side.zCrystal) return null;
    const zMove = zMoveForCrystal(side.zCrystal);
    if (!zMove) return null;
    // The crystal only works if the Pokémon knows a move of that type.
    const knowsType = this.playerActive.moves.some(
      (m) => !m.disabled && m.pp > 0 && getMove(m.id).type === zMove.type,
    );
    return knowsType ? zMove : null;
  }

  // ------------------------------------------------------------------ turn

  /**
   * Resolve one turn from the player's choice.
   *
   * Balls and running are resolved here rather than in the engine: neither is
   * a battle mechanic, both end the encounter, and modelling them as engine
   * actions would put capture rates inside the thing that has to stay a pure
   * function of (state, actions, seed).
   */
  submit(choice: PlayerChoice): TurnResult {
    if (this.outcome !== 'ongoing') {
      return this.emptyResult(['The battle is already over.']);
    }

    if (choice.kind === 'ball') return this.throwBall(choice.ballId);
    if (choice.kind === 'run') return this.tryRun();

    const action = this.actionFor(choice);
    if (!action) return this.emptyResult(['That cannot be done right now.']);

    let poseResult: PoseResult | null = null;
    if (choice.kind === 'move' && choice.zMove) {
      const zMove = this.availableZMove();
      if (zMove) poseResult = evaluatePose(zMove, choice.pose ?? []);
    }

    const foeAction = this.ai.chooseAction(this.state, this.foeActive);
    const events = this.engine.executeTurn([action, foeAction]);

    return this.finishTurn(events, poseResult);
  }

  /** Switch in a replacement after a faint, without costing a turn. */
  replaceFainted(partyIndex: number): TurnResult {
    const mon = this.profile.party[partyIndex];
    if (!mon || isFainted(mon)) return this.emptyResult(['That Pokémon cannot battle.']);

    const incomingId = [...this.partyByBattleId.entries()].find(([, p]) => p === mon)?.[0];
    if (incomingId === undefined) return this.emptyResult(['That Pokémon is not here.']);

    const outgoing = this.playerActive;
    outgoing.slot = -1;
    const incoming = this.state.pokemon.get(incomingId)!;
    incoming.slot = 0;
    this.state.sides[PLAYER_SIDE].active[0] = incomingId;

    return this.finishTurn(
      [{ type: 'switch-in', pokemonId: incomingId, side: PLAYER_SIDE, slot: 0 }],
      null,
    );
  }

  private actionFor(choice: PlayerChoice): BattleAction | null {
    const active = this.playerActive;

    if (choice.kind === 'move') {
      const slot = active.moves.find((m) => m.id === choice.moveId);
      if (!slot || slot.disabled || slot.pp <= 0) return null;
      return {
        kind: 'move',
        pokemonId: active.id,
        moveId: choice.moveId,
        targetId: this.foeActive.id,
        zMove: choice.zMove ?? false,
      };
    }

    if (choice.kind === 'switch') {
      const mon = this.profile.party[choice.partyIndex];
      if (!mon || isFainted(mon)) return null;
      const incomingId = [...this.partyByBattleId.entries()].find(([, p]) => p === mon)?.[0];
      if (incomingId === undefined || incomingId === active.id) return null;
      return { kind: 'switch', pokemonId: active.id, incomingId };
    }

    if (choice.kind === 'item') {
      if (this.profile.bag.count(choice.itemId) <= 0) return null;
      const target = this.profile.party[choice.partyIndex];
      if (!target) return null;
      const targetId = [...this.partyByBattleId.entries()].find(([, p]) => p === target)?.[0];
      if (targetId === undefined) return null;
      this.profile.bag.remove(choice.itemId, 1);
      return { kind: 'item', pokemonId: active.id, itemId: choice.itemId, targetId };
    }

    return null;
  }

  // ------------------------------------------------------------- ball / run

  private throwBall(ballId: string): TurnResult {
    if (this.profile.bag.count(ballId) <= 0) {
      return this.emptyResult([`You have no ${getItem(ballId).name}.`]);
    }
    this.profile.bag.remove(ballId, 1);

    const messages = [`${this.profile.name} threw a ${getItem(ballId).name}!`];
    const capture = attemptCapture({
      target: this.foeActive,
      ballId,
      rng: this.rng,
      hour: this.hour,
      onWater: this.onWater,
    });

    if (capture.caught) {
      messages.push(`Gotcha! ${this.foeActive.name} was caught!`);
      // The wild Pokémon carries the damage it took into the party, as it
      // should — a caught Pokémon arrives hurt.
      applyBattleResult(this.wild, this.foeActive);
      const where = this.profile.addPokemon(this.wild);
      this.captured = this.wild;
      this.profile.recordCaught(this.wild.species);
      messages.push(
        where === 'party'
          ? `${this.wild.nickname ?? getSpecies(this.wild.species).name} joined the party.`
          : `${getSpecies(this.wild.species).name} was sent to a box.`,
      );
      this.outcome = 'caught';
      this.engine.forceEnd(PLAYER_SIDE, 'captured');
      this.syncParty();
      return {
        events: [], messages, outcome: 'caught', capture,
        poseResult: null, levelUps: [], expGained: 0,
      };
    }

    messages.push(
      capture.shakes === 0 ? 'Oh no! It broke free immediately!'
        : capture.shakes === 1 ? 'Aww! It appeared to be caught!'
        : capture.shakes === 2 ? 'Aargh! Almost had it!'
        : 'Gah! It was so close, too!',
    );

    // A failed throw costs the turn — the wild Pokémon still acts.
    const foeAction = this.ai.chooseAction(this.state, this.foeActive);
    const events = this.engine.executeTurn([
      { kind: 'pass', pokemonId: this.playerActive.id },
      foeAction,
    ]);
    const result = this.finishTurn(events, null);
    return { ...result, messages: [...messages, ...result.messages], capture };
  }

  private tryRun(): TurnResult {
    if (!this.canFlee) {
      return this.emptyResult([`There is no running from ${this.foeActive.name}!`]);
    }

    // Speed-based, with a floor: a slow starter must still be able to leave.
    const playerSpeed = this.playerActive.stats.spe;
    const foeSpeed = this.foeActive.stats.spe;
    const chance = playerSpeed >= foeSpeed ? 1 : Math.max(0.35, playerSpeed / (foeSpeed * 1.5));

    if (this.rng.chance(chance)) {
      this.outcome = 'fled';
      this.engine.forceEnd(null, 'fled');
      this.syncParty();
      return {
        events: [], messages: ['Got away safely!'], outcome: 'fled',
        capture: null, poseResult: null, levelUps: [], expGained: 0,
      };
    }

    const foeAction = this.ai.chooseAction(this.state, this.foeActive);
    const events = this.engine.executeTurn([
      { kind: 'pass', pokemonId: this.playerActive.id },
      foeAction,
    ]);
    const result = this.finishTurn(events, null);
    return {
      ...result,
      messages: ["Couldn't get away!", ...result.messages],
      outcome: result.outcome === 'ongoing' ? 'flee-failed' : result.outcome,
    };
  }

  // ---------------------------------------------------------- turn plumbing

  private finishTurn(events: readonly BattleEvent[], poseResult: PoseResult | null): TurnResult {
    const messages = events.flatMap((e) => this.describe(e));
    this.syncParty();

    let expGained = 0;
    const levelUps: { mon: PartyPokemon; result: LevelUpResult }[] = [];

    for (const event of events) {
      if (event.type !== 'faint') continue;
      const fainted = this.state.pokemon.get(event.pokemonId);
      if (!fainted || fainted.side !== FOE_SIDE) continue;

      expGained = expYield(fainted.speciesId, fainted.level, false);
      // Everything that is still standing shares the experience. Party-wide
      // sharing is the modern default and it keeps a six-strong team viable
      // in an open world where the player picks their own fights.
      for (const mon of this.profile.party) {
        if (isFainted(mon)) continue;
        const result = awardExp(mon, expGained);
        if (result.levelsGained > 0) levelUps.push({ mon, result });
      }
    }

    for (const { mon, result } of levelUps) {
      const name = mon.nickname ?? getSpecies(mon.species).name;
      messages.push(`${name} grew to level ${result.newLevel}!`);
      for (const move of result.learned) {
        messages.push(`${name} learned ${getMove(move).name}!`);
      }
    }

    if (this.state.ended && this.outcome === 'ongoing') {
      this.outcome = this.state.winner === PLAYER_SIDE ? 'won'
        : this.state.winner === FOE_SIDE ? 'lost'
        : 'fled';
    }

    return {
      events,
      messages,
      outcome: this.outcome,
      capture: null,
      poseResult,
      levelUps,
      expGained,
    };
  }

  /** Copy battle HP/status/PP back onto the party members they came from. */
  private syncParty(): void {
    for (const [id, mon] of this.partyByBattleId) {
      const battle = this.state.pokemon.get(id);
      if (battle) applyBattleResult(mon, battle);
    }
  }

  private emptyResult(messages: string[]): TurnResult {
    return {
      events: [], messages, outcome: this.outcome,
      capture: null, poseResult: null, levelUps: [], expGained: 0,
    };
  }

  private nameOf(id: number): string {
    const p = this.state.pokemon.get(id);
    if (!p) return 'Pokémon';
    return p.side === FOE_SIDE ? `The wild ${p.name}` : p.name;
  }

  /**
   * Turn one engine event into log lines.
   *
   * The log reads from the same stream the renderer and the audio director
   * read, which is the whole reason the engine emits events rather than
   * mutating presentation state: these three can never disagree about what
   * happened.
   */
  private describe(event: BattleEvent): string[] {
    switch (event.type) {
      case 'move-used':
        // A Z-Move's moveId is the synthetic `z-<base>` the engine emits, and
        // it resolves to nothing in the move table. The preceding `z-power`
        // event already names the Z-Move, so there is nothing to add here.
        if (event.isZMove) return [];
        return [`${this.nameOf(event.userId)} used ${getMove(event.moveId).name}!`];
      case 'move-missed':
        return [`${this.nameOf(event.userId)}'s attack missed!`];
      case 'move-failed':
        return ['But it failed!'];
      case 'damage': {
        const lines: string[] = [];
        if (event.critical) lines.push('A critical hit!');
        const note = effectivenessMessage(event.effectiveness);
        if (note) lines.push(note);
        return lines;
      }
      case 'heal':
        return [`${this.nameOf(event.targetId)} regained health.`];
      case 'faint':
        return [`${this.nameOf(event.pokemonId)} fainted!`];
      case 'status-applied':
        return [`${this.nameOf(event.targetId)} was afflicted with ${event.status}.`];
      case 'status-cured':
        return [`${this.nameOf(event.targetId)} recovered from ${event.status}.`];
      case 'status-damage':
        return [`${this.nameOf(event.targetId)} is hurt by ${event.status}.`];
      case 'stat-change': {
        const dir = event.delta > 0 ? 'rose' : 'fell';
        const magnitude = Math.abs(event.delta) >= 2 ? ' sharply' : '';
        return [`${this.nameOf(event.targetId)}'s ${event.stat}${magnitude} ${dir}.`];
      }
      case 'stat-change-failed':
        return [`${this.nameOf(event.targetId)}'s ${event.stat} won't go any further.`];
      case 'switch-in':
        return [`Go, ${this.nameOf(event.pokemonId)}!`];
      case 'switch-out':
        return [`${this.nameOf(event.pokemonId)}, come back!`];
      case 'weather-start':
        return [`The weather turned to ${event.weather}.`];
      case 'weather-end':
        return ['The weather cleared.'];
      case 'weather-damage':
        return [`${this.nameOf(event.targetId)} is buffeted by the ${event.weather}.`];
      case 'terrain-start':
        return [`${event.terrain} spread underfoot.`];
      case 'terrain-end':
        return ['The terrain faded.'];
      case 'flinch':
        return [`${this.nameOf(event.targetId)} flinched!`];
      case 'confusion-hit':
        return [`${this.nameOf(event.targetId)} hurt itself in its confusion!`];
      case 'item-used':
        return [`${getItem(event.itemId).name} was used.`];
      case 'z-power':
        return [
          `${this.nameOf(event.userId)} surrounded itself with Z-Power!`,
          `${getZMove(event.zMoveId).name}!`,
        ];
      case 'totem-phase':
        return [`${event.name} — ${event.description}`];
      case 'totem-aura':
        return [`The Totem's aura raised its ${event.stat}!`];
      case 'sos-call':
        return [`${this.nameOf(event.callerId)} called for help! ${getSpecies(event.species).name} appeared!`];
      case 'arena-event':
        return [`The ${event.event} spread across the arena.`];
      case 'battle-end':
        return [];
      case 'message':
        return [event.text];
      default:
        return [];
    }
  }
}
