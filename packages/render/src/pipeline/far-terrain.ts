/**
 * Far terrain.
 *
 * Everything beyond the chunk-streaming radius is drawn as one coarse mesh per
 * island rather than as streamed chunks.
 *
 * This exists because of a measurement, not a hunch. Profiling the headless
 * simulation showed that extending chunk streaming to the visible horizon put
 * roughly 2,450 of ~3,070 loaded chunks — 80% of all streaming cost — into the
 * outermost ring, rendering terrain that occupies a few pixels. Ring area grows
 * with the square of its radius, so that is inherent to chunked streaming and
 * cannot be tuned away.
 *
 * A far mesh is built once per island at startup, never streams, and never
 * changes. Five draw calls cover the whole archipelago. The player still sees
 * Akala's volcano from Melemele's beach; it simply costs almost nothing.
 *
 * The resolution is chosen so that a vertex lands roughly every 64m, which at
 * 4km+ is well under a pixel of error and completely invisible at the seam.
 */
import { BufferGeometry, BufferAttribute, Float32BufferAttribute, Sphere, Vector3 } from 'three';
import { STREAMING_RADIUS, type TerrainGenerator, type BiomeClassifier } from '@alola/world';
import { allIslands, type IslandDefinition } from '@alola/data';
import { biomeIndex } from './terrain-mesh.ts';
import { writeGroundColor } from './terrain-arrays.ts';

/** Metres between far-terrain vertices. */
export const FAR_VERTEX_SPACING = 64;

export interface FarTerrainMesh {
  readonly islandId: string;
  readonly geometry: BufferGeometry;
  /** World-space origin the mesh should be positioned at. */
  readonly originX: number;
  readonly originZ: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/**
 * Build the coarse mesh for one island.
 *
 * The mesh covers a square around the island large enough to include its
 * shoreline and a margin of seafloor, so the coastline silhouette — the part
 * the player actually recognises from a distance — is correct.
 */
export function buildFarTerrain(
  terrain: TerrainGenerator,
  classifier: BiomeClassifier,
  island: IslandDefinition,
): FarTerrainMesh {
  // Cover the island plus a shoreline margin.
  const extent = island.radius * 1.25;
  const resolution = Math.max(8, Math.ceil((extent * 2) / FAR_VERTEX_SPACING));
  const step = (extent * 2) / resolution;

  const originX = island.centerX - extent;
  const originZ = island.centerZ - extent;

  const vertexCount = (resolution + 1) * (resolution + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const biomeWeights = new Float32Array(vertexCount * 4);
  const biomeIndices = new Float32Array(vertexCount * 4);

  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let iz = 0; iz <= resolution; iz++) {
    for (let ix = 0; ix <= resolution; ix++) {
      const vi = iz * (resolution + 1) + ix;
      const x = originX + ix * step;
      const z = originZ + iz * step;

      const sample = terrain.sample(x, z);
      const classification = classifier.classify(sample);

      const o3 = vi * 3;
      positions[o3] = x - originX;
      positions[o3 + 1] = sample.height;
      positions[o3 + 2] = z - originZ;

      normals[o3] = sample.normalX;
      normals[o3 + 1] = sample.normalY;
      normals[o3 + 2] = sample.normalZ;

      writeGroundColor(colors, o3, classification, sample.normalY, sample.height);

      const o2 = vi * 2;
      uvs[o2] = ix / resolution;
      uvs[o2 + 1] = iz / resolution;

      // Far terrain uses a single flat biome weight: at this distance the
      // splat detail is invisible, and blending two layers would double the
      // texture cost for nothing.
      const o4 = vi * 4;
      const primary = biomeIndex(classification.biome.id);
      biomeIndices[o4] = primary;
      biomeIndices[o4 + 1] = primary;
      biomeIndices[o4 + 2] = primary;
      biomeIndices[o4 + 3] = primary;
      biomeWeights[o4] = 1;

      if (sample.height < minHeight) minHeight = sample.height;
      if (sample.height > maxHeight) maxHeight = sample.height;
    }
  }

  const triangleCount = resolution * resolution * 2;
  const indices = vertexCount > 65535
    ? new Uint32Array(triangleCount * 3)
    : new Uint16Array(triangleCount * 3);

  let idx = 0;
  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const a = iz * (resolution + 1) + ix;
      const b = a + 1;
      const c = a + (resolution + 1);
      const d = c + 1;
      indices[idx++] = a;
      indices[idx++] = c;
      indices[idx++] = b;
      indices[idx++] = b;
      indices[idx++] = c;
      indices[idx++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('biomeWeight', new Float32BufferAttribute(biomeWeights, 4));
  geometry.setAttribute('biomeIndex', new Float32BufferAttribute(biomeIndices, 4));
  geometry.setIndex(new BufferAttribute(indices, 1));

  geometry.boundingSphere = new Sphere(
    new Vector3(extent, (minHeight + maxHeight) / 2, extent),
    Math.sqrt(extent * extent * 2 + Math.pow((maxHeight - minHeight) / 2, 2)),
  );

  return {
    islandId: island.id,
    geometry,
    originX,
    originZ,
    vertexCount,
    triangleCount,
  };
}

/** Build far terrain for the whole archipelago. Called once, at load. */
export function buildAllFarTerrain(
  terrain: TerrainGenerator,
  classifier: BiomeClassifier,
): FarTerrainMesh[] {
  return allIslands().map((island) => buildFarTerrain(terrain, classifier, island));
}

/**
 * Should an island's far mesh be drawn?
 *
 * Hidden when the camera is inside the streaming radius of that island, since
 * streamed chunks already cover it and drawing both would z-fight. A small
 * overlap margin keeps the handover seamless.
 */
export function shouldDrawFarTerrain(
  cameraX: number,
  cameraZ: number,
  island: IslandDefinition,
  overlapMargin = 400,
): boolean {
  const distanceToCentre = Math.hypot(cameraX - island.centerX, cameraZ - island.centerZ);
  // The player is "on" this island's streamed terrain when they are within the
  // island plus the streaming radius.
  const streamedExtent = island.radius + STREAMING_RADIUS - overlapMargin;
  return distanceToCentre > streamedExtent;
}

/** Total far-terrain budget, for the statistics overlay. */
export function farTerrainBudget(meshes: readonly FarTerrainMesh[]): {
  drawCalls: number;
  vertices: number;
  triangles: number;
} {
  let vertices = 0;
  let triangles = 0;
  for (const mesh of meshes) {
    vertices += mesh.vertexCount;
    triangles += mesh.triangleCount;
  }
  return { drawCalls: meshes.length, vertices, triangles };
}
