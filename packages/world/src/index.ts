/**
 * @alola/world — terrain, streaming, climate and ecology simulation.
 *
 * Headless by construction: no rendering, no DOM. The client builds meshes from
 * what this package computes; the server runs the identical code to stay
 * authoritative over where the ground is and what lives on it.
 */
export {
  TerrainGenerator,
  TERRAIN_TUNING,
  SEA_LEVEL,
} from './terrain/generator.ts';
export type { TerrainSample } from './terrain/generator.ts';

export { BiomeClassifier } from './biome/classifier.ts';
export type { BiomeClassification } from './biome/classifier.ts';

export {
  ChunkStreamer,
  BUILD_PENDING,
  ChunkState,
  CHUNK_SIZE,
  LOD_RESOLUTIONS,
  LOD_RADII,
  MAX_LOD,
  STREAMING_RADIUS,
  FAR_TERRAIN_RADIUS,
  chunkKey,
  chunkCoordX,
  chunkCoordZ,
  worldToChunk,
  chunkCenter,
} from './streaming/chunks.ts';
export type { ChunkRecord, ChunkKey, StreamingStats, StreamerOptions } from './streaming/chunks.ts';

export { TimeOfDay, ambientColorFor } from './timeofday/cycle.ts';
export type { CelestialState, TimeOfDayOptions } from './timeofday/cycle.ts';

export { WeatherSystem, WEATHER_PROFILES } from './weather/system.ts';
export type { WeatherProfile, IslandWeather, WeatherOptions } from './weather/system.ts';

export { OceanSimulation, waveSpeed } from './ocean/gerstner.ts';
export type { GerstnerWave, OceanOptions } from './ocean/gerstner.ts';

export { Spawner, SHINY_BASE_ODDS } from './ecology/spawner.ts';
export type { SpawnedPokemon, SpawnerOptions } from './ecology/spawner.ts';

export {
  EcosystemModel,
  buildRegionId,
  speciesWeightsForBiome,
  buildRegionsForIsland,
} from './ecology/population.ts';
export type { PopulationRegion, SpeciesPopulation, EcosystemOptions } from './ecology/population.ts';
