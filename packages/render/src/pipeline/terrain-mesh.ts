/**
 * Terrain chunk meshing.
 *
 * Builds a Three.js BufferGeometry for one chunk at one LOD from the
 * deterministic terrain generator. Two details carry most of the weight:
 *
 * 1. **Skirts.** Adjacent chunks at different LODs have mismatched vertex
 *    densities along their shared edge, which leaves visible cracks you can
 *    see the sky through. Rather than stitching (which needs neighbour state
 *    and defeats independent chunk generation), each chunk extends a vertical
 *    skirt down from its border. The crack still exists; it is just hidden
 *    behind geometry, and it costs one extra ring of vertices.
 *
 * 2. **Vertex-baked biome weights.** Splat weights are computed per vertex on
 *    the CPU and written into a vertex attribute. The terrain shader blends up
 *    to four materials from them, which avoids a per-pixel biome classification
 *    that would be far more expensive and would not match the simulation.
 */
import {
  BufferGeometry, BufferAttribute, Float32BufferAttribute, Sphere, Vector3,
} from 'three';
import { CHUNK_SIZE, LOD_RESOLUTIONS, type TerrainGenerator, type BiomeClassifier } from '@alola/world';
import { BIOMES, type BiomeId } from '@alola/data';

/** Stable index for each biome, so the shader can look up its material. */
const BIOME_INDEX = new Map<BiomeId, number>(BIOMES.map((b, i) => [b.id, i]));

export function biomeIndex(id: BiomeId): number {
  return BIOME_INDEX.get(id) ?? 0;
}

export interface TerrainMeshResult {
  readonly geometry: BufferGeometry;
  /** Lowest and highest vertex, for culling and for water-plane clipping. */
  readonly minHeight: number;
  readonly maxHeight: number;
  /** Biome ids present in this chunk, for material selection and audio. */
  readonly biomes: BiomeId[];
  /** Vertex count, for the statistics overlay. */
  readonly vertexCount: number;
}

export interface MeshOptions {
  /** How far the skirt hangs below the terrain edge, in metres. */
  readonly skirtDepth?: number;
  /** Generate a second UV set for detail texturing. */
  readonly detailUvs?: boolean;
}

/**
 * Build a chunk mesh.
 *
 * Runs on a Worker in the real client. It is written to take only plain
 * numbers and the two generators so it can be transferred there without
 * carrying any scene state along.
 */
export function buildTerrainMesh(
  terrain: TerrainGenerator,
  classifier: BiomeClassifier,
  cx: number,
  cz: number,
  lod: number,
  opts: MeshOptions = {},
): TerrainMeshResult {
  const resolution = LOD_RESOLUTIONS[Math.min(lod, LOD_RESOLUTIONS.length - 1)];
  const skirtDepth = opts.skirtDepth ?? 24;

  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;
  const step = CHUNK_SIZE / resolution;

  const gridVerts = (resolution + 1) * (resolution + 1);
  // Skirt: one extra vertex per border vertex, on all four sides.
  const skirtVerts = (resolution + 1) * 4;
  const totalVerts = gridVerts + skirtVerts;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  // Four biome weights per vertex, blended by the terrain shader.
  const biomeWeights = new Float32Array(totalVerts * 4);
  // Which four biome indices those weights refer to.
  const biomeIndices = new Float32Array(totalVerts * 4);

  let minHeight = Infinity;
  let maxHeight = -Infinity;
  const biomesPresent = new Set<BiomeId>();

  // ---- Height grid, with a one-cell border.
  //
  // Sampling heights into a grid first, then deriving normals from neighbours,
  // replaces the five height evaluations per vertex that `terrain.sample()`
  // would otherwise spend on finite differences. Profiling in the browser put
  // a single LOD0 chunk at 225ms before this change; the grid pass makes the
  // heights the only per-vertex terrain cost.
  const gridDim = resolution + 3; // (resolution + 1) vertices plus a border.
  const heights = new Float32Array(gridDim * gridDim);
  for (let gz = 0; gz < gridDim; gz++) {
    for (let gx = 0; gx < gridDim; gx++) {
      const x = originX + (gx - 1) * step;
      const z = originZ + (gz - 1) * step;
      heights[gz * gridDim + gx] = terrain.sampleHeight(x, z);
    }
  }

  const heightAt = (ix: number, iz: number): number => heights[(iz + 1) * gridDim + (ix + 1)];

  // ---- Grid vertices.
  for (let iz = 0; iz <= resolution; iz++) {
    for (let ix = 0; ix <= resolution; ix++) {
      const vi = iz * (resolution + 1) + ix;
      const x = originX + ix * step;
      const z = originZ + iz * step;

      const height = heightAt(ix, iz);

      // Central differences over the grid. The gradient's perpendicular is
      // the surface normal; `2 * step` is the span between the two samples.
      let nx = heightAt(ix - 1, iz) - heightAt(ix + 1, iz);
      let ny = 2 * step;
      let nz = heightAt(ix, iz - 1) - heightAt(ix, iz + 1);
      const invLen = 1 / (Math.hypot(nx, ny, nz) || 1);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const sample = terrain.sampleFrom(x, z, height, nx, ny, nz);
      const classification = classifier.classify(sample);

      const o3 = vi * 3;
      positions[o3] = x - originX;       // Local space: the mesh is positioned
      positions[o3 + 1] = sample.height; // at the chunk origin in the scene, so
      positions[o3 + 2] = z - originZ;   // float precision stays good at 40km.

      normals[o3] = sample.normalX;
      normals[o3 + 1] = sample.normalY;
      normals[o3 + 2] = sample.normalZ;

      const o2 = vi * 2;
      uvs[o2] = ix / resolution;
      uvs[o2 + 1] = iz / resolution;

      const o4 = vi * 4;
      const primary = biomeIndex(classification.biome.id);
      const secondary = classification.secondary
        ? biomeIndex(classification.secondary.id)
        : primary;
      biomeIndices[o4] = primary;
      biomeIndices[o4 + 1] = secondary;
      biomeIndices[o4 + 2] = primary;
      biomeIndices[o4 + 3] = primary;

      const blend = classification.blend;
      biomeWeights[o4] = 1 - blend;
      biomeWeights[o4 + 1] = blend;
      biomeWeights[o4 + 2] = 0;
      biomeWeights[o4 + 3] = 0;

      biomesPresent.add(classification.biome.id);
      if (sample.height < minHeight) minHeight = sample.height;
      if (sample.height > maxHeight) maxHeight = sample.height;
    }
  }

  // ---- Grid indices.
  const quadCount = resolution * resolution;
  const gridIndexCount = quadCount * 6;
  const skirtIndexCount = resolution * 4 * 6;
  const indices = totalVerts > 65535
    ? new Uint32Array(gridIndexCount + skirtIndexCount)
    : new Uint16Array(gridIndexCount + skirtIndexCount);

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

  // ---- Skirt.
  // Each border vertex gets a partner dropped `skirtDepth` below it. The two
  // are stitched into a quad strip that fills any crack against a neighbour
  // chunk meshed at a different resolution.
  let skirtBase = gridVerts;

  const addSkirtEdge = (
    getGridIndex: (i: number) => number,
  ): void => {
    const first = skirtBase;
    for (let i = 0; i <= resolution; i++) {
      const src = getGridIndex(i);
      const dst = skirtBase + i;
      const s3 = src * 3;
      const d3 = dst * 3;
      positions[d3] = positions[s3];
      positions[d3 + 1] = positions[s3 + 1] - skirtDepth;
      positions[d3 + 2] = positions[s3 + 2];
      // Copy the surface normal so the skirt shades like the edge it hangs
      // from; a downward normal would read as a black band.
      normals[d3] = normals[s3];
      normals[d3 + 1] = normals[s3 + 1];
      normals[d3 + 2] = normals[s3 + 2];

      const s2 = src * 2;
      const d2 = dst * 2;
      uvs[d2] = uvs[s2];
      uvs[d2 + 1] = uvs[s2 + 1];

      const s4 = src * 4;
      const d4 = dst * 4;
      for (let k = 0; k < 4; k++) {
        biomeWeights[d4 + k] = biomeWeights[s4 + k];
        biomeIndices[d4 + k] = biomeIndices[s4 + k];
      }
    }

    for (let i = 0; i < resolution; i++) {
      const topA = getGridIndex(i);
      const topB = getGridIndex(i + 1);
      const botA = first + i;
      const botB = first + i + 1;
      indices[idx++] = topA;
      indices[idx++] = botA;
      indices[idx++] = topB;
      indices[idx++] = topB;
      indices[idx++] = botA;
      indices[idx++] = botB;
    }

    skirtBase += resolution + 1;
  };

  addSkirtEdge((i) => i);                                           // North
  addSkirtEdge((i) => resolution * (resolution + 1) + i);           // South
  addSkirtEdge((i) => i * (resolution + 1));                        // West
  addSkirtEdge((i) => i * (resolution + 1) + resolution);           // East

  // ---- Assemble.
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('biomeWeight', new Float32BufferAttribute(biomeWeights, 4));
  geometry.setAttribute('biomeIndex', new Float32BufferAttribute(biomeIndices, 4));
  geometry.setIndex(new BufferAttribute(indices, 1));

  // Explicit bounds: computing them would re-read every vertex, and we already
  // know the extents from the loop above.
  const halfSize = CHUNK_SIZE / 2;
  const centerY = (minHeight + maxHeight) / 2;
  const radius = Math.sqrt(
    halfSize * halfSize * 2 + Math.pow((maxHeight - minHeight) / 2 + skirtDepth, 2),
  );
  geometry.boundingSphere = new Sphere(new Vector3(halfSize, centerY, halfSize), radius);

  return {
    geometry,
    minHeight,
    maxHeight,
    biomes: [...biomesPresent],
    vertexCount: totalVerts,
  };
}

/** Triangle count for a LOD, for the budget planner and the stats overlay. */
export function triangleCountForLod(lod: number): number {
  const resolution = LOD_RESOLUTIONS[Math.min(lod, LOD_RESOLUTIONS.length - 1)];
  return resolution * resolution * 2 + resolution * 4 * 2;
}
