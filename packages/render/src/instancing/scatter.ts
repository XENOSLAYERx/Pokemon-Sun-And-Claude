/**
 * GPU instancing for foliage and props.
 *
 * A dense jungle chunk holds tens of thousands of plants. One draw call each
 * is impossible; one draw call per *prototype* is trivial. This module builds
 * the per-instance transform buffers, culls them, and keeps the instance count
 * inside a budget so a dense biome cannot blow the frame.
 *
 * Scatter positions are derived from the world seed, so foliage is stable
 * across chunk reloads and identical between players — a bush you hid behind
 * is in the same place when you come back.
 */
import { InstancedMesh, Matrix4, Object3D, Vector3, type BufferGeometry, type Material } from 'three';
import { rngForCell, type Rng } from '@alola/core';
import { CHUNK_SIZE, type TerrainGenerator, type BiomeClassifier } from '@alola/world';
import { getBiome } from '@alola/data';

export interface ScatterInstance {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Which prototype this instance uses. */
  proto: string;
  /** Per-instance colour variation index, so a stand of trees is not uniform. */
  tint: number;
}

export interface ScatterOptions {
  /** Hard cap on instances for one chunk, across all prototypes. */
  readonly maxInstances?: number;
  /** Multiplier on biome foliage density, from the graphics quality setting. */
  readonly densityScale?: number;
  /** Do not scatter on slopes steeper than this, in radians. */
  readonly maxSlope?: number;
}

/**
 * Generate the foliage instances for one chunk.
 *
 * Uses stratified sampling — the chunk is divided into a grid and one candidate
 * is jittered within each cell — rather than uniform random placement. Uniform
 * random produces visible clumps and bald patches; stratified looks natural and
 * costs the same.
 */
export function scatterFoliage(
  worldSeed: number,
  terrain: TerrainGenerator,
  classifier: BiomeClassifier,
  cx: number,
  cz: number,
  opts: ScatterOptions = {},
): ScatterInstance[] {
  const maxInstances = opts.maxInstances ?? 4096;
  const densityScale = opts.densityScale ?? 1;
  const maxSlope = opts.maxSlope ?? 0.7;

  const out: ScatterInstance[] = [];
  const rng: Rng = rngForCell(worldSeed, cx, cz, 'foliage');

  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  // Sample the chunk centre to get a representative density, then stratify.
  const centerSample = terrain.sample(originX + CHUNK_SIZE / 2, originZ + CHUNK_SIZE / 2);
  const centerBiome = classifier.classify(centerSample).biome;
  const baseDensity = centerBiome.foliageDensity * densityScale;
  if (baseDensity <= 0) return out;

  // Instances per square metre -> a grid resolution.
  const targetCount = Math.min(maxInstances, Math.floor(baseDensity * CHUNK_SIZE * CHUNK_SIZE * 0.01));
  if (targetCount <= 0) return out;

  const gridSize = Math.max(1, Math.ceil(Math.sqrt(targetCount)));
  const cellSize = CHUNK_SIZE / gridSize;

  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      if (out.length >= maxInstances) return out;

      // Jitter within the cell.
      const x = originX + (gx + rng.next()) * cellSize;
      const z = originZ + (gz + rng.next()) * cellSize;

      const sample = terrain.sample(x, z);
      if (sample.height < 0.2) continue;             // No foliage underwater.
      if (sample.slope > maxSlope) continue;         // Or on a cliff face.

      const biome = classifier.classify(sample).biome;
      if (biome.foliage.length === 0) continue;

      // Local density can differ from the chunk centre; reject accordingly so
      // a chunk straddling a treeline thins out naturally.
      const localDensity = biome.foliageDensity * densityScale;
      if (rng.next() > localDensity / Math.max(baseDensity, 0.0001)) continue;

      const protoIndex = rng.weightedIndex(biome.foliage.map((f) => f.weight));
      if (protoIndex < 0) continue;

      out.push({
        x,
        y: sample.height,
        z,
        yaw: rng.yaw(),
        // Log-normal-ish size variation: mostly average, occasionally large.
        scale: 0.75 + Math.abs(rng.gaussian(0, 0.35)),
        proto: biome.foliage[protoIndex].proto,
        tint: rng.int(0, 3),
      });
    }
  }

  return out;
}

/** An instanced draw batch for one prototype. */
export class InstanceBatch {
  readonly mesh: InstancedMesh;
  private readonly dummy = new Object3D();
  private count = 0;
  readonly capacity: number;

  constructor(geometry: BufferGeometry, material: Material, capacity: number) {
    this.capacity = capacity;
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    // Instances change when chunks stream, not per frame.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  begin(): void {
    this.count = 0;
  }

  /** Add one instance. Returns false when the batch is full. */
  add(instance: ScatterInstance, chunkOriginX: number, chunkOriginZ: number): boolean {
    if (this.count >= this.capacity) return false;
    this.dummy.position.set(
      instance.x - chunkOriginX,
      instance.y,
      instance.z - chunkOriginZ,
    );
    this.dummy.rotation.set(0, instance.yaw, 0);
    this.dummy.scale.setScalar(instance.scale);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(this.count, this.dummy.matrix);
    this.count++;
    return true;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get instanceCount(): number {
    return this.count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

/**
 * Distance-based instance budget.
 *
 * Rather than a hard draw distance — which produces a visible wall of popping
 * foliage — density falls off with distance. Distant chunks keep only their
 * largest instances, so the silhouette of a forest survives while the
 * undergrowth does not.
 */
export function instanceBudgetFor(distance: number, maxInstances: number): number {
  if (distance < 80) return maxInstances;
  if (distance < 200) return Math.floor(maxInstances * 0.55);
  if (distance < 450) return Math.floor(maxInstances * 0.22);
  if (distance < 900) return Math.floor(maxInstances * 0.06);
  return 0;
}

/** Keep the largest instances when a budget forces a cut. */
export function selectForBudget(instances: ScatterInstance[], budget: number): ScatterInstance[] {
  if (instances.length <= budget) return instances;
  return instances
    .slice()
    .sort((a, b) => b.scale - a.scale)
    .slice(0, budget);
}

/** Frustum-cull a chunk's instances by bounding sphere. */
export function cullInstances(
  instances: readonly ScatterInstance[],
  cameraPos: Vector3,
  cameraDir: Vector3,
  fovCos: number,
  maxDistance: number,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  for (const instance of instances) {
    const dx = instance.x - cameraPos.x;
    const dy = instance.y - cameraPos.y;
    const dz = instance.z - cameraPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > maxDistance * maxDistance) continue;

    const dist = Math.sqrt(distSq);
    if (dist > 1e-3) {
      const dot = (dx * cameraDir.x + dy * cameraDir.y + dz * cameraDir.z) / dist;
      // Generous margin so instances do not pop at the screen edge.
      if (dot < fovCos - 0.25) continue;
    }
    out.push(instance);
  }
  return out;
}

export { Matrix4 };
