/**
 * Battle state.
 *
 * Every value here is plain data. The battle engine is a pure function from
 * (state, actions, rng) to (state, events) — which is what makes it possible
 * to run the identical engine on the client for prediction and on the server
 * for authority, and to store a battle as a seed plus an input log rather than
 * a state dump.
 */
import type { BiomeId, PokemonType, StatKey, StatusCondition } from '@alola/data';

export interface StatStages {
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
  /** Accuracy and evasion use the same stage system but a different table. */
  accuracy: number;
  evasion: number;
}

export function emptyStages(): StatStages {
  return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };
}

export interface MoveSlot {
  readonly id: string;
  pp: number;
  readonly maxPp: number;
  /** Disabled this turn (Torment, Disable, Choice lock). */
  disabled: boolean;
}

/** A Pokémon as it exists inside a battle. */
export interface BattlePokemon {
  /** Unique within the battle. */
  readonly id: number;
  readonly speciesId: string;
  readonly name: string;
  readonly level: number;
  readonly types: readonly PokemonType[];
  readonly shiny: boolean;

  /** Final computed stats, before stages. */
  readonly stats: Readonly<Record<StatKey, number>>;
  hp: number;
  readonly maxHp: number;

  stages: StatStages;
  status: StatusCondition;
  /** Turns the status has been active — drives Toxic ramping and Sleep counters. */
  statusTurns: number;
  /** Volatile conditions: confusion, flinch, substitute, protect... */
  volatiles: Map<string, number>;

  moves: MoveSlot[];
  ability: string;
  item: string | null;

  /** Which side and slot this Pokémon occupies. -1 = benched. */
  side: number;
  slot: number;

  fainted: boolean;
  /** Has it acted this turn? */
  hasActed: boolean;

  /** Totem/alpha scaling — affects presentation and some effects. */
  readonly scale: number;
  /**
   * Is this a Totem boss? Enables the engine's per-damage phase check.
   * Set by `registerTotem`, which is the single source of truth — do not
   * set it directly, or a Totem will have a phase table that never runs.
   */
  isTotem: boolean;
  /** Current Totem phase index. */
  totemPhase: number;
}

export interface BattleSide {
  readonly index: number;
  readonly trainerName: string;
  readonly isPlayer: boolean;
  /** Active Pokémon ids by slot. -1 when the slot is empty. */
  active: number[];
  /** All party member ids, including benched. */
  party: number[];
  /** Side conditions: reflect, light-screen, tailwind, spikes... */
  conditions: Map<string, number>;
  /** Has this side used its Z-Move? One per battle. */
  zUsed: boolean;
  /** Z-Crystal held by the trainer. */
  zCrystal: string | null;
}

export type BattleFormat = 'single' | 'double' | 'multi' | 'royale' | 'totem' | 'raid';

export interface BattleField {
  weather: string | null;
  weatherTurns: number;
  terrain: string | null;
  terrainTurns: number;
  /** Trick Room, Gravity, Magic Room... */
  effects: Map<string, number>;
}

export interface BattleState {
  readonly format: BattleFormat;
  /** How many active slots each side has. */
  readonly slotsPerSide: number;
  sides: BattleSide[];
  pokemon: Map<number, BattlePokemon>;
  field: BattleField;
  turn: number;
  /** Set when the battle ends. */
  winner: number | null;
  ended: boolean;
  /** The arena this battle generated in — drives presentation and some effects. */
  readonly arena: BattleArena;
}

/**
 * The arena.
 *
 * Battles are generated from wherever the player is standing — there are no
 * battle scenes to load. The arena captures what the presentation layer needs
 * to build the space and what the rules layer needs to apply environmental
 * effects (a Z-Move vitrifying sand, Electric Terrain on a metal floor).
 */
export interface BattleArena {
  readonly biome: BiomeId;
  /** Dominant surface underfoot. */
  readonly surface: 'ground' | 'water' | 'sand' | 'snow' | 'rock' | 'foliage' | 'metal' | 'lava';
  /** World position the battle occupies. */
  readonly x: number;
  readonly z: number;
  /** Ground elevation. */
  readonly y: number;
  /** Usable flat radius in metres — decides the camera rig and knockback space. */
  readonly radius: number;
  /** Weather at battle start, inherited from the overworld. */
  readonly weather: string | null;
  /** Time of day, 0–24. Sets the lighting rig. */
  readonly hour: number;
  /** Island, for music selection. */
  readonly island: string | null;
  /** Is there a ceiling? Blocks sky-facing Z-Move cameras. */
  readonly enclosed: boolean;
}

/** Player intent for one turn. Resolved by the engine in priority order. */
export type BattleAction =
  | { kind: 'move'; pokemonId: number; moveId: string; targetId: number; zMove?: boolean }
  | { kind: 'switch'; pokemonId: number; incomingId: number }
  | { kind: 'item'; pokemonId: number; itemId: string; targetId: number }
  | { kind: 'run'; pokemonId: number }
  | { kind: 'pass'; pokemonId: number };

/**
 * Battle events.
 *
 * The engine emits a stream of these instead of mutating presentation state.
 * The renderer, the audio director, the battle log and the netcode all consume
 * the same stream, which guarantees they cannot disagree about what happened.
 */
export type BattleEvent =
  | { type: 'turn-start'; turn: number }
  | { type: 'move-used'; userId: number; moveId: string; targetIds: number[]; isZMove: boolean }
  | { type: 'move-missed'; userId: number; targetId: number }
  | { type: 'move-failed'; userId: number; reason: string }
  | { type: 'damage'; targetId: number; amount: number; effectiveness: number; critical: boolean; remaining: number }
  | { type: 'heal'; targetId: number; amount: number; remaining: number }
  | { type: 'faint'; pokemonId: number }
  | { type: 'status-applied'; targetId: number; status: StatusCondition }
  | { type: 'status-cured'; targetId: number; status: StatusCondition }
  | { type: 'status-damage'; targetId: number; status: StatusCondition; amount: number }
  | { type: 'stat-change'; targetId: number; stat: keyof StatStages; delta: number; newStage: number }
  | { type: 'stat-change-failed'; targetId: number; stat: keyof StatStages; reason: string }
  | { type: 'switch-in'; pokemonId: number; side: number; slot: number }
  | { type: 'switch-out'; pokemonId: number }
  | { type: 'weather-start'; weather: string }
  | { type: 'weather-end'; weather: string }
  | { type: 'weather-damage'; targetId: number; weather: string; amount: number }
  | { type: 'terrain-start'; terrain: string }
  | { type: 'terrain-end'; terrain: string }
  | { type: 'flinch'; targetId: number }
  | { type: 'confusion-hit'; targetId: number; amount: number }
  | { type: 'item-used'; pokemonId: number; itemId: string }
  | { type: 'z-power'; userId: number; zMoveId: string; poseHit: boolean }
  | { type: 'totem-phase'; pokemonId: number; phase: number; name: string; description: string }
  | { type: 'totem-aura'; pokemonId: number; stat: keyof StatStages; delta: number }
  | { type: 'sos-call'; callerId: number; allyId: number; species: string }
  | { type: 'arena-event'; event: string; radius: number }
  | { type: 'battle-end'; winner: number | null; reason: string }
  | { type: 'message'; text: string };

export function createField(): BattleField {
  return { weather: null, weatherTurns: 0, terrain: null, terrainTurns: 0, effects: new Map() };
}

export function activePokemon(state: BattleState, side: number): BattlePokemon[] {
  const out: BattlePokemon[] = [];
  const s = state.sides[side];
  if (!s) return out;
  for (const id of s.active) {
    if (id < 0) continue;
    const p = state.pokemon.get(id);
    if (p && !p.fainted) out.push(p);
  }
  return out;
}

export function opposingSides(state: BattleState, side: number): number[] {
  return state.sides.filter((s) => s.index !== side).map((s) => s.index);
}

/** Every non-fainted active Pokémon on an opposing side. */
export function opponentsOf(state: BattleState, side: number): BattlePokemon[] {
  const out: BattlePokemon[] = [];
  for (const other of opposingSides(state, side)) {
    out.push(...activePokemon(state, other));
  }
  return out;
}

/** Does this side still have anything able to fight? */
export function sideHasFighters(state: BattleState, side: number): boolean {
  const s = state.sides[side];
  if (!s) return false;
  return s.party.some((id) => {
    const p = state.pokemon.get(id);
    return p !== undefined && !p.fainted;
  });
}
