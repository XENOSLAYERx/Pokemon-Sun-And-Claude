/**
 * Headless world simulation harness.
 *
 * Boots the entire simulation stack — terrain, streaming, weather, time,
 * spawning, ecology and Pokémon AI — with no renderer, and runs it for a
 * configurable number of in-game hours.
 *
 * This is the most valuable tool in the project. It lets us answer questions
 * that are otherwise unanswerable without a full build and hours of play:
 *   - Does the ecosystem stabilise, or does everything starve by day 3?
 *   - How much does a chunk cost to stream at each LOD?
 *   - Does the AI deadlock, or produce a plausible spread of behaviours?
 *   - Do any of these systems leak memory or drift into NaN over time?
 *
 * Run: npm run sim -- --hours 24 --agents 400
 */
import { SpatialHash, FixedClock, vec3 } from '@alola/core';
import {
  TerrainGenerator, BiomeClassifier, ChunkStreamer, TimeOfDay, WeatherSystem,
  OceanSimulation, Spawner, EcosystemModel, buildRegionId, speciesWeightsForBiome,
  worldToChunk, CHUNK_SIZE,
} from '@alola/world';
import { allIslands, getSpecies, type BiomeId, type WeatherId } from '@alola/data';
import {
  PokemonBrain, BrainLod, lodForDistance, visibilityFrom,
  type BrainState, type BrainWorldView, type PerceivableAgent,
} from '@alola/ai';

interface SimOptions {
  seed: number;
  hours: number;
  agentCap: number;
  verbose: boolean;
}

function parseArgs(argv: readonly string[]): SimOptions {
  const opts: SimOptions = { seed: 20251115, hours: 24, agentCap: 400, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seed') opts.seed = Number(argv[++i]);
    else if (arg === '--hours') opts.hours = Number(argv[++i]);
    else if (arg === '--agents') opts.agentCap = Number(argv[++i]);
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
  }
  return opts;
}

function bar(value: number, max: number, width = 24): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║          PROJECT ALOLA — headless world simulation           ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  seed ${opts.seed}   duration ${opts.hours}h in-game   agent cap ${opts.agentCap}`);
  console.log('');

  // ---------------------------------------------------------------- boot
  const bootStart = performance.now();

  const terrain = new TerrainGenerator(opts.seed);
  const classifier = new BiomeClassifier();
  const timeOfDay = new TimeOfDay({ secondsPerDay: 72 * 60, startHour: 6 });
  const weather = new WeatherSystem(opts.seed);
  const ocean = new OceanSimulation({ windSpeed: 8 });
  const spawner = new Spawner(opts.seed, terrain, classifier);
  const ecology = new EcosystemModel(opts.seed);
  const streamer = new ChunkStreamer({ buildsPerTick: 4 });

  // Seed the ecosystem with one region per (island, biome) that can hold life.
  const regionNeighbours = new Map<string, string[]>();
  let regionCount = 0;
  for (const island of allIslands()) {
    const islandRegions: string[] = [];
    const biomes: BiomeId[] = [
      'tropical-forest', 'grassland', 'beach', 'dense-jungle', 'meadow',
      'ocean', 'reef', 'cave', 'canyon', 'volcanic-slope', 'desert', 'snowfield',
    ];
    for (const biome of biomes) {
      const weights = speciesWeightsForBiome(biome);
      if (weights.size === 0) continue;
      const id = buildRegionId(island.id, biome);
      ecology.addRegion({ id, islandId: island.id, biome }, weights);
      islandRegions.push(id);
      regionCount++;
    }
    // Every biome on an island is a migration neighbour of every other.
    for (const id of islandRegions) {
      regionNeighbours.set(id, islandRegions.filter((other) => other !== id));
    }
  }

  const bootMs = performance.now() - bootStart;
  console.log(`  ▸ boot: ${regionCount} ecology regions in ${bootMs.toFixed(1)}ms`);

  // ------------------------------------------------------- observer + agents
  // Park the observer on Melemele and walk it in a slow circle, so streaming
  // and LOD are genuinely exercised rather than sitting still.
  const melemele = allIslands().find((i) => i.id === 'melemele')!;
  const observer = vec3(melemele.centerX, 0, melemele.centerZ);
  observer.y = terrain.sampleHeight(observer.x, observer.z);

  const grid = new SpatialHash<PerceivableAgent>(16);
  const brains: PokemonBrain[] = [];
  let nextAgentId = 1;

  const groundAt = (x: number, z: number): number => terrain.sampleHeight(x, z);

  const spawnAround = (): number => {
    if (brains.length >= opts.agentCap) return 0;
    const { cx, cz } = worldToChunk(observer.x, observer.z);
    let spawned = 0;

    for (let dz = -2; dz <= 2 && brains.length < opts.agentCap; dz++) {
      for (let dx = -2; dx <= 2 && brains.length < opts.agentCap; dx++) {
        const population = spawner.populateChunk(
          cx + dx,
          cz + dz,
          timeOfDay.hour,
          (islandId) => weather.weatherIdFor(islandId ?? 'melemele') as WeatherId,
          new Set<string>(),
        );
        for (const p of population) {
          if (brains.length >= opts.agentCap) break;
          const species = getSpecies(p.speciesId);
          const state: BrainState = {
            id: nextAgentId++,
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
          brains.push(new PokemonBrain(state, opts.seed ^ state.id));
          void species;
          spawned++;
        }
      }
    }
    return spawned;
  };

  const initialSpawn = spawnAround();
  console.log(`  ▸ spawned ${initialSpawn} Pokémon around the observer`);
  console.log('');

  // ------------------------------------------------------------------ run
  const clock = new FixedClock({ tickRate: 30 });
  const inGameSecondsPerRealSecond = (24 * 3600) / (72 * 60);
  const totalInGameSeconds = opts.hours * 3600;
  const totalTicks = Math.ceil(totalInGameSeconds / inGameSecondsPerRealSecond * 30);

  const dt = 1 / 30;
  let tick = 0;
  let simTime = 0;

  // Metrics.
  const goalCounts = new Map<string, number>();
  const lodCounts = [0, 0, 0, 0];
  let chunksBuilt = 0;
  let peakBrainMs = 0;
  let totalBrainMs = 0;
  let brainSamples = 0;
  const weatherSeen = new Set<string>();
  let nanDetected = 0;

  const runStart = performance.now();
  const reportEvery = Math.max(1, Math.floor(totalTicks / 12));

  while (tick < totalTicks) {
    tick++;
    simTime += dt;

    // --- Environment.
    const inGameDelta = dt * inGameSecondsPerRealSecond;
    timeOfDay.update(inGameDelta);
    weather.update(inGameDelta, timeOfDay.hour);
    ocean.update(dt);
    weatherSeen.add(weather.weatherIdFor('melemele'));

    const islandWeather = weather.get('melemele');
    ocean.setWind(islandWeather.windDirection, islandWeather.windSpeed);

    // --- Observer walks a slow circle of radius 400m.
    const angle = (simTime / 240) * Math.PI * 2;
    observer.x = melemele.centerX + Math.cos(angle) * 400;
    observer.z = melemele.centerZ + Math.sin(angle) * 400;
    observer.y = terrain.sampleHeight(observer.x, observer.z);

    // --- Streaming.
    streamer.setObservers([{ x: observer.x, z: observer.z }]);
    streamer.update(simTime, () => { chunksBuilt++; return {}; }, () => {});

    // --- Rebuild the perception grid.
    grid.rebuild(
      brains.map((b) => ({
        id: b.state.id,
        position: b.state.position,
        speciesId: b.state.speciesId,
        packId: b.state.packId,
        playerId: null,
        noise: 0.4,
        inactive: false,
        level: b.state.level,
      })),
    );

    const visibility = visibilityFrom(islandWeather.fogDensity, timeOfDay.state.daylight, false);
    const worldView: BrainWorldView = {
      hour: timeOfDay.hour,
      daylight: timeOfDay.state.daylight,
      visibility,
      now: simTime,
      grid,
      groundAt,
    };

    // --- AI.
    const brainStart = performance.now();
    for (const brain of brains) {
      const distance = Math.hypot(
        brain.state.position.x - observer.x,
        brain.state.position.z - observer.z,
      );
      brain.state.lod = lodForDistance(distance);
      brain.update(dt, worldView);

      if (!Number.isFinite(brain.state.position.x) || !Number.isFinite(brain.state.position.z)) {
        nanDetected++;
      }
    }
    const brainMs = performance.now() - brainStart;
    totalBrainMs += brainMs;
    brainSamples++;
    if (brainMs > peakBrainMs) peakBrainMs = brainMs;

    // --- Ecology, on a slow tick (every in-game ~10 minutes).
    if (tick % 300 === 0) {
      ecology.tick(regionNeighbours);
    }

    // --- Sample metrics.
    if (tick % 30 === 0) {
      for (const brain of brains) {
        const goal = brain.currentGoal ?? 'none';
        goalCounts.set(goal, (goalCounts.get(goal) ?? 0) + 1);
        lodCounts[brain.state.lod]++;
      }
    }

    // --- Progress report.
    if (tick % reportEvery === 0 || tick === totalTicks) {
      const pct = (tick / totalTicks) * 100;
      const w = weather.get('melemele');
      const hour = timeOfDay.hour;
      const timeLabel = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
      if (opts.verbose || tick === totalTicks || tick % (reportEvery * 3) === 0) {
        console.log(
          `  ${bar(pct, 100)} ${pct.toFixed(0).padStart(3)}%  ` +
          `day ${timeOfDay.day} ${timeLabel}  ` +
          `${w.current.padEnd(14)} ` +
          `sea ${ocean.significantWaveHeight.toFixed(2)}m  ` +
          `chunks ${String(streamer.stats.loaded).padStart(3)}`,
        );
      }
    }
  }

  const runMs = performance.now() - runStart;

  // -------------------------------------------------------------- report
  console.log('');
  console.log('  ────────────────────────────────────────────────────────────────');
  console.log('   RESULTS');
  console.log('  ────────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`   simulated        ${opts.hours}h in-game over ${totalTicks} ticks`);
  console.log(`   wall clock       ${(runMs / 1000).toFixed(2)}s  (${(totalTicks / (runMs / 1000)).toFixed(0)} ticks/s)`);
  console.log(`   agents           ${brains.length}`);
  console.log(`   chunks built     ${chunksBuilt}`);
  console.log(`   NaN positions    ${nanDetected}`);
  console.log('');

  console.log('   AI cost per tick');
  console.log(`     mean           ${(totalBrainMs / Math.max(1, brainSamples)).toFixed(3)}ms for ${brains.length} agents`);
  console.log(`     peak           ${peakBrainMs.toFixed(3)}ms`);
  const perAgentUs = (totalBrainMs / Math.max(1, brainSamples) / Math.max(1, brains.length)) * 1000;
  console.log(`     per agent      ${perAgentUs.toFixed(2)}µs`);
  console.log('');

  console.log('   Simulation LOD distribution');
  const lodTotal = lodCounts.reduce((a, b) => a + b, 0) || 1;
  const lodNames = ['Full', 'Reduced', 'Coarse', 'Dormant'];
  for (let i = 0; i < 4; i++) {
    const pct = (lodCounts[i] / lodTotal) * 100;
    console.log(`     ${lodNames[i].padEnd(9)} ${bar(pct, 100, 18)} ${pct.toFixed(1).padStart(5)}%`);
  }
  console.log('');

  console.log('   Pokémon behaviour distribution');
  const goalTotal = [...goalCounts.values()].reduce((a, b) => a + b, 0) || 1;
  const sortedGoals = [...goalCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [goal, count] of sortedGoals.slice(0, 10)) {
    const pct = (count / goalTotal) * 100;
    console.log(`     ${goal.padEnd(16)} ${bar(pct, 100, 18)} ${pct.toFixed(1).padStart(5)}%`);
  }
  console.log('');

  console.log(`   Weather observed  ${[...weatherSeen].join(', ')}`);
  console.log('');

  console.log('   Ecosystem health (Melemele grassland)');
  const region = buildRegionId('melemele', 'grassland');
  const weights = speciesWeightsForBiome('grassland');
  for (const [species] of weights) {
    const pop = ecology.get(region, species);
    if (!pop) continue;
    const trend = pop.trend > 0.001 ? '▲' : pop.trend < -0.001 ? '▼' : '─';
    console.log(
      `     ${species.padEnd(18)} ${bar(pop.level, 2, 18)} ${pop.level.toFixed(2)} ${trend}`,
    );
  }
  console.log('');

  // ------------------------------------------------------------ assertions
  const problems: string[] = [];
  if (nanDetected > 0) problems.push(`${nanDetected} agents reached a non-finite position`);
  if (chunksBuilt === 0) problems.push('no chunks were streamed');
  if (goalCounts.size < 3) problems.push('AI produced fewer than three distinct behaviours');
  if (weatherSeen.size < 2) problems.push('weather never changed');

  for (const [, pop] of Object.entries(ecology.save()[region] ?? {})) {
    if (!Number.isFinite(pop)) problems.push('an ecosystem population became non-finite');
  }

  if (problems.length > 0) {
    console.log('  ✗ PROBLEMS DETECTED');
    for (const problem of problems) console.log(`      • ${problem}`);
    console.log('');
    process.exitCode = 1;
  } else {
    console.log('  ✓ All systems stable. No NaN, no deadlock, no runaway populations.');
    console.log('');
  }
}

main().catch((error: unknown) => {
  console.error('Simulation failed:', error);
  process.exitCode = 1;
});
