/**
 * Terrain chunk meshing — the geometry half.
 *
 * Wraps the arrays from `buildTerrainArrays` in a BufferGeometry. Kept separate
 * so the expensive half (sampling the terrain for every vertex) can run on a
 * Worker, and only this cheap half touches Three.js on the main thread.
 */
import { BufferGeometry, BufferAttribute, Sphere, Vector3 } from 'three';
import { CHUNK_SIZE, LOD_RESOLUTIONS, type TerrainGenerator, type BiomeClassifier } from '@alola/world';
import type { BiomeId } from '@alola/data';
import { buildTerrainArrays, biomeIndex, type MeshOptions, type TerrainMeshArrays } from './terrain-arrays.ts';

export { biomeIndex, buildTerrainArrays, type MeshOptions, type TerrainMeshArrays };

export interface TerrainMeshResult {
  readonly geometry: BufferGeometry;
  /** Lowest and highest vertex, for culling and for water-plane clipping. */
  readonly minHeight: number;
  readonly maxHeight: number;
  /** Biome ids present in this chunk, dominant first. */
  readonly biomes: BiomeId[];
  /** Vertex count, for the statistics overlay. */
  readonly vertexCount: number;
}

/** Wrap prebuilt arrays in a geometry. No per-vertex work happens here. */
export function geometryFromArrays(arrays: TerrainMeshArrays): TerrainMeshResult {
  // `BufferAttribute`, not `Float32BufferAttribute`: the latter's constructor
  // wraps its input in `new Float32Array(array)`, which copies. For a result
  // that has just been transferred from a Worker precisely to avoid a copy,
  // that put ~1.5 MB of memcpy per LOD0 chunk back on the main thread.
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(arrays.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(arrays.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(arrays.uvs, 2));
  geometry.setAttribute('color', new BufferAttribute(arrays.colors, 3));
  geometry.setAttribute('biomeWeight', new BufferAttribute(arrays.biomeWeights, 4));
  geometry.setAttribute('biomeIndex', new BufferAttribute(arrays.biomeIndices, 4));
  geometry.setIndex(new BufferAttribute(arrays.indices, 1));

  // Explicit bounds: computing them would re-read every vertex, and we already
  // know the extents from the build.
  const halfSize = CHUNK_SIZE / 2;
  const centerY = (arrays.minHeight + arrays.maxHeight) / 2;
  const radius = Math.sqrt(
    halfSize * halfSize * 2 + Math.pow((arrays.maxHeight - arrays.minHeight) / 2 + arrays.skirtDepth, 2),
  );
  geometry.boundingSphere = new Sphere(new Vector3(halfSize, centerY, halfSize), radius);

  return {
    geometry,
    minHeight: arrays.minHeight,
    maxHeight: arrays.maxHeight,
    biomes: arrays.biomes,
    vertexCount: arrays.vertexCount,
  };
}

/**
 * Build a chunk mesh synchronously.
 *
 * The client runs `buildTerrainArrays` on a Worker pool and calls
 * `geometryFromArrays` with the result; this synchronous composition remains
 * for tests, tools, and as the fallback when Workers are unavailable.
 */
export function buildTerrainMesh(
  terrain: TerrainGenerator,
  classifier: BiomeClassifier,
  cx: number,
  cz: number,
  lod: number,
  opts: MeshOptions = {},
): TerrainMeshResult {
  return geometryFromArrays(buildTerrainArrays(terrain, classifier, cx, cz, lod, opts));
}

/** Triangle count for a LOD, for the budget planner and the stats overlay. */
export function triangleCountForLod(lod: number): number {
  const resolution = LOD_RESOLUTIONS[Math.min(lod, LOD_RESOLUTIONS.length - 1)];
  return resolution * resolution * 2 + resolution * 4 * 2;
}
