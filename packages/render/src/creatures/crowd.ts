/**
 * Crowd rendering for creatures.
 *
 * Every visible Pokémon of a species at a detail level is one instance in one
 * InstancedMesh: forty Pikipek on a hillside is one draw call, not forty. Near
 * creatures get the detailed mesh, an ink outline and shadows; far ones get
 * the low-detail mesh and nothing else.
 *
 * The caller hands over a reader rather than an array of objects, so a crowd
 * of two hundred costs no allocations per frame — the thing it replaced built
 * a fresh object per Pokémon every tick.
 */
import {
  BufferGeometry, InstancedMesh, InstancedBufferAttribute, DynamicDrawUsage, Matrix4,
  Quaternion, Vector3, Frustum, Sphere, type Camera, type Scene,
} from 'three';
import { tryGetSpecies } from '@alola/data';
import { buildCreature, strideFor, type CreatureAsset } from './assets.ts';
import { createCreatureMaterials, type CreatureMaterials } from './material.ts';

/** One creature as the renderer needs it. Filled in place by the caller. */
export interface CrowdMember {
  id: number;
  speciesId: string;
  x: number;
  y: number;
  z: number;
  /** Heading in the simulation's convention: forward is (sin yaw, 0, -cos yaw). */
  yaw: number;
  /** Individual size: 1 for typical, larger for alphas and Totems. */
  scale: number;
  /** Horizontal speed, m/s. Drives the gait. */
  speed: number;
  /** Has the simulation already placed it in the air or water? */
  elevated: boolean;
}

export interface CrowdOptions {
  /** Ink outlines on near creatures. Off on the lowest presets. */
  outlines?: boolean;
  /** Distance inside which the detailed mesh is used, metres. */
  nearDistance?: number;
  /** Near creatures cast shadows. */
  shadows?: boolean;
  /** Maximum creatures drawn, nearest first. */
  maxVisible?: number;
}

interface Batch {
  readonly asset: CreatureAsset;
  readonly geometry: BufferGeometry;
  readonly anim: InstancedBufferAttribute;
  readonly body: InstancedMesh;
  readonly outline: InstancedMesh | null;
  capacity: number;
  count: number;
}

interface SpeciesEntry {
  readonly speciesId: string;
  readonly materials: CreatureMaterials;
  readonly height: number;
  readonly stride: number;
  readonly moveSpeed: number;
  readonly hover: number;
  near: Batch | null;
  far: Batch | null;
}

interface AnimState {
  cycle: number;
  gait: number;
  seen: number;
}

/**
 * A geometry that shares every attribute of the cached model but carries its
 * own per-instance animation buffer. Shared attributes upload to the GPU
 * once, however many batches use them.
 */
export function instancedCopy(source: BufferGeometry, capacity: number): { geometry: BufferGeometry; anim: InstancedBufferAttribute } {
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name !== 'aAnim') geometry.setAttribute(name, attribute);
  }
  geometry.setIndex(source.getIndex());
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  const anim = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  anim.setUsage(DynamicDrawUsage);
  geometry.setAttribute('aAnim', anim);
  return { geometry, anim };
}

const _matrix = new Matrix4();
const _quat = new Quaternion();
const _pos = new Vector3();
const _scale = new Vector3();
const _up = new Vector3(0, 1, 0);
const _frustum = new Frustum();
const _projScreen = new Matrix4();
const _sphere = new Sphere();

export class CreatureCrowd {
  private readonly scene: Scene;
  private readonly species = new Map<string, SpeciesEntry>();
  private readonly anim = new Map<number, AnimState>();
  private outlines: boolean;
  private nearDistance: number;
  private shadows: boolean;
  private maxVisible: number;
  private frame = 0;
  private time = 0;

  /** Filled per frame by the caller's reader. */
  private readonly member: CrowdMember = {
    id: 0, speciesId: '', x: 0, y: 0, z: 0, yaw: 0, scale: 1, speed: 0, elevated: false,
  };

  // Candidates for the visible cap, reused between frames.
  private candidates: { index: number; distance: number }[] = [];

  readonly stats = { drawn: 0, near: 0, far: 0, culled: 0, drawCalls: 0, species: 0 };

  /** Ids to skip this frame — the Pokémon currently being battled. */
  readonly hidden = new Set<number>();

  constructor(scene: Scene, opts: CrowdOptions = {}) {
    this.scene = scene;
    this.outlines = opts.outlines ?? true;
    this.nearDistance = opts.nearDistance ?? 45;
    this.shadows = opts.shadows ?? true;
    this.maxVisible = opts.maxVisible ?? 220;
  }

  configure(opts: CrowdOptions): void {
    if (opts.nearDistance !== undefined) this.nearDistance = opts.nearDistance;
    if (opts.maxVisible !== undefined) this.maxVisible = opts.maxVisible;
    if (opts.shadows !== undefined) {
      this.shadows = opts.shadows;
      for (const entry of this.species.values()) {
        if (entry.near) entry.near.body.castShadow = this.shadows;
      }
    }
    if (opts.outlines !== undefined && opts.outlines !== this.outlines) {
      this.outlines = opts.outlines;
      // Outline meshes are created with the near batch; rebuild them.
      for (const entry of this.species.values()) {
        if (entry.near) this.disposeBatch(entry.near);
        entry.near = null;
      }
    }
  }

  private entryFor(speciesId: string): SpeciesEntry {
    let entry = this.species.get(speciesId);
    if (entry) return entry;
    const species = tryGetSpecies(speciesId);
    const asset = buildCreature(speciesId, 'high');
    entry = {
      speciesId,
      materials: createCreatureMaterials(asset.rig),
      height: species?.height ?? 1,
      stride: strideFor(speciesId, asset.rig),
      moveSpeed: Math.max(0.5, species?.moveSpeed ?? 3),
      hover: asset.rig.flies ? asset.rig.hoverHeight : 0,
      near: null,
      far: null,
    };
    this.species.set(speciesId, entry);
    this.stats.species = this.species.size;
    return entry;
  }

  private makeBatch(entry: SpeciesEntry, detail: 'high' | 'low', capacity: number): Batch {
    const asset = buildCreature(entry.speciesId, detail);
    const { geometry, anim } = instancedCopy(asset.geometry, capacity);
    const body = new InstancedMesh(geometry, entry.materials.body, capacity);
    body.instanceMatrix.setUsage(DynamicDrawUsage);
    // Culled per instance on the CPU below; the mesh-level test would use a
    // stale bounding sphere for instances that move every frame.
    body.frustumCulled = false;
    body.count = 0;
    let outline: InstancedMesh | null = null;
    if (detail === 'high') {
      body.castShadow = this.shadows;
      body.customDepthMaterial = entry.materials.depth;
      if (this.outlines) {
        outline = new InstancedMesh(geometry, entry.materials.outline, capacity);
        // Same matrices, same animation buffer: one upload drives both.
        outline.instanceMatrix = body.instanceMatrix;
        outline.frustumCulled = false;
        outline.count = 0;
        this.scene.add(outline);
      }
    }
    this.scene.add(body);
    return { asset, geometry, anim, body, outline, capacity, count: 0 };
  }

  private ensure(entry: SpeciesEntry, detail: 'high' | 'low', needed: number): Batch {
    let batch = detail === 'high' ? entry.near : entry.far;
    if (batch && batch.capacity >= needed) return batch;
    const capacity = Math.max(8, 1 << Math.ceil(Math.log2(Math.max(needed, batch ? batch.capacity * 2 : 8))));
    if (batch) this.disposeBatch(batch);
    batch = this.makeBatch(entry, detail, capacity);
    if (detail === 'high') entry.near = batch;
    else entry.far = batch;
    return batch;
  }

  private disposeBatch(batch: Batch): void {
    this.scene.remove(batch.body);
    if (batch.outline) this.scene.remove(batch.outline);
    batch.body.dispose();
    batch.outline?.dispose();
    // Only the per-batch animation buffer is ours; the rest is the shared asset.
    batch.geometry.deleteAttribute('aAnim');
  }

  /**
   * Draw this frame's crowd.
   *
   * `read(i, out)` fills `out` for the i-th creature and returns false to skip
   * it. The nearest `maxVisible` inside the view are drawn.
   */
  update(count: number, read: (index: number, out: CrowdMember) => boolean, camera: Camera, dt: number): void {
    this.frame++;
    this.time += dt;
    for (const entry of this.species.values()) {
      if (entry.near) entry.near.count = 0;
      if (entry.far) entry.far.count = 0;
    }

    camera.updateMatrixWorld();
    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen);
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;

    // Pass 1: cull, and collect candidates by distance.
    const candidates = this.candidates;
    candidates.length = 0;
    let culled = 0;
    const m = this.member;
    for (let i = 0; i < count; i++) {
      if (!read(i, m) || this.hidden.has(m.id)) continue;
      const entry = this.entryFor(m.speciesId);
      const size = entry.height * m.scale;
      _sphere.center.set(m.x, m.y + size * 0.5, m.z);
      _sphere.radius = size * 0.9 + 0.5;
      if (!_frustum.intersectsSphere(_sphere)) {
        culled++;
        continue;
      }
      const d = Math.hypot(m.x - cx, m.y - cy, m.z - cz);
      candidates.push({ index: i, distance: d });
    }
    if (candidates.length > this.maxVisible) {
      candidates.sort((a, b) => a.distance - b.distance);
      candidates.length = this.maxVisible;
    }

    // Pass 2: write instances.
    let near = 0;
    let far = 0;
    for (const { index, distance } of candidates) {
      read(index, m);
      const entry = this.entryFor(m.speciesId);
      const detail = distance < this.nearDistance ? 'high' : 'low';
      const current = detail === 'high' ? entry.near : entry.far;
      const batch = this.ensure(entry, detail, (current?.count ?? 0) + 1);

      // Gait: how fast it is moving relative to its own walking pace.
      let state = this.anim.get(m.id);
      if (!state) {
        state = { cycle: (m.id * 1.7) % (Math.PI * 2), gait: 0, seen: 0 };
        this.anim.set(m.id, state);
      }
      const target = Math.min(2, m.speed / entry.moveSpeed);
      // Ease into and out of a walk rather than snapping between poses.
      state.gait += (target - state.gait) * Math.min(1, dt * 6);
      state.cycle += dt * entry.stride * Math.PI * 2 * (0.35 + Math.min(state.gait, 1.8) * 0.9) * (state.gait > 0.05 ? 1 : 0);
      state.seen = this.frame;

      const size = entry.height * m.scale;
      const lift = m.elevated ? 0 : entry.hover * size;
      _pos.set(m.x, m.y + lift, m.z);
      // Models face +Z; the simulation's yaw 0 faces -Z.
      _quat.setFromAxisAngle(_up, Math.PI - m.yaw);
      _scale.set(size, size, size);
      _matrix.compose(_pos, _quat, _scale);

      const slot = batch.count++;
      batch.body.setMatrixAt(slot, _matrix);
      batch.anim.setXYZW(slot, state.cycle, state.gait, (m.id * 0.61) % (Math.PI * 2), 0);
      if (detail === 'high') near++;
      else far++;
    }

    // Publish counts and flag uploads.
    let drawCalls = 0;
    for (const entry of this.species.values()) {
      for (const batch of [entry.near, entry.far]) {
        if (!batch) continue;
        batch.body.count = batch.count;
        if (batch.outline) batch.outline.count = batch.count;
        batch.body.visible = batch.count > 0;
        if (batch.outline) batch.outline.visible = batch.count > 0;
        if (batch.count > 0) {
          batch.body.instanceMatrix.needsUpdate = true;
          batch.anim.needsUpdate = true;
          drawCalls += batch.outline ? 2 : 1;
        }
      }
    }

    // Forget animation state for creatures not seen for a while.
    if (this.frame % 120 === 0) {
      for (const [id, state] of this.anim) {
        if (this.frame - state.seen > 240) this.anim.delete(id);
      }
    }

    this.stats.drawn = near + far;
    this.stats.near = near;
    this.stats.far = far;
    this.stats.culled = culled;
    this.stats.drawCalls = drawCalls;
  }

  dispose(): void {
    for (const entry of this.species.values()) {
      if (entry.near) this.disposeBatch(entry.near);
      if (entry.far) this.disposeBatch(entry.far);
      entry.materials.dispose();
    }
    this.species.clear();
    this.anim.clear();
  }
}
