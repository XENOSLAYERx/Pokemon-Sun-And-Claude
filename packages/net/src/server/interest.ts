/**
 * Interest management.
 *
 * Alola holds tens of thousands of simulated entities. Sending all of them to
 * every client is impossible, so the server maintains, per client, the set of
 * entities that client can actually perceive, and sends only those.
 *
 * The policy is a distance-banded update rate rather than a hard cut-off:
 * nearby entities update every tick, mid-range every few ticks, distant ones
 * rarely. A Pokémon 300m away still moves — just at 2Hz instead of 20Hz, which
 * is indistinguishable at that distance and costs a tenth as much bandwidth.
 *
 * Other players are always prioritised over wild Pokémon: a player who
 * rubber-bands is far more noticeable than a Wingull that does.
 */
import { SpatialHash, type Vec3 } from '@alola/core';

export interface NetEntity {
  readonly id: number;
  readonly position: Readonly<Vec3>;
  readonly isPlayer: boolean;
  /** Bumped whenever the entity's replicated state changes. */
  version: number;
}

export interface InterestBand {
  /** Maximum distance in metres for this band. */
  readonly maxDistance: number;
  /** Send an update every N server ticks. */
  readonly interval: number;
  /** Maximum entities from this band in one snapshot. */
  readonly budget: number;
}

/**
 * Bands tuned for a 20Hz server tick.
 * The near band is everything the player can interact with; the far band
 * exists so distant wildlife is present and roughly correct when the camera
 * pans, without costing per-tick bandwidth.
 */
export const DEFAULT_BANDS: readonly InterestBand[] = [
  { maxDistance: 60, interval: 1, budget: 40 },
  { maxDistance: 160, interval: 3, budget: 30 },
  { maxDistance: 400, interval: 10, budget: 20 },
  { maxDistance: 900, interval: 30, budget: 10 },
];

export interface ClientInterest {
  readonly playerId: string;
  position: Vec3;
  /** entityId -> last tick we sent it. */
  lastSent: Map<number, number>;
  /** entityId -> the version we last sent, so unchanged entities are skipped. */
  lastVersion: Map<number, number>;
  /** Entities the client currently believes exist. */
  known: Set<number>;
}

export interface InterestResult {
  /** Entities to include in this snapshot. */
  readonly updates: NetEntity[];
  /** Entities that left interest and should be removed client-side. */
  readonly removals: number[];
}

export class InterestManager {
  private readonly bands: readonly InterestBand[];
  private readonly grid: SpatialHash<NetEntity>;
  private clients = new Map<string, ClientInterest>();

  constructor(bands: readonly InterestBand[] = DEFAULT_BANDS, cellSize = 32) {
    this.bands = bands;
    this.grid = new SpatialHash<NetEntity>(cellSize);
  }

  /** Rebuild the spatial index. Called once per server tick. */
  rebuild(entities: Iterable<NetEntity>): void {
    this.grid.rebuild(entities);
  }

  addClient(playerId: string, position: Vec3): void {
    this.clients.set(playerId, {
      playerId,
      position: { ...position },
      lastSent: new Map(),
      lastVersion: new Map(),
      known: new Set(),
    });
  }

  removeClient(playerId: string): void {
    this.clients.delete(playerId);
  }

  updateClientPosition(playerId: string, position: Readonly<Vec3>): void {
    const client = this.clients.get(playerId);
    if (client) {
      client.position.x = position.x;
      client.position.y = position.y;
      client.position.z = position.z;
    }
  }

  /**
   * Compute what to send this client this tick.
   *
   * Entities are gathered per band, filtered by their update interval and by
   * whether they actually changed, then truncated to the band budget with the
   * closest kept. Players bypass the budget entirely.
   */
  gather(playerId: string, tick: number): InterestResult {
    const client = this.clients.get(playerId);
    if (!client) return { updates: [], removals: [] };

    const updates: NetEntity[] = [];
    const inRange = new Set<number>();

    let previousBandLimit = 0;
    for (const band of this.bands) {
      const candidates = this.grid.queryRadius(client.position, band.maxDistance);
      const bandEntities: { entity: NetEntity; distance: number }[] = [];

      for (const entity of candidates) {
        const dx = entity.position.x - client.position.x;
        const dz = entity.position.z - client.position.z;
        const distance = Math.hypot(dx, dz);

        // Each entity belongs to exactly one band — the innermost it fits in.
        if (distance <= previousBandLimit) continue;
        if (distance > band.maxDistance) continue;

        inRange.add(entity.id);

        // Players always update at full rate.
        if (!entity.isPlayer) {
          const lastTick = client.lastSent.get(entity.id) ?? -Infinity;
          if (tick - lastTick < band.interval) continue;

          // Skip entities whose state has not changed since we last sent them.
          const knownVersion = client.lastVersion.get(entity.id);
          if (knownVersion === entity.version && client.known.has(entity.id)) continue;
        }

        bandEntities.push({ entity, distance });
      }

      // Nearest first, then truncate to budget.
      bandEntities.sort((a, b) => a.distance - b.distance);
      const budget = band.budget;
      let taken = 0;
      for (const { entity } of bandEntities) {
        // `continue`, not `break`: the list is sorted by distance, so breaking
        // once the budget is spent would also skip every player behind that
        // point. A player standing behind forty Pokémon would simply never be
        // replicated — which is exactly the case players notice first.
        if (!entity.isPlayer && taken >= budget) continue;
        updates.push(entity);
        client.lastSent.set(entity.id, tick);
        client.lastVersion.set(entity.id, entity.version);
        client.known.add(entity.id);
        if (!entity.isPlayer) taken++;
      }

      previousBandLimit = band.maxDistance;
    }

    // Anything the client knows about that is no longer in range must be
    // explicitly removed, or it will linger forever as a ghost.
    const removals: number[] = [];
    for (const id of client.known) {
      if (!inRange.has(id)) {
        removals.push(id);
        client.known.delete(id);
        client.lastSent.delete(id);
        client.lastVersion.delete(id);
      }
    }

    return { updates, removals };
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Diagnostics for the server dashboard. */
  stats(playerId: string): { known: number; tracked: number } | null {
    const client = this.clients.get(playerId);
    if (!client) return null;
    return { known: client.known.size, tracked: client.lastSent.size };
  }
}
