/**
 * Uniform spatial hash grid for broad-phase proximity queries.
 *
 * Alola holds tens of thousands of simulated Pokémon. Every AI tick asks
 * "what is near me?" — predators looking for prey, flocks looking for
 * neighbours, territorial species looking for intruders. A naive O(n^2) scan
 * is 10^8 checks per tick; this reduces it to the handful of cells that can
 * possibly contain a match.
 *
 * A uniform grid (rather than a quadtree/BVH) is the right call because our
 * agents are roughly uniformly distributed across the landmass, move every
 * tick, and query at a consistent radius. Rebuild-per-tick on a flat grid
 * beats incremental tree maintenance at this churn rate.
 *
 * The grid is 2D over XZ. Alola has verticality, but agents that matter to
 * each other are almost always within a few metres of the same altitude, and
 * callers do the precise 3D check anyway.
 */
import type { Vec3 } from '../math/vec3.ts';

export interface SpatialItem {
  readonly id: number;
  readonly position: Readonly<Vec3>;
}

export class SpatialHash<T extends SpatialItem> {
  readonly cellSize: number;
  private cells = new Map<number, T[]>();
  private readonly invCellSize: number;
  private itemCount = 0;

  constructor(cellSize = 16) {
    if (cellSize <= 0) throw new Error('SpatialHash cellSize must be positive.');
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
  }

  /**
   * Hash a cell coordinate into a single number.
   * Cantor-style pairing over a 16-bit signed range: Alola is ~40km across,
   * so at a 16m cell size we need ±1250 cells — comfortably inside 16 bits.
   */
  private key(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  private cellCoord(v: number): number {
    return Math.floor(v * this.invCellSize);
  }

  clear(): void {
    // Reuse the arrays of cells that were occupied: this runs every tick and
    // would otherwise churn GC hard. But drop cells that were already empty —
    // nobody used them for a whole tick.
    //
    // Without that second half the map only ever grew. Every cell any Pokémon
    // had ever stood in stayed in it, and this loop walked all of them every
    // tick, so the cost of a clear scaled with the distance travelled this
    // session rather than with the population: the game got slower the longer
    // it was played.
    for (const [key, list] of this.cells) {
      if (list.length === 0) this.cells.delete(key);
      else list.length = 0;
    }
    this.itemCount = 0;
  }

  /** Cells currently allocated. Diagnostics, and the leak regression test. */
  get cellCount(): number {
    return this.cells.size;
  }

  insert(item: T): void {
    const k = this.key(this.cellCoord(item.position.x), this.cellCoord(item.position.z));
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push(item);
    this.itemCount++;
  }

  /** Rebuild the whole grid from a collection. The normal per-tick path. */
  rebuild(items: Iterable<T>): void {
    this.clear();
    for (const item of items) this.insert(item);
  }

  /**
   * Collect items whose XZ position lies within `radius` of `center`.
   * Results are appended to `out` (reused by callers to avoid allocation).
   * The radius test is exact; only the cell sweep is approximate.
   */
  queryRadius(center: Readonly<Vec3>, radius: number, out: T[] = []): T[] {
    const minX = this.cellCoord(center.x - radius);
    const maxX = this.cellCoord(center.x + radius);
    const minZ = this.cellCoord(center.z - radius);
    const maxZ = this.cellCoord(center.z + radius);
    const r2 = radius * radius;

    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          const dx = item.position.x - center.x;
          const dz = item.position.z - center.z;
          if (dx * dx + dz * dz <= r2) out.push(item);
        }
      }
    }
    return out;
  }

  /**
   * Like queryRadius but stops after `limit` hits.
   * Flocking only needs ~7 neighbours to look right (Reynolds' original
   * observation), so capping turns a dense-flock worst case into a constant.
   */
  queryNearest(center: Readonly<Vec3>, radius: number, limit: number, out: T[] = []): T[] {
    const candidates = this.queryRadius(center, radius);
    if (candidates.length <= limit) {
      for (const c of candidates) out.push(c);
      return out;
    }
    candidates.sort((a, b) => {
      const da = (a.position.x - center.x) ** 2 + (a.position.z - center.z) ** 2;
      const db = (b.position.x - center.x) ** 2 + (b.position.z - center.z) ** 2;
      return da - db;
    });
    for (let i = 0; i < limit; i++) out.push(candidates[i]);
    return out;
  }

  /** Visit items near a point without building an array at all. */
  forEachInRadius(center: Readonly<Vec3>, radius: number, fn: (item: T) => void): void {
    const minX = this.cellCoord(center.x - radius);
    const maxX = this.cellCoord(center.x + radius);
    const minZ = this.cellCoord(center.z - radius);
    const maxZ = this.cellCoord(center.z + radius);
    const r2 = radius * radius;

    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          const dx = item.position.x - center.x;
          const dz = item.position.z - center.z;
          if (dx * dx + dz * dz <= r2) fn(item);
        }
      }
    }
  }

  get size(): number {
    return this.itemCount;
  }

  /** Occupancy diagnostics — a spike in maxCellLoad means the cell size is wrong. */
  stats(): { cells: number; items: number; maxCellLoad: number; avgCellLoad: number } {
    let max = 0;
    let occupied = 0;
    for (const list of this.cells.values()) {
      if (list.length > 0) {
        occupied++;
        if (list.length > max) max = list.length;
      }
    }
    return {
      cells: occupied,
      items: this.itemCount,
      maxCellLoad: max,
      avgCellLoad: occupied > 0 ? this.itemCount / occupied : 0,
    };
  }
}
