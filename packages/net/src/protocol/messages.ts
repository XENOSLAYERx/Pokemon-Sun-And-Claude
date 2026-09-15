/**
 * Network protocol.
 *
 * The architecture is server-authoritative with client prediction:
 *
 *   - The client simulates its own movement immediately (no input latency).
 *   - It sends inputs, stamped with a sequence number.
 *   - The server simulates authoritatively and returns a snapshot with the
 *     last input it processed.
 *   - The client rewinds to that state and replays every unacknowledged input.
 *
 * Other players are shown interpolated slightly in the past, which trades a
 * little latency for motion that never jitters or rubber-bands.
 *
 * Battles are the exception: they are lockstep. Both clients have the same
 * deterministic engine and the same seed, so only inputs cross the wire. That
 * makes a battle a few hundred bytes instead of a state stream, and makes
 * cheating by state injection impossible.
 */

/** Wire protocol version. Bumped on any breaking message change. */
export const PROTOCOL_VERSION = 3;

export type ClientMessage =
  | { t: 'hello'; protocol: number; playerId: string; displayName: string; saveHash: string }
  | { t: 'input'; seq: number; dt: number; move: { x: number; z: number }; yaw: number; actions: number }
  | { t: 'chunk-subscribe'; chunks: number[] }
  | { t: 'chunk-unsubscribe'; chunks: number[] }
  | { t: 'interact'; entityId: number; kind: string }
  | { t: 'battle-action'; battleId: string; turn: number; action: unknown }
  | { t: 'trade-offer'; toPlayerId: string; pokemonIndex: number }
  | { t: 'trade-respond'; tradeId: string; accept: boolean }
  | { t: 'chat'; channel: 'local' | 'island' | 'guild' | 'party'; text: string }
  | { t: 'photo-share'; caption: string; data: string }
  | { t: 'ping'; clientTime: number };

export type ServerMessage =
  | { t: 'welcome'; playerId: string; serverTick: number; worldSeed: number; tickRate: number }
  | { t: 'reject'; reason: string; detail: string }
  | { t: 'snapshot'; tick: number; ackSeq: number; baseline: number; entities: EntityDelta[]; removed: number[] }
  | { t: 'world-state'; tick: number; hour: number; weather: Record<string, string> }
  | { t: 'battle-start'; battleId: string; seed: number; format: string; participants: string[] }
  | { t: 'battle-turn'; battleId: string; turn: number; actions: unknown[] }
  | { t: 'battle-end'; battleId: string; winner: number | null }
  | { t: 'trade-request'; tradeId: string; fromPlayerId: string; pokemon: unknown }
  | { t: 'trade-result'; tradeId: string; accepted: boolean; pokemon: unknown | null }
  | { t: 'chat'; channel: string; fromPlayerId: string; displayName: string; text: string; at: number }
  | { t: 'event-announce'; eventId: string; name: string; island: string; endsAt: number }
  | { t: 'pong'; clientTime: number; serverTime: number };

/**
 * A delta-encoded entity update.
 *
 * Fields are optional: the server only sends what changed since the client's
 * acknowledged baseline. At 20Hz with 60 visible entities, sending full state
 * is roughly 40 KB/s per client; delta encoding brings that under 6 KB/s,
 * which is the difference between viable and not on a mobile connection.
 */
export interface EntityDelta {
  /** Entity id. */
  id: number;
  /** Bitfield of which fields are present. */
  mask: number;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  /** Velocity, so the client can extrapolate between snapshots. */
  vx?: number;
  vz?: number;
  /** Species id index, for wild Pokémon. */
  species?: number;
  /** Animation state id. */
  anim?: number;
  /** Health fraction, quantised to 0–255. */
  hp?: number;
  /** Flags: shiny, alpha, fainted, in-battle. */
  flags?: number;
}

export const DeltaField = {
  Position: 1 << 0,
  Yaw: 1 << 1,
  Velocity: 1 << 2,
  Species: 1 << 3,
  Anim: 1 << 4,
  Health: 1 << 5,
  Flags: 1 << 6,
} as const;

export const EntityFlag = {
  Shiny: 1 << 0,
  Alpha: 1 << 1,
  Fainted: 1 << 2,
  InBattle: 1 << 3,
  IsPlayer: 1 << 4,
  Airborne: 1 << 5,
} as const;

/** Input action bitfield. */
export const InputAction = {
  Sprint: 1 << 0,
  Jump: 1 << 1,
  Interact: 1 << 2,
  Ride: 1 << 3,
  Camera: 1 << 4,
  ThrowBall: 1 << 5,
} as const;

/** One client input, retained until the server acknowledges it. */
export interface InputCommand {
  seq: number;
  dt: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  actions: number;
}
