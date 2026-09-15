/**
 * Authoritative world server.
 *
 * Runs the identical simulation packages the client runs — that is the whole
 * point of keeping them headless. The server is the authority on player
 * positions, wild Pokémon, world time and weather; clients predict locally and
 * reconcile against the snapshots this produces.
 *
 * Deliberately transport-agnostic: it takes messages in and hands snapshots
 * out, so it can be driven by WebSockets in production and by a plain array in
 * a test. Netcode that can only be tested by standing up a real socket
 * effectively cannot be tested at all.
 */
import { FixedClock, SpatialHash, vec3, type Vec3 } from '@alola/core';
import {
  TerrainGenerator, BiomeClassifier, TimeOfDay, WeatherSystem,
  Spawner, EcosystemModel, buildRegionId, speciesWeightsForBiome,
  worldToChunk,
} from '@alola/world';
import { allIslands, getSpecies, type BiomeId, type WeatherId } from '@alola/data';
import {
  PokemonBrain, BrainLod, lodForDistance, visibilityFrom,
  type BrainState, type BrainWorldView, type PerceivableAgent,
} from '@alola/ai';
import {
  InterestManager, PROTOCOL_VERSION,
  type ClientMessage, type ServerMessage, type NetEntity, type EntityDelta,
} from '@alola/net';
import { DeltaField, EntityFlag } from '@alola/net';

export interface ServerConfig {
  readonly worldSeed: number;
  /** Simulation ticks per second. 20 is the standard for this genre. */
  readonly tickRate?: number;
  /** Snapshots per second. May be lower than the tick rate. */
  readonly snapshotRate?: number;
  /** Maximum simultaneous players. */
  readonly maxPlayers?: number;
  /** Wild Pokémon simulated around each player. */
  readonly wildlifePerPlayer?: number;
}

interface ConnectedPlayer {
  readonly id: string;
  displayName: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  /** Last input sequence number processed. */
  lastAckSeq: number;
  /** Entity id in the replication set. */
  entityId: number;
  /** Messages waiting to be delivered to this client. */
  outbox: ServerMessage[];
  connectedAt: number;
}

export class WorldServer {
  private readonly config: Required<ServerConfig>;
  readonly terrain: TerrainGenerator;
  readonly classifier: BiomeClassifier;
  readonly timeOfDay: TimeOfDay;
  readonly weather: WeatherSystem;
  readonly spawner: Spawner;
  readonly ecology: EcosystemModel;
  private readonly interest: InterestManager;
  private readonly clock: FixedClock;

  private players = new Map<string, ConnectedPlayer>();
  private brains: PokemonBrain[] = [];
  private perceptionGrid = new SpatialHash<PerceivableAgent>(16);
  private regionNeighbours = new Map<string, string[]>();

  private nextEntityId = 1;
  tick = 0;
  private simTime = 0;
  private snapshotAccumulator = 0;

  /** Rolling metrics for the ops dashboard. */
  metrics = {
    tickMs: 0,
    peakTickMs: 0,
    players: 0,
    wildlife: 0,
    bytesOut: 0,
    snapshotsSent: 0,
  };

  constructor(config: ServerConfig) {
    this.config = {
      worldSeed: config.worldSeed,
      tickRate: config.tickRate ?? 20,
      snapshotRate: config.snapshotRate ?? 20,
      maxPlayers: config.maxPlayers ?? 64,
      wildlifePerPlayer: config.wildlifePerPlayer ?? 60,
    };

    this.terrain = new TerrainGenerator(this.config.worldSeed);
    this.classifier = new BiomeClassifier();
    this.timeOfDay = new TimeOfDay({ secondsPerDay: 72 * 60, startHour: 8 });
    this.weather = new WeatherSystem(this.config.worldSeed);
    this.spawner = new Spawner(this.config.worldSeed, this.terrain, this.classifier);
    this.ecology = new EcosystemModel(this.config.worldSeed);
    this.interest = new InterestManager();
    this.clock = new FixedClock({ tickRate: this.config.tickRate });

    this.seedEcology();
  }

  private seedEcology(): void {
    const biomes: BiomeId[] = [
      'tropical-forest', 'grassland', 'beach', 'dense-jungle', 'meadow',
      'ocean', 'reef', 'cave', 'canyon', 'volcanic-slope', 'desert', 'snowfield',
      'wetland', 'badlands', 'highland', 'ruins',
    ];
    for (const island of allIslands()) {
      const regions: string[] = [];
      for (const biome of biomes) {
        const weights = speciesWeightsForBiome(biome);
        if (weights.size === 0) continue;
        const id = buildRegionId(island.id, biome);
        this.ecology.addRegion({ id, islandId: island.id, biome }, weights);
        regions.push(id);
      }
      for (const id of regions) {
        this.regionNeighbours.set(id, regions.filter((other) => other !== id));
      }
    }
  }

  // ------------------------------------------------------------ connections

  connect(playerId: string, displayName: string, protocol: number): ServerMessage {
    if (protocol !== PROTOCOL_VERSION) {
      return {
        t: 'reject',
        reason: 'protocol-mismatch',
        detail: `Server speaks protocol ${PROTOCOL_VERSION}, client sent ${protocol}.`,
      };
    }
    if (this.players.size >= this.config.maxPlayers) {
      return { t: 'reject', reason: 'server-full', detail: `Server is at capacity (${this.config.maxPlayers}).` };
    }
    if (this.players.has(playerId)) {
      return { t: 'reject', reason: 'already-connected', detail: 'That player is already connected.' };
    }

    const melemele = allIslands().find((i) => i.id === 'melemele')!;
    const spawn = vec3(melemele.centerX - 1400, 0, melemele.centerZ - 900);
    spawn.y = this.terrain.sampleHeight(spawn.x, spawn.z);

    const player: ConnectedPlayer = {
      id: playerId,
      displayName,
      position: spawn,
      velocity: vec3(),
      yaw: 0,
      lastAckSeq: 0,
      entityId: this.nextEntityId++,
      outbox: [],
      connectedAt: this.simTime,
    };

    this.players.set(playerId, player);
    this.interest.addClient(playerId, spawn);

    return {
      t: 'welcome',
      playerId,
      serverTick: this.tick,
      worldSeed: this.config.worldSeed,
      tickRate: this.config.tickRate,
    };
  }

  disconnect(playerId: string): void {
    this.players.delete(playerId);
    this.interest.removeClient(playerId);
  }

  /** Feed a client message in. Returns any immediate reply. */
  handle(playerId: string, message: ClientMessage): ServerMessage | null {
    const player = this.players.get(playerId);

    switch (message.t) {
      case 'hello':
        return this.connect(message.playerId, message.displayName, message.protocol);

      case 'ping':
        return { t: 'pong', clientTime: message.clientTime, serverTime: Date.now() };

      case 'input': {
        if (!player) return null;
        // Reject out-of-order and replayed inputs outright: accepting them is
        // the simplest speed hack there is.
        if (message.seq <= player.lastAckSeq) return null;
        // Clamp dt so a client cannot claim a one-second frame and teleport.
        const dt = Math.min(Math.max(message.dt, 0), 0.1);
        this.applyInput(player, message.move.x, message.move.z, message.yaw, message.actions, dt);
        player.lastAckSeq = message.seq;
        return null;
      }

      case 'chat': {
        if (!player) return null;
        const text = message.text.slice(0, 280);
        const broadcast: ServerMessage = {
          t: 'chat',
          channel: message.channel,
          fromPlayerId: player.id,
          displayName: player.displayName,
          text,
          at: Date.now(),
        };
        for (const other of this.players.values()) other.outbox.push(broadcast);
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Authoritative movement.
   * The server runs the same integration the client predicts with, which is
   * what keeps reconciliation to sub-centimetre corrections in the normal case.
   */
  private applyInput(
    player: ConnectedPlayer,
    moveX: number,
    moveZ: number,
    yaw: number,
    actions: number,
    dt: number,
  ): void {
    const magnitude = Math.hypot(moveX, moveZ);
    const sprinting = (actions & 1) !== 0;
    const speed = sprinting ? 9 : 4.5;

    if (magnitude > 0.01) {
      const nx = moveX / magnitude;
      const nz = moveZ / magnitude;
      player.velocity.x = nx * speed;
      player.velocity.z = nz * speed;
    } else {
      player.velocity.x = 0;
      player.velocity.z = 0;
    }

    player.yaw = yaw;
    player.position.x += player.velocity.x * dt;
    player.position.z += player.velocity.z * dt;
    player.position.y = this.terrain.sampleHeight(player.position.x, player.position.z);

    this.interest.updateClientPosition(player.id, player.position);
  }

  // ------------------------------------------------------------------- tick

  /** Advance the simulation by one fixed step. */
  step(dt: number): void {
    const start = performance.now();
    this.tick++;
    this.simTime += dt;

    // Environment.
    const inGameDelta = dt * ((24 * 3600) / (72 * 60));
    this.timeOfDay.update(inGameDelta);
    this.weather.update(inGameDelta, this.timeOfDay.hour);

    // Wildlife population around players.
    this.maintainWildlife();

    // Perception.
    const agents: PerceivableAgent[] = [];
    for (const player of this.players.values()) {
      agents.push({
        id: player.entityId,
        position: player.position,
        speciesId: 'PLAYER',
        packId: -1,
        playerId: player.id,
        noise: Math.hypot(player.velocity.x, player.velocity.z) > 6 ? 1 : 0.4,
        inactive: false,
        level: 30,
      });
    }
    for (const brain of this.brains) {
      agents.push({
        id: brain.state.id,
        position: brain.state.position,
        speciesId: brain.state.speciesId,
        packId: brain.state.packId,
        playerId: null,
        noise: 0.4,
        inactive: false,
        level: brain.state.level,
      });
    }
    this.perceptionGrid.rebuild(agents);

    // AI.
    const melemeleWeather = this.weather.get('melemele');
    const visibility = visibilityFrom(
      melemeleWeather.fogDensity,
      this.timeOfDay.state.daylight,
      false,
    );
    const worldView: BrainWorldView = {
      hour: this.timeOfDay.hour,
      daylight: this.timeOfDay.state.daylight,
      visibility,
      now: this.simTime,
      grid: this.perceptionGrid,
      groundAt: (x, z) => this.terrain.sampleHeight(x, z),
    };

    for (const brain of this.brains) {
      brain.state.lod = this.lodFor(brain.state.position);
      brain.update(dt, worldView);
    }

    // Ecology, on a slow cadence.
    if (this.tick % (this.config.tickRate * 60) === 0) {
      this.ecology.tick(this.regionNeighbours);
    }

    // Snapshots.
    this.snapshotAccumulator += dt;
    const snapshotInterval = 1 / this.config.snapshotRate;
    if (this.snapshotAccumulator >= snapshotInterval) {
      this.snapshotAccumulator -= snapshotInterval;
      this.sendSnapshots();
    }

    const elapsed = performance.now() - start;
    this.metrics.tickMs = elapsed;
    if (elapsed > this.metrics.peakTickMs) this.metrics.peakTickMs = elapsed;
    this.metrics.players = this.players.size;
    this.metrics.wildlife = this.brains.length;
  }

  private lodFor(position: Readonly<Vec3>): BrainLod {
    let nearest = Infinity;
    for (const player of this.players.values()) {
      const d = Math.hypot(position.x - player.position.x, position.z - player.position.z);
      if (d < nearest) nearest = d;
    }
    return lodForDistance(nearest);
  }

  /** Keep wildlife populated around players, and retire what nobody can see. */
  private maintainWildlife(): void {
    const cap = this.players.size * this.config.wildlifePerPlayer;

    // Retire distant agents first, so the cap is spent on what matters.
    this.brains = this.brains.filter((brain) => {
      let nearest = Infinity;
      for (const player of this.players.values()) {
        const d = Math.hypot(
          brain.state.position.x - player.position.x,
          brain.state.position.z - player.position.z,
        );
        if (d < nearest) nearest = d;
      }
      return nearest < 800;
    });

    if (this.brains.length >= cap) return;

    const weatherFor = (islandId: string | null): WeatherId =>
      this.weather.weatherIdFor(islandId ?? 'melemele') as WeatherId;

    for (const player of this.players.values()) {
      if (this.brains.length >= cap) break;
      const { cx, cz } = worldToChunk(player.position.x, player.position.z);

      // Sample the surrounding chunks, not just the one the player stands in.
      // A player in a town or on a dock is otherwise surrounded by nothing,
      // because that single chunk's biome may have no eligible spawns at the
      // current hour — which is exactly what the server self-test caught.
      const candidates: ReturnType<typeof this.spawner.populateChunk> = [];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          candidates.push(
            ...this.spawner.populateChunk(
              cx + dx, cz + dz, this.timeOfDay.hour, weatherFor, new Set<string>(),
            ),
          );
        }
      }

      for (const p of candidates) {
        if (this.brains.length >= cap) break;
        const tooClose = this.brains.some(
          (b) => Math.hypot(b.state.position.x - p.position.x, b.state.position.z - p.position.z) < 3,
        );
        if (tooClose) continue;

        const state: BrainState = {
          id: this.nextEntityId++,
          speciesId: p.speciesId,
          position: vec3(p.position.x, p.position.y, p.position.z),
          velocity: vec3(),
          yaw: p.yaw,
          home: vec3(p.position.x, p.position.y, p.position.z),
          packId: p.packId,
          level: p.level,
          health: 100,
          maxHealth: 100,
          lod: BrainLod.Full,
        };
        this.brains.push(new PokemonBrain(state, this.config.worldSeed ^ state.id));
      }
    }
  }

  // -------------------------------------------------------------- snapshots

  private sendSnapshots(): void {
    // Build the replication set.
    const entities: NetEntity[] = [];
    for (const player of this.players.values()) {
      entities.push({
        id: player.entityId,
        position: player.position,
        isPlayer: true,
        // Players change every tick, so the version always differs.
        version: this.tick,
      });
    }
    for (const brain of this.brains) {
      entities.push({
        id: brain.state.id,
        position: brain.state.position,
        isPlayer: false,
        // Dormant agents do not move, so their version does not change and
        // interest management skips resending them — which is most of the
        // bandwidth saving at distance.
        version: brain.state.lod === BrainLod.Dormant ? 0 : this.tick,
      });
    }
    this.interest.rebuild(entities);

    for (const player of this.players.values()) {
      const result = this.interest.gather(player.id, this.tick);
      const deltas: EntityDelta[] = [];

      for (const entity of result.updates) {
        const delta: EntityDelta = {
          id: entity.id,
          mask: DeltaField.Position,
          x: round2(entity.position.x),
          y: round2(entity.position.y),
          z: round2(entity.position.z),
        };

        const brain = this.brains.find((b) => b.state.id === entity.id);
        if (brain) {
          delta.mask |= DeltaField.Yaw | DeltaField.Species | DeltaField.Flags;
          delta.yaw = round2(brain.state.yaw);
          delta.species = getSpecies(brain.state.speciesId).dex;
          delta.flags = brain.state.lod === BrainLod.Dormant ? 0 : 0;
        } else if (entity.isPlayer) {
          const other = [...this.players.values()].find((p) => p.entityId === entity.id);
          if (other) {
            delta.mask |= DeltaField.Yaw | DeltaField.Velocity | DeltaField.Flags;
            delta.yaw = round2(other.yaw);
            delta.vx = round2(other.velocity.x);
            delta.vz = round2(other.velocity.z);
            delta.flags = EntityFlag.IsPlayer;
          }
        }

        deltas.push(delta);
      }

      const snapshot: ServerMessage = {
        t: 'snapshot',
        tick: this.tick,
        ackSeq: player.lastAckSeq,
        baseline: 0,
        entities: deltas,
        removed: result.removals,
      };

      player.outbox.push(snapshot);
      this.metrics.snapshotsSent++;
      this.metrics.bytesOut += JSON.stringify(snapshot).length;
    }

    // Periodic world state: time and weather, which every client needs but
    // which change far too slowly to belong in a per-tick snapshot.
    if (this.tick % (this.config.tickRate * 5) === 0) {
      const weatherMap: Record<string, string> = {};
      for (const island of allIslands()) {
        weatherMap[island.id] = this.weather.weatherIdFor(island.id);
      }
      const worldState: ServerMessage = {
        t: 'world-state',
        tick: this.tick,
        hour: round2(this.timeOfDay.hour),
        weather: weatherMap,
      };
      for (const player of this.players.values()) player.outbox.push(worldState);
    }
  }

  /** Drain and return a player's pending messages. */
  drain(playerId: string): ServerMessage[] {
    const player = this.players.get(playerId);
    if (!player) return [];
    const messages = player.outbox;
    player.outbox = [];
    return messages;
  }

  /** Run the server loop against a real clock. */
  run(nowSeconds: number): number {
    return this.clock.advance(nowSeconds, (dt) => this.step(dt));
  }

  get playerCount(): number {
    return this.players.size;
  }

  get wildlifeCount(): number {
    return this.brains.length;
  }

  playerPosition(playerId: string): Readonly<Vec3> | null {
    return this.players.get(playerId)?.position ?? null;
  }
}

/** Quantise to 2 decimal places — centimetre precision is plenty over the wire. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
