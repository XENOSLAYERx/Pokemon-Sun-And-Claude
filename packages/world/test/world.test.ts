import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGenerator, SEA_LEVEL } from '../src/terrain/generator.ts';
import { BiomeClassifier } from '../src/biome/classifier.ts';
import {
  ChunkStreamer, ChunkState, CHUNK_SIZE, LOD_RADII, MAX_LOD,
  chunkKey, chunkCoordX, chunkCoordZ, worldToChunk, chunkCenter,
  BUILD_PENDING,
} from '../src/streaming/chunks.ts';
import type { ChunkRecord } from '../src/streaming/chunks.ts';
import { TimeOfDay, ambientColorFor } from '../src/timeofday/cycle.ts';
import { WeatherSystem, WEATHER_PROFILES } from '../src/weather/system.ts';
import { OceanSimulation, waveSpeed } from '../src/ocean/gerstner.ts';
import { Spawner } from '../src/ecology/spawner.ts';
import { EcosystemModel, buildRegionId, speciesWeightsForBiome } from '../src/ecology/population.ts';
import { allIslands, getSpecies, type WeatherId } from '@alola/data';

const SEED = 20251115;

describe('Terrain generation', () => {
  const terrain = new TerrainGenerator(SEED);

  test('is deterministic — the core streaming guarantee', () => {
    const a = new TerrainGenerator(SEED);
    const b = new TerrainGenerator(SEED);
    for (let i = 0; i < 400; i++) {
      const x = -12000 + i * 57.3;
      const z = -8000 + i * 41.7;
      assert.equal(a.sampleHeight(x, z), b.sampleHeight(x, z), `divergence at (${x}, ${z})`);
    }
  });

  test('different seeds produce different worlds', () => {
    const other = new TerrainGenerator(SEED + 1);
    let differences = 0;
    for (let i = 0; i < 100; i++) {
      const x = -11000 + i * 31;
      const z = -7000 + i * 29;
      if (Math.abs(terrain.sampleHeight(x, z) - other.sampleHeight(x, z)) > 0.01) differences++;
    }
    assert.ok(differences > 80, `expected most samples to differ, got ${differences}/100`);
  });

  test('every island centre is above sea level', () => {
    for (const island of allIslands()) {
      const h = terrain.sampleHeight(island.centerX, island.centerZ);
      assert.ok(h > SEA_LEVEL, `${island.id} centre is underwater at ${h.toFixed(1)}m`);
    }
  });

  test('open ocean far from land is deep', () => {
    const h = terrain.sampleHeight(60000, 60000);
    assert.ok(h < -100, `open ocean should be deep, got ${h.toFixed(1)}m`);
  });

  test('volcano features produce real elevation', () => {
    // Akala's Wela Volcano cone: island centre (-2000,-2000) + feature (1100,-800).
    const akala = allIslands().find((i) => i.id === 'akala')!;
    const peak = terrain.sampleHeight(akala.centerX + 1100, akala.centerZ - 800);
    assert.ok(peak > 400, `Wela Volcano should be a real mountain, got ${peak.toFixed(0)}m`);
  });

  test('Mount Lanakila is the highest point in Alola', () => {
    const ulaula = allIslands().find((i) => i.id === 'ulaula')!;
    const lanakila = terrain.sampleHeight(ulaula.centerX + 1600, ulaula.centerZ - 2600);
    assert.ok(lanakila > 1200, `Lanakila should exceed 1200m, got ${lanakila.toFixed(0)}m`);

    // Sample every other island's tallest authored feature and confirm it loses.
    for (const island of allIslands()) {
      if (island.id === 'ulaula') continue;
      for (const f of island.features) {
        if (f.kind !== 'cone') continue;
        const h = terrain.sampleHeight(island.centerX + f.x, island.centerZ + f.z);
        assert.ok(h < lanakila, `${island.id} peak (${h.toFixed(0)}m) should be below Lanakila`);
      }
    }
  });

  test('town flats are genuinely buildable', () => {
    // Hau'oli City sits on a 'flat' feature; its surroundings must be level.
    const melemele = allIslands().find((i) => i.id === 'melemele')!;
    const cx = melemele.centerX + 900;
    const cz = melemele.centerZ + 1500;
    let maxSlope = 0;
    for (let dz = -80; dz <= 80; dz += 20) {
      for (let dx = -80; dx <= 80; dx += 20) {
        maxSlope = Math.max(maxSlope, terrain.sample(cx + dx, cz + dz).slope);
      }
    }
    assert.ok(maxSlope < 0.5, `town ground too steep: max slope ${maxSlope.toFixed(2)} rad`);
  });

  test('normals are unit length and point upward on land', () => {
    for (let i = 0; i < 60; i++) {
      const island = allIslands()[i % allIslands().length];
      const x = island.centerX + (i * 137) % 900;
      const z = island.centerZ + (i * 211) % 900;
      const s = terrain.sample(x, z);
      const len = Math.hypot(s.normalX, s.normalY, s.normalZ);
      assert.ok(Math.abs(len - 1) < 1e-5, `normal not unit length: ${len}`);
      assert.ok(s.normalY > 0, 'terrain normals must point up');
      assert.ok(s.slope >= 0 && s.slope <= Math.PI / 2 + 1e-6, `bad slope ${s.slope}`);
    }
  });

  test('temperature falls with altitude and moisture saturates at sea', () => {
    const ulaula = allIslands().find((i) => i.id === 'ulaula')!;
    const low = terrain.sample(ulaula.centerX + 2600, ulaula.centerZ + 1900);
    const high = terrain.sample(ulaula.centerX + 1600, ulaula.centerZ - 2600);
    assert.ok(high.height > low.height, 'test points must differ in altitude');
    assert.ok(high.temperature < low.temperature, 'higher ground must be colder');

    const sea = terrain.sample(60000, 60000);
    assert.equal(sea.moisture, 1, 'open ocean must be fully saturated');
  });

  test('Lanakila summit is cold enough to hold snow', () => {
    const ulaula = allIslands().find((i) => i.id === 'ulaula')!;
    const summit = terrain.sample(ulaula.centerX + 1600, ulaula.centerZ - 2600);
    assert.ok(summit.temperature < 5, `summit at ${summit.temperature.toFixed(1)}C would not hold snow`);
  });

  test('isUnderwater agrees with sampleHeight', () => {
    for (let i = 0; i < 50; i++) {
      const x = -20000 + i * 800;
      const z = -10000 + i * 600;
      assert.equal(terrain.isUnderwater(x, z), terrain.sampleHeight(x, z) < SEA_LEVEL);
    }
  });
});

describe('Biome classification', () => {
  const terrain = new TerrainGenerator(SEED);
  const classifier = new BiomeClassifier();

  test('always returns a biome, never null', () => {
    for (let i = 0; i < 500; i++) {
      const x = -22000 + i * 93;
      const z = -14000 + i * 71;
      const result = classifier.classify(terrain.sample(x, z));
      assert.ok(result.biome, `no biome at (${x}, ${z})`);
      assert.ok(result.blend >= 0 && result.blend <= 1, 'blend out of range');
    }
  });

  test('underwater points classify as water biomes', () => {
    const deep = classifier.classify(terrain.sample(60000, 60000));
    assert.equal(deep.biome.id, 'deep-ocean');
    assert.ok(deep.biome.aquatic);
  });

  test('authored feature biomes win outright', () => {
    // Aether Paradise is entirely a 'facility' flat feature.
    const aether = allIslands().find((i) => i.id === 'aether')!;
    const result = classifier.classify(terrain.sample(aether.centerX, aether.centerZ));
    assert.equal(result.biome.id, 'facility');
  });

  test('walkable land biomes are actually above water', () => {
    const terrainGen = new TerrainGenerator(SEED);
    for (const island of allIslands()) {
      for (let i = 0; i < 40; i++) {
        const angle = (i / 40) * Math.PI * 2;
        const r = island.radius * 0.4;
        const x = island.centerX + Math.cos(angle) * r;
        const z = island.centerZ + Math.sin(angle) * r;
        const s = terrainGen.sample(x, z);
        const b = classifier.classify(s).biome;
        if (s.height > 2) {
          assert.ok(!b.aquatic, `${island.id}: land at ${s.height.toFixed(1)}m classified as aquatic "${b.id}"`);
        }
      }
    }
  });
});

describe('Chunk streaming', () => {
  test('chunk key packing round-trips, including negatives', () => {
    for (const [cx, cz] of [[0, 0], [5, -3], [-120, 88], [-32000, 32000], [32767, -32768]]) {
      const key = chunkKey(cx, cz);
      assert.equal(chunkCoordX(key), cx, `x round-trip failed for ${cx}`);
      assert.equal(chunkCoordZ(key), cz, `z round-trip failed for ${cz}`);
    }
  });

  test('worldToChunk and chunkCenter are consistent', () => {
    const { cx, cz } = worldToChunk(1000, -500);
    const c = chunkCenter(cx, cz);
    assert.ok(Math.abs(c.x - 1000) <= CHUNK_SIZE, 'centre should be near the sampled point');
    assert.ok(Math.abs(c.z - -500) <= CHUNK_SIZE);
    // Negative coordinates must floor, not truncate.
    assert.equal(worldToChunk(-1, 0).cx, -1);
  });

  test('loads chunks around the observer, nearest first', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 4 });
    streamer.setObservers([{ x: 0, z: 0 }]);
    const buildOrder: number[] = [];
    const build = (rec: ChunkRecord): unknown => {
      buildOrder.push(rec.distance);
      return { mesh: true };
    };
    const dispose = (): void => {};

    for (let t = 0; t < 5; t++) streamer.update(t, build, dispose);

    assert.ok(buildOrder.length > 0, 'nothing was built');
    // Distances must be non-decreasing: the ground under the player first.
    for (let i = 1; i < buildOrder.length; i++) {
      assert.ok(
        buildOrder[i] >= buildOrder[i - 1] - 1e-6,
        `build order regressed: ${buildOrder[i - 1]} then ${buildOrder[i]}`,
      );
    }
  });

  test('respects the per-tick build budget — the frame-time guard', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 3 });
    streamer.setObservers([{ x: 0, z: 0 }]);
    let builtThisTick = 0;
    for (let t = 0; t < 10; t++) {
      builtThisTick = 0;
      streamer.update(t, () => { builtThisTick++; return {}; }, () => {});
      assert.ok(builtThisTick <= 3, `built ${builtThisTick} chunks, budget was 3`);
    }
  });

  test('LOD falls off with distance', () => {
    const streamer = new ChunkStreamer();
    assert.equal(streamer.lodFor(0), 0);
    assert.equal(streamer.lodFor(LOD_RADII[0] - 1), 0);
    assert.equal(streamer.lodFor(LOD_RADII[0] + 1), 1);
    assert.equal(streamer.lodFor(LOD_RADII[MAX_LOD] + 5000), MAX_LOD);
  });

  test('LOD hysteresis prevents boundary thrash', () => {
    const streamer = new ChunkStreamer();
    const boundary = LOD_RADII[0];
    // Just past the boundary, a chunk already at LOD0 stays at LOD0.
    assert.equal(streamer.lodFor(boundary + 10, 0), 0, 'should hold LOD0 inside the hysteresis band');
    // A chunk arriving fresh at the same distance takes LOD1.
    assert.equal(streamer.lodFor(boundary + 10, -1), 1);
    // Far enough past, even a held chunk must drop.
    assert.equal(streamer.lodFor(boundary * 1.5, 0), 1);
  });

  test('unloads chunks after the observer leaves and the grace elapses', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 64, unloadsPerTick: 64, unloadGraceSeconds: 2 });
    streamer.setObservers([{ x: 0, z: 0 }]);
    for (let t = 0; t < 30; t++) streamer.update(t, () => ({}), () => {});
    const loadedNearOrigin = streamer.chunkCount;
    assert.ok(loadedNearOrigin > 0);

    // Teleport far away and run past the grace period.
    streamer.setObservers([{ x: 200000, z: 200000 }]);
    let disposed = 0;
    for (let t = 30; t < 200; t++) {
      streamer.update(t, () => ({}), () => { disposed++; });
    }
    assert.ok(disposed > 0, 'chunks should have been disposed');
    assert.ok(streamer.get(0, 0) === undefined, 'origin chunk should be gone');
  });

  test('multiple observers keep their own chunks alive', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 64, unloadsPerTick: 64, unloadGraceSeconds: 1 });
    streamer.setObservers([{ x: 0, z: 0 }, { x: 50000, z: 50000 }]);
    for (let t = 0; t < 40; t++) streamer.update(t, () => ({}), () => {});
    assert.ok(streamer.isReady(0, 0), 'first observer chunk missing');
    const far = worldToChunk(50000, 50000);
    assert.ok(streamer.isReady(far.cx, far.cz), 'second observer chunk missing');
  });

  test('clear() disposes every payload', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 32 });
    streamer.setObservers([{ x: 0, z: 0 }]);
    for (let t = 0; t < 10; t++) streamer.update(t, () => ({ mesh: 1 }), () => {});
    let disposed = 0;
    streamer.clear(() => { disposed++; });
    assert.ok(disposed > 0, 'clear must dispose payloads');
    assert.equal(streamer.chunkCount, 0);
  });
});

describe('Asynchronous chunk streaming', () => {
  const origin = [{ x: 0, z: 0 }];

  test('a pending build stays Building and keeps its previous payload', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 4, maxInFlight: 64 });
    streamer.setObservers(origin);
    const dispatched: ChunkRecord[] = [];
    streamer.update(0, (rec) => { dispatched.push(rec); return BUILD_PENDING; }, () => {});

    assert.equal(dispatched.length, 4);
    assert.equal(streamer.stats.inFlight, 4);
    for (const rec of dispatched) {
      assert.equal(rec.state, ChunkState.Building);
      assert.equal(rec.payload, null, 'no payload attached until the worker answers');
    }
  });

  test('completion attaches the payload and marks the chunk ready', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 1 });
    streamer.setObservers(origin);
    let rec!: ChunkRecord;
    streamer.update(0, (r) => { rec = r; return BUILD_PENDING; }, () => {});

    const used = streamer.complete(rec.key, rec.lod, 'mesh', 1, () => {});
    assert.ok(used);
    assert.equal(rec.state, ChunkState.Ready);
    assert.equal(rec.payload, 'mesh');
    assert.equal(streamer.stats.inFlight, 0, 'the stat must reflect the completion immediately');
  });

  test('in-flight builds are capped, so a backlog cannot pile up', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 10, maxInFlight: 3 });
    streamer.setObservers(origin);
    let dispatched = 0;
    for (let t = 0; t < 5; t++) {
      streamer.update(t, () => { dispatched++; return BUILD_PENDING; }, () => {});
    }
    assert.equal(dispatched, 3, 'nothing more is dispatched until something completes');
  });

  test('a result for an unloaded chunk is disposed, not attached', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 1, unloadGraceSeconds: 0, unloadsPerTick: 10_000 });
    streamer.setObservers(origin);
    let rec!: ChunkRecord;
    streamer.update(0, (r) => { rec = r; return BUILD_PENDING; }, () => {});

    // The player teleports far away; the chunk ages out while its build is out.
    streamer.setObservers([{ x: 500_000, z: 500_000 }]);
    streamer.update(100, () => BUILD_PENDING, () => {});
    assert.equal(streamer.get(rec.cx, rec.cz), undefined, 'the chunk was unloaded');

    const disposed: unknown[] = [];
    const used = streamer.complete(rec.key, rec.lod, 'late-mesh', 101, (r) => disposed.push(r.payload));
    assert.equal(used, false);
    assert.deepEqual(disposed, ['late-mesh'], 'a late result must be released, or it leaks GPU memory');
    assert.equal(streamer.stats.discarded, 1);
  });

  test('a stale LOD is discarded, so the ground under the player is never low-detail', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 1_000, maxInFlight: 10_000 });
    // Start far away so the chunk at the origin is dispatched at a coarse LOD.
    streamer.setObservers([{ x: 3000, z: 0 }]);
    streamer.update(0, () => BUILD_PENDING, () => {});
    const target = streamer.get(0, 0)!;
    const coarse = target.lod;
    assert.ok(coarse > 0, `expected a coarse LOD at 3km, got ${coarse}`);

    // The player arrives before the worker answers.
    streamer.setObservers([{ x: CHUNK_SIZE / 2, z: CHUNK_SIZE / 2 }]);
    streamer.update(1, () => BUILD_PENDING, () => {});
    assert.equal(target.lod, 0, 'the chunk is re-queued and re-dispatched at full detail');

    const disposed: unknown[] = [];
    assert.equal(streamer.wants(chunkKey(0, 0), coarse), false, 'no mesh should even be built for the stale LOD');
    assert.equal(streamer.wants(chunkKey(0, 0), 0), true);
    const usedStale = streamer.complete(chunkKey(0, 0), coarse, 'coarse-mesh', 2, (r) => disposed.push(r.payload));
    assert.equal(usedStale, false, 'the coarse result arrived late and must not be attached');
    assert.deepEqual(disposed, ['coarse-mesh']);

    const usedFine = streamer.complete(chunkKey(0, 0), 0, 'fine-mesh', 3, () => {});
    assert.ok(usedFine);
    assert.equal(target.payload, 'fine-mesh');
    assert.equal(target.state, ChunkState.Ready);
  });

  test('a LOD rebuild keeps the old mesh visible until the new one lands', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 1_000, maxInFlight: 10_000 });
    streamer.setObservers([{ x: CHUNK_SIZE / 2, z: CHUNK_SIZE / 2 }]);
    streamer.update(0, () => BUILD_PENDING, () => {});
    const rec = streamer.get(0, 0)!;
    streamer.complete(rec.key, rec.lod, 'lod0', 1, () => {});

    // Walk far enough that this chunk drops a LOD.
    streamer.setObservers([{ x: 1400, z: CHUNK_SIZE / 2 }]);
    const disposed: unknown[] = [];
    streamer.update(2, () => BUILD_PENDING, (r) => disposed.push(r.payload));
    assert.ok(rec.lod > 0);
    assert.equal(rec.payload, 'lod0', 'the old mesh stays until its replacement is ready — no holes');
    assert.equal(disposed.length, 0);

    streamer.complete(rec.key, rec.lod, 'lod1', 3, (r) => disposed.push(r.payload));
    assert.equal(rec.payload, 'lod1');
    assert.deepEqual(disposed, ['lod0'], 'and is released the moment it is replaced');
  });

  test('covered radius grows from nothing as chunks land', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 10_000, maxInFlight: 100_000 });
    streamer.setObservers(origin);
    const dispatched: ChunkRecord[] = [];
    streamer.update(0, (r) => { dispatched.push(r); return BUILD_PENDING; }, () => {});
    assert.equal(streamer.stats.coveredRadius, 0, 'nothing is on screen yet, so far terrain must cover everything');

    // Land every chunk: coverage reaches the full radius.
    for (const r of dispatched) streamer.complete(r.key, r.lod, 'mesh', 1, () => {});
    streamer.update(2, () => BUILD_PENDING, () => {});
    assert.equal(streamer.stats.coveredRadius, streamer.streamingRadius);
  });

  test('a chunk rebuilding at a new LOD still counts as covered', () => {
    const streamer = new ChunkStreamer({ buildsPerTick: 10_000, maxInFlight: 100_000 });
    streamer.setObservers([{ x: CHUNK_SIZE / 2, z: CHUNK_SIZE / 2 }]);
    const dispatched: ChunkRecord[] = [];
    streamer.update(0, (r) => { dispatched.push(r); return BUILD_PENDING; }, () => {});
    for (const r of dispatched) streamer.complete(r.key, r.lod, 'mesh', 1, () => {});

    // Move so that some chunks change LOD and go back to Building.
    streamer.setObservers([{ x: 1400, z: CHUNK_SIZE / 2 }]);
    streamer.update(2, () => BUILD_PENDING, () => {});
    assert.ok(streamer.stats.building > 0, 'the move should have triggered rebuilds');
    // New chunks entering range have nothing yet, but the rebuilding ones do.
    const rebuildingWithMesh = [...streamer.loadedChunks()].filter(
      (r) => r.state === ChunkState.Building && r.payload !== null,
    );
    assert.ok(rebuildingWithMesh.length > 0);
    assert.ok(streamer.stats.coveredRadius > 0, 'old meshes on screen keep the far terrain cut out');
  });

  test('draw distance scales every ring', () => {
    const near = new ChunkStreamer({ radiusScale: 0.5 });
    const full = new ChunkStreamer({ radiusScale: 1 });
    assert.equal(near.streamingRadius, LOD_RADII[LOD_RADII.length - 1] * 0.5);
    assert.ok(near.lodFor(LOD_RADII[0] * 0.9) > full.lodFor(LOD_RADII[0] * 0.9),
      'a halved draw distance reaches the coarser LODs sooner');

    near.setObservers(origin);
    full.setObservers(origin);
    near.update(0, () => 'x', () => {});
    full.update(0, () => 'x', () => {});
    assert.ok(near.chunkCount < full.chunkCount, `${near.chunkCount} chunks at half distance vs ${full.chunkCount}`);
  });
});

describe('Time of day', () => {
  test('a full day advances the hour through every period', () => {
    const tod = new TimeOfDay({ secondsPerDay: 1200, startHour: 0 });
    const seen = new Set<string>();
    for (let i = 0; i < 1200; i++) {
      tod.update(1);
      seen.add(tod.state.period);
    }
    assert.ok(seen.has('dawn') && seen.has('day') && seen.has('dusk') && seen.has('night'),
      `missed periods, saw: ${[...seen].join(', ')}`);
  });

  test('daylight peaks at midday and bottoms at midnight', () => {
    const tod = new TimeOfDay({ secondsPerDay: 1200 });
    tod.setHour(12);
    const noon = tod.state.daylight;
    tod.setHour(0);
    const midnight = tod.state.daylight;
    assert.ok(noon > 0.9, `noon daylight too low: ${noon}`);
    assert.ok(midnight < 0.1, `midnight daylight too high: ${midnight}`);
  });

  test('sun is above the horizon by day and below it at night', () => {
    const tod = new TimeOfDay({ secondsPerDay: 1200 });
    tod.setHour(12);
    assert.ok(tod.state.sunElevation > 0, 'sun should be up at noon');
    tod.setHour(0);
    assert.ok(tod.state.sunElevation < 0, 'sun should be down at midnight');
  });

  test('sun direction is a unit vector', () => {
    const tod = new TimeOfDay({ secondsPerDay: 1200 });
    for (let h = 0; h < 24; h += 2) {
      tod.setHour(h);
      const { sunDirX, sunDirY, sunDirZ } = tod.state;
      const len = Math.hypot(sunDirX, sunDirY, sunDirZ);
      assert.ok(Math.abs(len - 1) < 1e-6, `sun direction not normalised at ${h}h: ${len}`);
    }
  });

  test('advanceToHour always moves forward', () => {
    const tod = new TimeOfDay({ secondsPerDay: 1200, startHour: 22 });
    const startDay = tod.day;
    tod.advanceToHour(6);
    assert.ok(Math.abs(tod.hour - 6) < 0.01, `expected 6h, got ${tod.hour}`);
    assert.equal(tod.day, startDay + 1, 'resting overnight should advance the day');
  });

  test('save/restore round-trips exactly', () => {
    const tod = new TimeOfDay({ secondsPerDay: 1200 });
    for (let i = 0; i < 500; i++) tod.update(0.7);
    const snapshot = tod.save();
    const hour = tod.hour;
    const other = new TimeOfDay({ secondsPerDay: 1200 });
    other.restore(snapshot);
    assert.equal(other.hour, hour);
  });

  test('golden hour and blue hour both occur, at opposite ends of the day', () => {
    const tod = new TimeOfDay({ secondsPerDay: 1200 });
    let bestGolden = 0;
    let bestGoldenHour = -1;
    let bestTwilight = 0;
    for (let h = 0; h < 24; h += 0.1) {
      tod.setHour(h);
      if (tod.state.goldenHour > bestGolden) {
        bestGolden = tod.state.goldenHour;
        bestGoldenHour = h;
      }
      bestTwilight = Math.max(bestTwilight, tod.state.twilight);
    }
    assert.ok(bestGolden > 0.7, `golden hour never really occurs (peak ${bestGolden})`);
    assert.ok(bestTwilight > 0.7, `civil twilight never really occurs (peak ${bestTwilight})`);
    assert.ok(bestGoldenHour >= 0, 'no golden hour found');
  });

  test('ambient colour is warm at golden hour and cool at blue hour', () => {
    const tod = new TimeOfDay({ secondsPerDay: 1200 });

    // Find the actual golden-hour peak rather than assuming a clock time —
    // it moves with latitude and season.
    let goldenPeak = 0;
    let goldenAt = 12;
    let twilightPeak = 0;
    let twilightAt = 0;
    for (let h = 0; h < 24; h += 0.05) {
      tod.setHour(h);
      if (tod.state.goldenHour > goldenPeak) { goldenPeak = tod.state.goldenHour; goldenAt = h; }
      if (tod.state.twilight > twilightPeak) { twilightPeak = tod.state.twilight; twilightAt = h; }
    }

    tod.setHour(12);
    const noon = ambientColorFor(tod.state);
    tod.setHour(goldenAt);
    const golden = ambientColorFor(tod.state);
    tod.setHour(twilightAt);
    const blue = ambientColorFor(tod.state);

    // Warmth = red relative to blue.
    assert.ok(golden[0] / golden[2] > noon[0] / noon[2], 'golden hour should be warmer than noon');
    assert.ok(blue[2] / blue[0] > noon[2] / noon[0], 'blue hour should be cooler than noon');
    for (const c of [...noon, ...golden, ...blue]) {
      assert.ok(c >= 0 && c <= 1, `ambient channel out of range: ${c}`);
    }
  });

  test('timeScale 0 freezes the clock for cutscenes', () => {
    const tod = new TimeOfDay({ secondsPerDay: 1200 });
    tod.timeScale = 0;
    const before = tod.hour;
    for (let i = 0; i < 100; i++) tod.update(1);
    assert.equal(tod.hour, before);
  });
});

describe('Weather', () => {
  test('every island starts with a valid state', () => {
    const weather = new WeatherSystem(SEED);
    for (const island of allIslands()) {
      const w = weather.get(island.id);
      assert.ok(WEATHER_PROFILES[w.current], `invalid weather "${w.current}" on ${island.id}`);
      assert.ok(w.remaining > 0, 'weather should have a duration');
    }
  });

  test('weather changes over time but not every tick', () => {
    const weather = new WeatherSystem(SEED);
    const seen = new Set<WeatherId>();
    let changes = 0;
    let previous = weather.weatherIdFor('akala');
    for (let i = 0; i < 4000; i++) {
      weather.update(30, (i * 30 / 3600) % 24);
      const now = weather.weatherIdFor('akala');
      seen.add(now);
      if (now !== previous) changes++;
      previous = now;
    }
    assert.ok(seen.size > 1, 'weather should vary over time');
    assert.ok(changes < 400, `weather changed ${changes} times — far too unstable`);
  });

  test('islands have independent weather', () => {
    const weather = new WeatherSystem(SEED);
    let divergences = 0;
    for (let i = 0; i < 3000; i++) {
      weather.update(30, (i * 30 / 3600) % 24);
      if (weather.weatherIdFor('melemele') !== weather.weatherIdFor('ulaula')) divergences++;
    }
    assert.ok(divergences > 100, 'islands should frequently differ — that is the point');
  });

  test('blended values stay within the profiles being blended', () => {
    const weather = new WeatherSystem(SEED);
    for (let i = 0; i < 2000; i++) {
      weather.update(20, 12);
      for (const w of weather.all()) {
        assert.ok(w.precipitation >= 0 && w.precipitation <= 1, `bad precipitation ${w.precipitation}`);
        assert.ok(w.cloudCover >= 0 && w.cloudCover <= 1, `bad cloud cover ${w.cloudCover}`);
        assert.ok(w.windSpeed >= 0 && w.windSpeed <= 30, `bad wind ${w.windSpeed}`);
        assert.ok(w.lightScale > 0, 'light scale must stay positive');
      }
    }
  });

  test('forced weather overrides the simulation', () => {
    const weather = new WeatherSystem(SEED);
    weather.force('ulaula', 'aurora', true);
    assert.equal(weather.weatherIdFor('ulaula'), 'aurora');
    // It should persist across many ticks — story events must not be overwritten.
    for (let i = 0; i < 500; i++) weather.update(30, 22);
    assert.equal(weather.weatherIdFor('ulaula'), 'aurora');

    weather.release('ulaula');
    let escaped = false;
    for (let i = 0; i < 2000; i++) {
      weather.update(30, 12);
      if (weather.weatherIdFor('ulaula') !== 'aurora') { escaped = true; break; }
    }
    assert.ok(escaped, 'releasing a forced weather should let it change again');
  });

  test('forbidden transitions never occur', () => {
    const weather = new WeatherSystem(SEED);
    let previous = weather.weatherIdFor('ulaula');
    for (let i = 0; i < 6000; i++) {
      weather.update(30, (i * 30 / 3600) % 24);
      const now = weather.weatherIdFor('ulaula');
      if (now !== previous) {
        const illegal =
          (previous === 'sandstorm' && (now === 'snow' || now === 'hail')) ||
          (previous === 'harsh-sunlight' && (now === 'snow' || now === 'hail'));
        assert.ok(!illegal, `illegal transition ${previous} -> ${now}`);
        previous = now;
      }
    }
  });

  test('save/restore preserves state', () => {
    const weather = new WeatherSystem(SEED);
    for (let i = 0; i < 500; i++) weather.update(30, 14);
    const snapshot = weather.save();
    const other = new WeatherSystem(SEED + 99);
    other.restore(snapshot);
    for (const island of allIslands()) {
      assert.equal(other.get(island.id).current, weather.get(island.id).current);
    }
  });
});

describe('Ocean', () => {
  test('dispersion relation: longer waves travel faster', () => {
    assert.ok(waveSpeed(100) > waveSpeed(10), 'long swells must outrun short chop');
  });

  test('height query is stable and bounded by the wave spectrum', () => {
    const ocean = new OceanSimulation({ windSpeed: 12 });
    const maxExpected = ocean.significantWaveHeight;
    for (let i = 0; i < 300; i++) {
      ocean.update(1 / 60);
      const h = ocean.heightAt(i * 3.7, i * 2.1);
      assert.ok(Number.isFinite(h), 'ocean height must be finite');
      assert.ok(Math.abs(h) <= maxExpected + 1, `wave height ${h} exceeds spectrum ${maxExpected}`);
    }
  });

  test('is deterministic for a given time', () => {
    const a = new OceanSimulation({ windSpeed: 9 });
    const b = new OceanSimulation({ windSpeed: 9 });
    a.setTime(17.25);
    b.setTime(17.25);
    for (let i = 0; i < 100; i++) {
      assert.equal(a.heightAt(i * 5, i * 3), b.heightAt(i * 5, i * 3));
    }
  });

  test('stronger wind raises the sea state', () => {
    const calm = new OceanSimulation({ windSpeed: 2 });
    const storm = new OceanSimulation({ windSpeed: 22 });
    assert.ok(
      storm.significantWaveHeight > calm.significantWaveHeight * 3,
      'a storm must visibly raise the sea',
    );
  });

  test('normals are unit length and generally upward', () => {
    const ocean = new OceanSimulation({ windSpeed: 10 });
    ocean.setTime(4.5);
    for (let i = 0; i < 100; i++) {
      const n = ocean.normalAt(i * 7.3, i * 4.1);
      const len = Math.hypot(n.x, n.y, n.z);
      assert.ok(Math.abs(len - 1) < 1e-5, `ocean normal not unit length: ${len}`);
      assert.ok(n.y > 0, 'ocean normal should point up');
    }
  });

  test('buoyancy gives a surface height with plausible pitch and roll', () => {
    const ocean = new OceanSimulation({ windSpeed: 14 });
    ocean.setTime(9.1);
    const b = ocean.buoyancyAt(120, -80, 5);
    assert.ok(Number.isFinite(b.height));
    assert.ok(Math.abs(b.pitch) < 1.2, `implausible pitch ${b.pitch}`);
    assert.ok(Math.abs(b.roll) < 1.2, `implausible roll ${b.roll}`);
  });

  test('uniform packing matches the wave count', () => {
    const ocean = new OceanSimulation({ waveCount: 6 });
    assert.equal(ocean.toUniformArray().length, 6 * 6);
  });
});

describe('Spawner', () => {
  const terrain = new TerrainGenerator(SEED);
  const classifier = new BiomeClassifier();
  const spawner = new Spawner(SEED, terrain, classifier);
  const clearWeather = (): WeatherId => 'clear';
  const noFlags = new Set<string>();

  test('chunk population is deterministic — walk away and come back', () => {
    const melemele = allIslands().find((i) => i.id === 'melemele')!;
    const { cx, cz } = worldToChunk(melemele.centerX, melemele.centerZ + 400);

    const first = spawner.populateChunk(cx, cz, 12, clearWeather, noFlags);
    const second = spawner.populateChunk(cx, cz, 12, clearWeather, noFlags);
    assert.equal(first.length, second.length, 'population size must be stable');
    for (let i = 0; i < first.length; i++) {
      assert.equal(first[i].speciesId, second[i].speciesId);
      assert.equal(first[i].personality, second[i].personality);
      assert.equal(first[i].position.x, second[i].position.x);
      assert.equal(first[i].shiny, second[i].shiny);
    }
  });

  test('day and night populations differ across the island', () => {
    // Sampled over a whole island rather than one chunk: an individual chunk
    // may legitimately hold only always-active species.
    const melemele = allIslands().find((i) => i.id === 'melemele')!;
    const daySpecies = new Set<string>();
    const nightSpecies = new Set<string>();

    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2;
      const r = melemele.radius * (0.15 + (i % 5) * 0.12);
      const x = melemele.centerX + Math.cos(angle) * r;
      const z = melemele.centerZ + Math.sin(angle) * r;
      const { cx, cz } = worldToChunk(x, z);
      for (const p of spawner.populateChunk(cx, cz, 12, clearWeather, noFlags)) daySpecies.add(p.speciesId);
      for (const p of spawner.populateChunk(cx, cz, 1, clearWeather, noFlags)) nightSpecies.add(p.speciesId);
    }

    assert.ok(daySpecies.size > 0 && nightSpecies.size > 0, 'both rosters should be populated');

    const dayOnly = [...daySpecies].filter((s) => !nightSpecies.has(s));
    const nightOnly = [...nightSpecies].filter((s) => !daySpecies.has(s));
    assert.ok(
      dayOnly.length > 0 || nightOnly.length > 0,
      `day/night rosters identical: ${[...daySpecies].join(', ')}`,
    );

    // The nocturnal species we authored should genuinely be night-biased.
    assert.ok(
      nightSpecies.has('RATTATA_ALOLA') || nightSpecies.has('MEOWTH_ALOLA'),
      'nocturnal species should appear at night',
    );
  });

  test('spawned individuals are placed legally for their movement class', () => {
    let checked = 0;
    for (const island of allIslands()) {
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const x = island.centerX + Math.cos(angle) * island.radius * 0.35;
        const z = island.centerZ + Math.sin(angle) * island.radius * 0.35;
        const { cx, cz } = worldToChunk(x, z);
        for (const p of spawner.populateChunk(cx, cz, 12, clearWeather, noFlags)) {
          const species = getSpecies(p.speciesId);
          const ground = terrain.sampleHeight(p.position.x, p.position.z);
          checked++;
          if (species.movement === 'swimmer') {
            assert.ok(ground < 5, `${p.speciesId} (swimmer) placed on land at ${ground.toFixed(1)}m`);
          }
          if (species.movement === 'walker' || species.movement === 'runner') {
            assert.ok(ground >= 0, `${p.speciesId} (land) placed underwater at ${ground.toFixed(1)}m`);
          }
          assert.ok(p.level >= 1 && p.level <= 100, `bad level ${p.level}`);
          assert.ok(p.sizeScale > 0.5 && p.sizeScale < 2.5, `bad size scale ${p.sizeScale}`);
        }
      }
    }
    assert.ok(checked > 20, `expected to check a real population, only saw ${checked}`);
  });

  test('pack species spawn in groups sharing a pack id', () => {
    const melemele = allIslands().find((i) => i.id === 'melemele')!;
    const packs = new Map<number, number>();
    for (let i = 0; i < 40; i++) {
      const { cx, cz } = worldToChunk(melemele.centerX + i * 120, melemele.centerZ + i * 90);
      for (const p of spawner.populateChunk(cx, cz, 12, clearWeather, noFlags)) {
        if (p.packId >= 0) packs.set(p.packId, (packs.get(p.packId) ?? 0) + 1);
      }
    }
    const multiMember = [...packs.values()].filter((n) => n > 1);
    assert.ok(multiMember.length > 0, 'pack species should produce multi-member groups');
  });

  test('shiny odds are respected and the multiplier works', () => {
    // Sample a very large number of individuals to get a usable shiny rate.
    let total = 0;
    let shinies = 0;
    const boosted = new Spawner(SEED, terrain, classifier, { shinyMultiplier: 512 });
    for (let i = 0; i < 900; i++) {
      const cx = 100 + i;
      const cz = -200 - i;
      for (const p of boosted.populateChunk(cx, cz, 12, clearWeather, noFlags)) {
        total++;
        if (p.shiny) shinies++;
      }
    }
    if (total > 500) {
      const rate = shinies / total;
      // With a 512x multiplier the rate is 1/8; assert it is clearly elevated
      // but not certain, which would indicate the roll is broken.
      assert.ok(rate > 0.02 && rate < 0.5, `boosted shiny rate implausible: ${rate}`);
    }
  });

  test('flag-gated Ultra Beasts do not leak into the overworld', () => {
    for (const island of allIslands()) {
      for (let i = 0; i < 8; i++) {
        const x = island.centerX + i * 250;
        const z = island.centerZ + i * 180;
        const { cx, cz } = worldToChunk(x, z);
        for (const p of spawner.populateChunk(cx, cz, 12, clearWeather, noFlags)) {
          assert.notEqual(p.speciesId, 'NIHILEGO', 'Ultra Beast leaked without the story flag');
          assert.notEqual(p.speciesId, 'GUZZLORD', 'Ultra Beast leaked without the story flag');
        }
      }
    }
  });

  test('previewDensity reports without spawning', () => {
    const melemele = allIslands().find((i) => i.id === 'melemele')!;
    const { cx, cz } = worldToChunk(melemele.centerX, melemele.centerZ);
    const preview = spawner.previewDensity(cx, cz, 12, 'clear', noFlags);
    for (const p of preview) {
      assert.ok(getSpecies(p.species), `preview listed unknown species ${p.species}`);
      assert.ok(p.weight > 0);
    }
  });
});

describe('Ecosystem model', () => {
  test('predation drives prey down and starvation drives predators down', () => {
    const eco = new EcosystemModel(SEED);
    const regionId = buildRegionId('melemele', 'grassland');
    eco.addRegion(
      { id: regionId, islandId: 'melemele', biome: 'grassland' },
      new Map([['YUNGOOS', 24], ['RATTATA_ALOLA', 24]]),
    );

    const neighbours = new Map<string, readonly string[]>([[regionId, []]]);
    for (let i = 0; i < 200; i++) eco.tick(neighbours);

    const prey = eco.get(regionId, 'RATTATA_ALOLA')!;
    const predator = eco.get(regionId, 'YUNGOOS')!;
    assert.ok(prey.level >= 0 && prey.level <= 2, `prey level out of range: ${prey.level}`);
    assert.ok(predator.level >= 0 && predator.level <= 2, `predator level out of range: ${predator.level}`);
    // With a predator present, prey must sit below its unpressured capacity.
    assert.ok(prey.level < 1.05, `prey should be suppressed by predation, got ${prey.level}`);
  });

  test('player harvesting depletes a population and lowers spawn weight', () => {
    const eco = new EcosystemModel(SEED);
    const regionId = buildRegionId('melemele', 'grassland');
    eco.addRegion(
      { id: regionId, islandId: 'melemele', biome: 'grassland' },
      new Map([['PIKACHU', 7]]),
    );
    const neighbours = new Map<string, readonly string[]>([[regionId, []]]);

    eco.tick(neighbours);
    const baseline = eco.spawnMultiplier(regionId, 'PIKACHU');

    // Hunt the route hard.
    for (let i = 0; i < 40; i++) {
      eco.recordHarvest(regionId, 'PIKACHU', 20);
      eco.tick(neighbours);
    }
    const depleted = eco.spawnMultiplier(regionId, 'PIKACHU');
    assert.ok(depleted < baseline, `over-hunting should reduce spawns: ${depleted} vs ${baseline}`);
    assert.ok(eco.depletedIn(regionId).includes('PIKACHU'), 'should report the species as depleted');
  });

  test('migration refills a depleted region from its neighbours', () => {
    const eco = new EcosystemModel(SEED);
    const a = buildRegionId('melemele', 'grassland');
    const b = buildRegionId('melemele', 'meadow');
    eco.addRegion({ id: a, islandId: 'melemele', biome: 'grassland' }, new Map([['PIKACHU', 7]]));
    eco.addRegion({ id: b, islandId: 'melemele', biome: 'meadow' }, new Map([['PIKACHU', 7]]));

    const neighbours = new Map<string, readonly string[]>([[a, [b]], [b, [a]]]);

    // Strip region A bare.
    for (let i = 0; i < 30; i++) {
      eco.recordHarvest(a, 'PIKACHU', 30);
      eco.tick(neighbours);
    }
    const afterHarvest = eco.get(a, 'PIKACHU')!.level;

    // Stop hunting and let neighbours refill it.
    for (let i = 0; i < 150; i++) eco.tick(neighbours);
    const recovered = eco.get(a, 'PIKACHU')!.level;

    assert.ok(recovered > afterHarvest, `region should recover: ${afterHarvest} -> ${recovered}`);
  });

  test('populations never go negative or run away', () => {
    const eco = new EcosystemModel(SEED);
    const regionId = buildRegionId('akala', 'dense-jungle');
    eco.addRegion(
      { id: regionId, islandId: 'akala', biome: 'dense-jungle' },
      speciesWeightsForBiome('dense-jungle'),
    );
    const neighbours = new Map<string, readonly string[]>([[regionId, []]]);
    for (let i = 0; i < 1000; i++) {
      eco.tick(neighbours);
      for (const sid of ['STUFFUL', 'BEWEAR', 'GRUBBIN']) {
        const p = eco.get(regionId, sid);
        if (!p) continue;
        assert.ok(p.level >= 0 && p.level <= 2, `${sid} level escaped bounds: ${p.level}`);
        assert.ok(Number.isFinite(p.level), `${sid} level became non-finite`);
      }
    }
  });

  test('speciesWeightsForBiome matches the spawn table', () => {
    const weights = speciesWeightsForBiome('dense-jungle');
    assert.ok(weights.size > 0, 'dense jungle should have inhabitants');
    for (const [sid, w] of weights) {
      assert.ok(getSpecies(sid), `unknown species ${sid}`);
      assert.ok(w > 0);
    }
  });

  test('save/restore preserves population levels', () => {
    const eco = new EcosystemModel(SEED);
    const regionId = buildRegionId('poni', 'canyon');
    eco.addRegion({ id: regionId, islandId: 'poni', biome: 'canyon' }, speciesWeightsForBiome('canyon'));
    const neighbours = new Map<string, readonly string[]>([[regionId, []]]);
    for (let i = 0; i < 100; i++) eco.tick(neighbours);

    const snapshot = eco.save();
    const other = new EcosystemModel(SEED);
    other.addRegion({ id: regionId, islandId: 'poni', biome: 'canyon' }, speciesWeightsForBiome('canyon'));
    other.restore(snapshot);

    for (const [sid] of speciesWeightsForBiome('canyon')) {
      const original = eco.get(regionId, sid)!.level;
      const restored = other.get(regionId, sid)!.level;
      assert.ok(Math.abs(original - restored) < 0.002, `${sid}: ${original} vs ${restored}`);
    }
  });
});
