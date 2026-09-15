/** @alola/render — Three.js presentation layer. */
export { buildTerrainMesh, triangleCountForLod, biomeIndex } from './pipeline/terrain-mesh.ts';
export type { TerrainMeshResult, MeshOptions } from './pipeline/terrain-mesh.ts';

export {
  buildFarTerrain, buildAllFarTerrain, shouldDrawFarTerrain,
  farTerrainBudget, FAR_VERTEX_SPACING,
} from './pipeline/far-terrain.ts';
export type { FarTerrainMesh } from './pipeline/far-terrain.ts';

export {
  TERRAIN_VERTEX_SHADER, TERRAIN_FRAGMENT_SHADER, defaultTerrainUniforms,
} from './shaders/terrain.glsl.ts';
export {
  OCEAN_VERTEX_SHADER, OCEAN_FRAGMENT_SHADER, defaultOceanUniforms, MAX_OCEAN_WAVES,
} from './shaders/ocean.glsl.ts';
export {
  SKY_VERTEX_SHADER, SKY_FRAGMENT_SHADER, defaultSkyUniforms,
} from './shaders/sky.glsl.ts';

export {
  scatterFoliage, InstanceBatch, instanceBudgetFor, selectForBudget, cullInstances,
} from './instancing/scatter.ts';
export type { ScatterInstance, ScatterOptions } from './instancing/scatter.ts';

export {
  QUALITY_PRESETS, QUALITY_ORDER, AdaptiveQuality,
  detectQuality, isSoftwareRenderer, readRendererString,
} from './pipeline/quality.ts';
export type { QualityLevel, QualityPreset } from './pipeline/quality.ts';

export { CameraRig, CAMERA_MODES, frameBattle } from './camera/rig.ts';
export type { CameraMode, CameraModeConfig, SphereCast, ShakeImpulse } from './camera/rig.ts';
