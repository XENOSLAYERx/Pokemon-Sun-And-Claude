/**
 * Deterministic pseudo-random number generation.
 *
 * Every random decision in Project Alola flows through one of these streams.
 * Determinism is not a nicety here — it is load-bearing for four systems:
 *
 *   1. Netcode        — client and server must roll identical battle outcomes.
 *   2. Replays        — a battle is stored as (seed + input log), not a state dump.
 *   3. World identity — a given chunk must spawn the same Pokémon for every
 *                       player on the same save, without storing a spawn list.
 *   4. Shiny hunting  — players must be able to trust that a reset re-rolls.
 *
 * The generator is SplitMix64 reduced to 32-bit lanes so it runs identically on
 * every JS engine without BigInt overhead in hot loops. It passes the standard
 * smoke tests (period 2^64, uniform low bits) and, critically, has excellent
 * avalanche on *sequential* seeds — which matters because we seed per-chunk
 * from coordinates, and neighbouring chunks must not correlate.
 */

const MUL_A = 0x85ebca6b;
const MUL_B = 0xc2b2ae35;

/** Deterministic 32-bit integer hash (a 32-bit finaliser in the MurmurHash3 family). */
export function hash32(x: number): number {
  let h = x | 0;
  h ^= h >>> 16;
  h = Math.imul(h, MUL_A);
  h ^= h >>> 13;
  h = Math.imul(h, MUL_B);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Combine several integers into one well-mixed seed. Order matters. */
export function hashCombine(...values: number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    h = (hash32(h ^ (values[i] | 0)) + 0x9e3779b9) >>> 0;
  }
  return h >>> 0;
}

/** Hash a string into a 32-bit seed (FNV-1a). Used for named seeds like "melemele:route1". */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A seekable random stream.
 *
 * The internal state is a single 32-bit integer, which means a stream's entire
 * position is one number — cheap to snapshot into a save file or a netcode
 * packet, and cheap to restore.
 */
export class Rng {
  private state: number;
  /** How many numbers have been drawn. Useful for desync diagnostics. */
  private draws = 0;

  constructor(seed: number | string = 0) {
    this.state = (typeof seed === 'string' ? hashString(seed) : hash32(seed)) >>> 0;
    // Avoid the degenerate all-zero state.
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** Raw 32-bit unsigned draw. */
  nextUint32(): number {
    this.draws++;
    // xorshift32 core, then a strong output finaliser.
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return hash32(x);
  }

  /** Uniform float in [0, 1). 24 bits of mantissa — plenty, and bias-free. */
  next(): number {
    return (this.nextUint32() >>> 8) / 0x1000000;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Uniform integer in [min, max] inclusive.
   * Uses rejection sampling so the distribution is exactly uniform — important
   * for damage rolls, where a 1/256 bias is detectable by the community.
   */
  int(min: number, max: number): number {
    const span = max - min + 1;
    if (span <= 0) return min;
    const limit = Math.floor(0x100000000 / span) * span;
    let r = this.nextUint32();
    while (r >= limit) r = this.nextUint32();
    return min + (r % span);
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /** True with probability `num/den` — avoids float error on exact odds like 1/4096. */
  odds(num: number, den: number): boolean {
    return this.int(0, den - 1) < num;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /**
   * Weighted pick. `weights[i]` corresponds to `items[i]`.
   * Returns index -1 when every weight is zero, so callers can express
   * "nothing spawns here right now" without a sentinel item.
   */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] > 0) total += weights[i];
    }
    if (total <= 0) return -1;
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] <= 0) continue;
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    // Float drift fallback: return the last positive-weight entry.
    for (let i = weights.length - 1; i >= 0; i--) {
      if (weights[i] > 0) return i;
    }
    return -1;
  }

  /** In-place Fisher–Yates. Returns the same array for chaining. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** Standard normal via Box–Muller. Used for stat/size jitter and wander noise. */
  gaussian(mean = 0, stdDev = 1): number {
    // next() is [0,1); u must be > 0 for the log.
    const u = 1 - this.next();
    const v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    return mean + stdDev * mag * Math.cos(2 * Math.PI * v);
  }

  /** A random unit vector on the XZ plane, as a yaw angle. */
  yaw(): number {
    return this.next() * Math.PI * 2;
  }

  /**
   * Fork a child stream that is deterministic but independent.
   *
   * This is the key to decoupled determinism: the ecosystem tick can fork a
   * per-Pokémon stream so that adding a new random call to the *weather* system
   * never shifts what the *Pokémon* rolls. Without forking, every subsystem
   * shares one sequence and any content change desyncs every other system.
   */
  fork(label: string | number): Rng {
    const tag = typeof label === 'string' ? hashString(label) : label | 0;
    return new Rng(hashCombine(this.state, tag));
  }

  /** Snapshot for save/netcode. */
  save(): RngState {
    return { state: this.state >>> 0, draws: this.draws };
  }

  restore(snapshot: RngState): void {
    this.state = snapshot.state >>> 0;
    this.draws = snapshot.draws;
  }

  get drawCount(): number {
    return this.draws;
  }
}

export interface RngState {
  state: number;
  draws: number;
}

/**
 * A stateless positional RNG.
 *
 * Given the same (worldSeed, x, y, z, salt) it always returns the same value,
 * with no stored state at all. This is how the world stays consistent without
 * a database: "what spawns at chunk (12, -3)?" is answered by a pure function,
 * so a chunk can unload and reload identically, and two players streaming the
 * same chunk independently agree without talking to each other.
 */
export function noiseAt(worldSeed: number, x: number, y: number, z = 0, salt = 0): number {
  const h = hashCombine(worldSeed, Math.floor(x), Math.floor(y), Math.floor(z), salt);
  return (h >>> 8) / 0x1000000;
}

/** Build a seeded Rng for a specific world cell — the standard chunk-seeding path. */
export function rngForCell(worldSeed: number, cx: number, cz: number, salt: string | number = 0): Rng {
  const tag = typeof salt === 'string' ? hashString(salt) : salt | 0;
  return new Rng(hashCombine(worldSeed, cx, cz, tag));
}
