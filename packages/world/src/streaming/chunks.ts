/**
 * World streaming.
 *
 * The brief is "no loading screens between major areas". With a 40km x 30km
 * archipelago that means the world must be split into chunks that load and
 * unload continuously around the player, at a detail level that falls off with
 * distance, within a strict per-frame time budget.
 *
 * Key decisions:
 *
 * - **Chunks are 256m square.** Small enough that one is cheap to build
 *   (~1ms at LOD0), large enough that the player crosses one every ~45s of
 *   running, so the load cadence is gentle.
 *
 * - **Concentric LOD rings.** Vertex density halves per ring. A chunk's LOD is
 *   a pure function of its distance to the observer, so there is no hysteresis
 *   bookkeeping — but transitions are hysteretic *in time* (see `lodFor`) to
 *   stop a chunk oscillating between levels when the player walks the boundary.
 *
 * - **Budgeted work queue.** The streamer never builds more than a set number
 *   of chunks per frame, and prioritises by distance. Falling behind shows as
 *   distant terrain popping in slightly late — never as a frame hitch.
 *
 * - **Deterministic content.** Because terrain and spawns are pure functions of
 *   (seed, position), an unloaded chunk costs nothing to remember and reloads
 *   byte-identical.
 */
import { clamp } from '@alola/core';

export const CHUNK_SIZE = 256;

/** Vertex resolution per LOD level. LOD0 is 2m/vertex; each level halves it. */
export const LOD_RESOLUTIONS = [128, 64, 32, 16, 8] as const;
export const MAX_LOD = LOD_RESOLUTIONS.length - 1;

/**
 * Ring radii in metres. A chunk whose centre is within radius[i] gets LOD i.
 * Tuned so that LOD0 covers the area where the player can see surface detail,
 * and the outermost ring reaches the horizon at sea level (~9km for a 1.7m eye
 * height is 4.6km; we push to 8km because Alola's peaks are visible much further).
 */
export const LOD_RADII = [400, 900, 1800, 3600, 8000] as const;

export type ChunkKey = number;

/**
 * Pack chunk coordinates into a single integer key.
 * ±32767 chunks = ±8388km, far more than we need, and integer keys make the
 * loaded-chunk map far faster than string keys at this call frequency.
 */
export function chunkKey(cx: number, cz: number): ChunkKey {
  return ((cx & 0xffff) << 16) | (cz & 0xffff);
}

export function chunkCoordX(key: ChunkKey): number {
  // Sign-extend the upper 16 bits.
  return (key >> 16) << 16 >> 16;
}

export function chunkCoordZ(key: ChunkKey): number {
  return (key << 16) >> 16;
}

export function worldToChunk(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE) };
}

export function chunkCenter(cx: number, cz: number): { x: number; z: number } {
  return { x: cx * CHUNK_SIZE + CHUNK_SIZE / 2, z: cz * CHUNK_SIZE + CHUNK_SIZE / 2 };
}

export const ChunkState = {
  Unloaded: 0,
  Queued: 1,
  Building: 2,
  Ready: 3,
} as const;

export type ChunkState = (typeof ChunkState)[keyof typeof ChunkState];

export interface ChunkRecord {
  readonly key: ChunkKey;
  readonly cx: number;
  readonly cz: number;
  state: ChunkState;
  lod: number;
  /** Distance from the observer to the chunk centre, in metres. */
  distance: number;
  /** Simulation time the chunk became ready. */
  readyAt: number;
  /** Simulation time the chunk last had an observer in range. */
  lastSeenAt: number;
  /** Opaque payload the render/gameplay layer attaches (mesh, entities, ...). */
  payload: unknown;
}

export interface StreamingStats {
  loaded: number;
  queued: number;
  building: number;
  builtThisTick: number;
  unloadedThisTick: number;
  queueDepth: number;
}

export interface StreamerOptions {
  /** Max chunks to start building per tick. The frame-time guard. */
  buildsPerTick?: number;
  /** Max chunks to unload per tick. */
  unloadsPerTick?: number;
  /** Seconds a chunk stays loaded after its last observer leaves. */
  unloadGraceSeconds?: number;
  /** Extra distance beyond the outermost LOD ring before unloading. */
  unloadHysteresis?: number;
}

/**
 * Tracks which chunks should exist, in what order to build them, and when to
 * throw them away. Deliberately has no knowledge of meshes or entities: the
 * consumer supplies `build` and `dispose` callbacks. That keeps this testable
 * headlessly, which is the only way to have confidence in streaming logic.
 */
export class ChunkStreamer {
  private chunks = new Map<ChunkKey, ChunkRecord>();
  private buildQueue: ChunkRecord[] = [];
  private observers: { x: number; z: number }[] = [];

  private readonly buildsPerTick: number;
  private readonly unloadsPerTick: number;
  private readonly unloadGrace: number;
  private readonly unloadHysteresis: number;

  stats: StreamingStats = {
    loaded: 0, queued: 0, building: 0,
    builtThisTick: 0, unloadedThisTick: 0, queueDepth: 0,
  };

  constructor(opts: StreamerOptions = {}) {
    this.buildsPerTick = opts.buildsPerTick ?? 2;
    this.unloadsPerTick = opts.unloadsPerTick ?? 4;
    this.unloadGrace = opts.unloadGraceSeconds ?? 8;
    this.unloadHysteresis = opts.unloadHysteresis ?? CHUNK_SIZE * 2;
  }

  /**
   * Set observer positions. Usually one (the player), but split-screen,
   * spectated players and in-flight cameras all add observers, and a chunk is
   * kept if *any* observer needs it.
   */
  setObservers(positions: readonly { x: number; z: number }[]): void {
    this.observers = positions.map((p) => ({ x: p.x, z: p.z }));
  }

  /**
   * LOD for a distance, with hysteresis.
   *
   * `currentLod` is passed so a chunk sitting exactly on a ring boundary does
   * not rebuild every frame as the player's position jitters: we require the
   * distance to cross 8% past the boundary before changing level.
   */
  lodFor(distance: number, currentLod = -1): number {
    for (let i = 0; i < LOD_RADII.length; i++) {
      let radius = LOD_RADII[i];
      // Widen the ring we are already in.
      if (currentLod === i) radius *= 1.08;
      if (distance <= radius) return i;
    }
    return MAX_LOD;
  }

  /** Is this chunk within any observer's outermost ring? */
  private nearestObserverDistance(cx: number, cz: number): number {
    const c = chunkCenter(cx, cz);
    let best = Infinity;
    for (const o of this.observers) {
      const d = Math.hypot(c.x - o.x, c.z - o.z);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Advance streaming by one tick.
   *
   * `build` is invoked synchronously for up to `buildsPerTick` chunks and
   * should return the payload; in the real client it hands off to a Worker and
   * returns a handle. `dispose` releases a payload.
   */
  update(
    now: number,
    build: (record: ChunkRecord) => unknown,
    dispose: (record: ChunkRecord) => void,
  ): void {
    this.stats.builtThisTick = 0;
    this.stats.unloadedThisTick = 0;

    if (this.observers.length === 0) return;

    const maxRadius = LOD_RADII[MAX_LOD];
    const chunkRadius = Math.ceil(maxRadius / CHUNK_SIZE);

    // 1. Mark every chunk that should exist, queueing new ones.
    for (const o of this.observers) {
      const { cx: ocx, cz: ocz } = worldToChunk(o.x, o.z);
      for (let dz = -chunkRadius; dz <= chunkRadius; dz++) {
        for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
          const cx = ocx + dx;
          const cz = ocz + dz;
          const c = chunkCenter(cx, cz);
          const dist = Math.hypot(c.x - o.x, c.z - o.z);
          if (dist > maxRadius) continue;

          const key = chunkKey(cx, cz);
          let rec = this.chunks.get(key);
          if (!rec) {
            rec = {
              key, cx, cz,
              state: ChunkState.Queued,
              lod: this.lodFor(dist),
              distance: dist,
              readyAt: 0,
              lastSeenAt: now,
              payload: null,
            };
            this.chunks.set(key, rec);
            this.buildQueue.push(rec);
          } else {
            rec.lastSeenAt = now;
            if (dist < rec.distance) rec.distance = dist;
          }
        }
      }
    }

    // 2. Refresh distances and detect LOD changes on loaded chunks.
    for (const rec of this.chunks.values()) {
      const dist = this.nearestObserverDistance(rec.cx, rec.cz);
      rec.distance = dist;
      if (dist <= maxRadius) rec.lastSeenAt = now;

      if (rec.state === ChunkState.Ready) {
        const wanted = this.lodFor(dist, rec.lod);
        if (wanted !== rec.lod) {
          // Re-queue at the new detail level. The old payload stays live until
          // the new one is ready, so the player never sees a hole.
          rec.lod = wanted;
          rec.state = ChunkState.Queued;
          this.buildQueue.push(rec);
        }
      }
    }

    // 3. Build, nearest first. This is the ordering that matters most: the
    //    ground under the player's feet must never be the thing we defer.
    this.buildQueue.sort((a, b) => a.distance - b.distance);

    let built = 0;
    while (this.buildQueue.length > 0 && built < this.buildsPerTick) {
      const rec = this.buildQueue.shift()!;
      // The chunk may have been unloaded while queued.
      if (!this.chunks.has(rec.key)) continue;
      if (rec.state !== ChunkState.Queued) continue;

      rec.state = ChunkState.Building;
      const previous = rec.payload;
      rec.payload = build(rec);
      if (previous !== null && previous !== rec.payload) {
        dispose({ ...rec, payload: previous });
      }
      rec.state = ChunkState.Ready;
      rec.readyAt = now;
      built++;
      this.stats.builtThisTick++;
    }

    // 4. Unload chunks nobody has needed for a while.
    let unloaded = 0;
    const unloadDistance = maxRadius + this.unloadHysteresis;
    for (const [key, rec] of this.chunks) {
      if (unloaded >= this.unloadsPerTick) break;
      if (rec.state === ChunkState.Building) continue;
      if (rec.distance <= unloadDistance) continue;
      if (now - rec.lastSeenAt < this.unloadGrace) continue;

      if (rec.payload !== null) dispose(rec);
      this.chunks.delete(key);
      unloaded++;
      this.stats.unloadedThisTick++;
    }

    // 5. Refresh stats.
    let loaded = 0, queued = 0, building = 0;
    for (const rec of this.chunks.values()) {
      if (rec.state === ChunkState.Ready) loaded++;
      else if (rec.state === ChunkState.Queued) queued++;
      else if (rec.state === ChunkState.Building) building++;
    }
    this.stats.loaded = loaded;
    this.stats.queued = queued;
    this.stats.building = building;
    this.stats.queueDepth = this.buildQueue.length;
  }

  get(cx: number, cz: number): ChunkRecord | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  isReady(cx: number, cz: number): boolean {
    return this.chunks.get(chunkKey(cx, cz))?.state === ChunkState.Ready;
  }

  loadedChunks(): IterableIterator<ChunkRecord> {
    return this.chunks.values();
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /** Drop everything. Used on teleport/fast travel, where incremental streaming
   *  would thrash — a hard reset then a rebuild around the destination is both
   *  faster and simpler than migrating the working set across 10km. */
  clear(dispose: (record: ChunkRecord) => void): void {
    for (const rec of this.chunks.values()) {
      if (rec.payload !== null) dispose(rec);
    }
    this.chunks.clear();
    this.buildQueue.length = 0;
  }
}
