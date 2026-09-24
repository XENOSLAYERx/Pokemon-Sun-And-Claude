/**
 * Terrain chunk meshing — the data half.
 *
 * Produces the vertex data for one chunk at one LOD as plain typed arrays, with
 * no Three.js dependency. That split is what lets meshing run on a Web Worker:
 * the arrays are transferred back to the main thread without a copy, and the
 * main thread only wraps them in a BufferGeometry.
 *
 * Two details carry most of the weight:
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
  CHUNK_SIZE, LOD_RESOLUTIONS,
  type TerrainGenerator, type BiomeClassifier, type BiomeClassification,
} from '@alola/world';
import { BIOMES, type BiomeId } from '@alola/data';

/** Stable index for each biome, so the shader can look up its material. */
const BIOME_INDEX = new Map<BiomeId, number>(BIOMES.map((b, i) => [b.id, i]));

export function biomeIndex(id: BiomeId): number {
  return BIOME_INDEX.get(id) ?? 0;
}

export interface MeshOptions {
  /** How far the skirt hangs below the terrain edge, in metres. */
  readonly skirtDepth?: number;
  /** Generate a second UV set for detail texturing. */
  readonly detailUvs?: boolean;
}

/** Bare rock, blended in on steep ground whatever the biome says. */
const ROCK: readonly [number, number, number] = [0.30, 0.28, 0.26];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Ground colour for one vertex.
 *
 * Shared by the streamed chunks and the far-terrain mesh, so the colour on
 * either side of the handover is computed identically and the seam is
 * invisible. Three things go in:
 *
 * - the biome and its runner-up, blended by the classifier's weight, so a
 *   meadow fades into a forest rather than changing colour at a chunk edge;
 * - bare rock on steep slopes, whatever the biome — a cliff should read as a
 *   cliff from a kilometre away, and flat paint up a 60° face never does;
 * - a slight lift with altitude, the cheapest possible aerial perspective.
 */
export function writeGroundColor(
  out: Float32Array,
  offset: number,
  classification: BiomeClassification,
  normalY: number,
  height: number,
): void {
  const a = classification.biome.groundColor;
  const b = (classification.secondary ?? classification.biome).groundColor;
  const t = classification.blend;
  let r = a[0] + (b[0] - a[0]) * t;
  let g = a[1] + (b[1] - a[1]) * t;
  let bl = a[2] + (b[2] - a[2]) * t;

  // Only above water: the seabed keeps its own colour.
  if (height > 0) {
    const steep = smoothstep(0.86, 0.62, normalY) * 0.85;
    r += (ROCK[0] - r) * steep;
    g += (ROCK[1] - g) * steep;
    bl += (ROCK[2] - bl) * steep;

    const lift = Math.min(0.12, height / 6000);
    r += (1 - r) * lift;
    g += (1 - g) * lift;
    bl += (1 - bl) * lift;
  }

  out[offset] = r;
  out[offset + 1] = g;
  out[offset + 2] = bl;
}

/** Everything a chunk mesh needs, as transferable typed arrays. */
export interface TerrainMeshArrays {
  readonly cx: number;
  readonly cz: number;
  readonly lod: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  /** Linear RGB ground colour per vertex. */
  readonly colors: Float32Array;
  readonly biomeWeights: Float32Array;
  readonly biomeIndices: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly skirtDepth: number;
  /** Biome ids present, dominant (most vertices) first. */
  readonly biomes: BiomeId[];
  readonly vertexCount: number;
}

/** The buffers to list as transferables when posting arrays across a Worker. */
export function transferablesOf(arrays: TerrainMeshArrays): ArrayBuffer[] {
  return [
    arrays.positions.buffer as ArrayBuffer,
    arrays.normals.buffer as ArrayBuffer,
    arrays.uvs.buffer as ArrayBuffer,
    arrays.colors.buffer as ArrayBuffer,
    arrays.biomeWeights.buffer as ArrayBuffer,
    arrays.biomeIndices.buffer as ArrayBuffer,
    arrays.indices.buffer as ArrayBuffer,
  ];
}

export function buildTerrainArrays(
  terrain: TerrainGenerator,
  classifier: BiomeClassifier,
  cx: number,
  cz: number,
  lod: number,
  opts: MeshOptions = {},
): TerrainMeshArrays {
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
  const colors = new Float32Array(totalVerts * 3);
  // Four biome weights per vertex, blended by the terrain shader.
  const biomeWeights = new Float32Array(totalVerts * 4);
  // Which four biome indices those weights refer to.
  const biomeIndices = new Float32Array(totalVerts * 4);

  let minHeight = Infinity;
  let maxHeight = -Infinity;
  // Counted rather than just collected, so `biomes[0]` is genuinely the
  // dominant biome and not whichever happened to be sampled first.
  const biomeCounts = new Map<BiomeId, number>();

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

      writeGroundColor(colors, o3, classification, sample.normalY, sample.height);

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

      biomeCounts.set(classification.biome.id, (biomeCounts.get(classification.biome.id) ?? 0) + 1);
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
      colors[d3] = colors[s3];
      colors[d3 + 1] = colors[s3 + 1];
      colors[d3 + 2] = colors[s3 + 2];

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

  const biomes = [...biomeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  return {
    cx, cz, lod,
    positions, normals, uvs, colors, biomeWeights, biomeIndices, indices,
    minHeight, maxHeight, skirtDepth,
    biomes,
    vertexCount: totalVerts,
  };
}
