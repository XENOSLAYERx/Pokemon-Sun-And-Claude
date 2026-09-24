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
export const LOD_RESOLUTIONS = [128, 64, 32, 16] as const;

/**
 * Ring radii in metres. A chunk whose centre is within radius[i] gets LOD i.
 *
 * The outermost ring stops at 3.6km, not at the visible horizon, and that is a
 * deliberate correction found by profiling the headless simulation.
 *
 * An earlier build streamed chunks out to 8km so that distant islands stayed
 * visible. The area of a ring grows with the square of its radius, so that
 * outermost band alone accounted for roughly 2,450 of the ~3,070 loaded chunks
 * — 80% of all streaming memory and per-chunk overhead spent on terrain
 * occupying a handful of pixels.
 *
 * Everything beyond `STREAMING_RADIUS` is drawn instead by a single coarse
 * mesh per island (see @alola/render's far-terrain module): five draw calls
 * for the whole archipelago rather than thousands of chunk objects. Distant
 * islands are still visible — they are simply not paying chunk cost to be so.
 */
export const LOD_RADII = [400, 900, 1800, 3600] as const;

/**
 * Beyond this distance, terrain is the far-terrain mesh rather than streamed
 * chunks. The far mesh overlaps the outermost ring slightly so there is never
 * a gap at the handover.
 */
export const STREAMING_RADIUS = LOD_RADII[LOD_RADII.length - 1];

export const MAX_LOD = LOD_RADII.length - 1;

/**
 * The two LOD tables must stay the same length: `MAX_LOD` indexes both, and a
 * mismatch makes the radius lookup return undefined, which silently disables
 * streaming entirely rather than failing loudly. That exact regression was
 * introduced once while tuning the ring radii and caught only by the headless
 * simulation reporting zero chunks built, so it is now an invariant.
 */
if (LOD_RESOLUTIONS.length !== LOD_RADII.length) {
  throw new Error(
    `LOD table mismatch: ${LOD_RESOLUTIONS.length} resolutions but ${LOD_RADII.length} radii. ` +
      'Every LOD ring needs exactly one mesh resolution.',
  );
}

/** How far the far-terrain mesh renders. Alola's peaks are visible a long way. */
export const FAR_TERRAIN_RADIUS = 20000;

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
  /** Asynchronous builds dispatched and not yet completed. */
  inFlight: number;
  /** Async results that arrived for a chunk that no longer wanted them. */
  discarded: number;
  /**
   * Radius around the nearest observer inside which every chunk has geometry.
   * Grows from zero while streaming catches up; equals the streaming radius
   * once it has. The far-terrain mesh fills everything beyond it.
   */
  coveredRadius: number;
}

/**
 * Returned by a `build` callback that has handed the work off (to a Worker)
 * rather than finishing it. The chunk stays `Building` — with its previous
 * payload still live, so the player never sees a hole — until `complete()` is
 * called with the result.
 */
export const BUILD_PENDING: unique symbol = Symbol('chunk-build-pending');

export interface StreamerOptions {
  /** Max chunks to start building per tick. The frame-time guard. */
  buildsPerTick?: number;
  /** Max chunks to unload per tick. */
  unloadsPerTick?: number;
  /** Seconds a chunk stays loaded after its last observer leaves. */
  unloadGraceSeconds?: number;
  /** Extra distance beyond the outermost LOD ring before unloading. */
  unloadHysteresis?: number;
  /**
   * Max asynchronous builds outstanding at once. Bounds memory and keeps the
   * nearest chunks from queueing behind a backlog of far ones that were
   * dispatched when the player was somewhere else.
   */
  maxInFlight?: number;
  /** Multiplier on every LOD ring — the quality preset's draw distance. */
  radiusScale?: number;
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

  private buildsPerTick: number;
  private readonly unloadsPerTick: number;
  private readonly unloadGrace: number;
  private readonly unloadHysteresis: number;
  private readonly maxInFlight: number;
  private radiusScale: number;
  private inFlight = 0;

  stats: StreamingStats = {
    loaded: 0, queued: 0, building: 0,
    builtThisTick: 0, unloadedThisTick: 0, queueDepth: 0,
    inFlight: 0, discarded: 0, coveredRadius: 0,
  };

  constructor(opts: StreamerOptions = {}) {
    this.buildsPerTick = opts.buildsPerTick ?? 2;
    this.unloadsPerTick = opts.unloadsPerTick ?? 4;
    this.unloadGrace = opts.unloadGraceSeconds ?? 8;
    this.unloadHysteresis = opts.unloadHysteresis ?? CHUNK_SIZE * 2;
    this.maxInFlight = opts.maxInFlight ?? 8;
    this.radiusScale = opts.radiusScale ?? 1;
  }

  /**
   * Apply a quality preset. Takes effect on the next update: a smaller radius
   * lets distant chunks age out through the normal unload path rather than
   * vanishing all at once.
   */
  configure(opts: { buildsPerTick?: number; radiusScale?: number }): void {
    if (opts.buildsPerTick !== undefined) this.buildsPerTick = Math.max(1, Math.floor(opts.buildsPerTick));
    if (opts.radiusScale !== undefined) this.radiusScale = Math.max(0.1, opts.radiusScale);
  }

  /** The outermost streamed radius after the draw-distance scale. */
  get streamingRadius(): number {
    return LOD_RADII[MAX_LOD] * this.radiusScale;
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
      let radius = LOD_RADII[i] * this.radiusScale;
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

    const maxRadius = this.streamingRadius;
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

      if (rec.state === ChunkState.Ready || rec.state === ChunkState.Building) {
        const wanted = this.lodFor(dist, rec.lod);
        if (wanted !== rec.lod) {
          // Re-queue at the new detail level. The old payload stays live until
          // the new one is ready, so the player never sees a hole. A build
          // already in flight at the old level is left to finish; its result
          // no longer matches `rec.lod`, so `complete()` discards it.
          if (rec.state === ChunkState.Building) this.inFlight--;
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
    while (
      this.buildQueue.length > 0 &&
      built < this.buildsPerTick &&
      this.inFlight < this.maxInFlight
    ) {
      const rec = this.buildQueue.shift()!;
      // The chunk may have been unloaded while queued.
      if (this.chunks.get(rec.key) !== rec) continue;
      if (rec.state !== ChunkState.Queued) continue;

      rec.state = ChunkState.Building;
      const result = build(rec);
      built++;
      this.stats.builtThisTick++;

      if (result === BUILD_PENDING) {
        // Handed off. The previous payload stays attached and visible.
        this.inFlight++;
        continue;
      }

      const previous = rec.payload;
      rec.payload = result;
      if (previous !== null && previous !== rec.payload) {
        dispose({ ...rec, payload: previous });
      }
      rec.state = ChunkState.Ready;
      rec.readyAt = now;
    }

    // 4. Unload chunks nobody has needed for a while.
    let unloaded = 0;
    const unloadDistance = maxRadius + this.unloadHysteresis;
    for (const [key, rec] of this.chunks) {
      if (unloaded >= this.unloadsPerTick) break;
      if (rec.distance <= unloadDistance) continue;
      if (now - rec.lastSeenAt < this.unloadGrace) continue;

      // A chunk still building can be dropped too: its eventual result finds
      // no record in `complete()` and is disposed there.
      if (rec.state === ChunkState.Building) this.inFlight--;
      if (rec.payload !== null) dispose(rec);
      this.chunks.delete(key);
      unloaded++;
      this.stats.unloadedThisTick++;
    }

    // 5. Refresh stats.
    let loaded = 0, queued = 0, building = 0;
    // A chunk mid-rebuild still has its old payload on screen, so it counts as
    // covered; only a chunk with nothing to show yet limits the radius.
    let nearestUncovered = Infinity;
    for (const rec of this.chunks.values()) {
      if (rec.state === ChunkState.Ready) loaded++;
      else if (rec.state === ChunkState.Queued) queued++;
      else if (rec.state === ChunkState.Building) building++;
      if (rec.payload === null && rec.state !== ChunkState.Ready && rec.distance < nearestUncovered) {
        nearestUncovered = rec.distance;
      }
    }
    // The uncovered chunk's nearest edge is up to half a diagonal closer than
    // its centre.
    const halfDiagonal = CHUNK_SIZE * Math.SQRT1_2;
    this.stats.coveredRadius = nearestUncovered === Infinity
      ? maxRadius
      : Math.max(0, Math.min(maxRadius, nearestUncovered - halfDiagonal));
    this.stats.loaded = loaded;
    this.stats.queued = queued;
    this.stats.building = building;
    this.stats.queueDepth = this.buildQueue.length;
    this.stats.inFlight = this.inFlight;
  }

  /**
   * Would `complete()` accept a result for this chunk at this LOD?
   *
   * Lets the caller skip turning a stale result into a GPU mesh at all, rather
   * than building one only to have it disposed a line later.
   */
  wants(key: ChunkKey, lod: number): boolean {
    const rec = this.chunks.get(key);
    return rec !== undefined && rec.state === ChunkState.Building && rec.lod === lod;
  }

  /**
   * Deliver the result of a build that returned `BUILD_PENDING`.
   *
   * Results can arrive for a chunk that has since been unloaded, or re-queued
   * at a different LOD because the player moved while the Worker was busy.
   * Both are handed straight back to `dispose` rather than attached — attaching
   * a stale LOD would leave a low-detail chunk under the player's feet until
   * something happened to rebuild it. Returns whether the payload was used.
   */
  complete(
    key: ChunkKey,
    lod: number,
    payload: unknown,
    now: number,
    dispose: (record: ChunkRecord) => void,
  ): boolean {
    const rec = this.chunks.get(key);
    if (!rec || rec.state !== ChunkState.Building || rec.lod !== lod) {
      this.stats.discarded++;
      dispose({
        key, cx: chunkCoordX(key), cz: chunkCoordZ(key),
        state: ChunkState.Unloaded, lod, distance: Infinity,
        readyAt: now, lastSeenAt: now, payload,
      });
      return false;
    }

    this.inFlight--;
    this.stats.inFlight = this.inFlight;
    const previous = rec.payload;
    rec.payload = payload;
    if (previous !== null && previous !== payload) {
      dispose({ ...rec, payload: previous });
    }
    rec.state = ChunkState.Ready;
    rec.readyAt = now;
    return true;
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
    // Anything still on a Worker comes back to `complete()`, finds no record,
    // and is disposed there.
    this.inFlight = 0;
  }
}
