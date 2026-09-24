/**
 * Nearby wildlife drawn with drop-in glTF models.
 *
 * glTF models are drawn one object per creature, which is fine for the dozen
 * nearest and not for two hundred. So an overridden species uses its glTF
 * model up close — within `distance`, up to `perSpecies` at a time, nearest
 * first — and the procedural model's instanced far LOD everywhere else. The
 * ids drawn here are published in `claimed` so the procedural crowd skips
 * them.
 */
import { Group, type Scene } from 'three';
import { getSpecies } from '@alola/data';
import type { CrowdMember } from '@alola/render';
import { ModelOverrides, type ModelInstance } from './model-overrides.ts';

interface Pool {
  readonly instances: ModelInstance[];
  used: number;
}

export class OverrideCrowd {
  private readonly root = new Group();
  private readonly overrides: ModelOverrides;
  private readonly pools = new Map<string, Pool>();
  private readonly member: CrowdMember = {
    id: 0, speciesId: '', x: 0, y: 0, z: 0, yaw: 0, scale: 1, speed: 0, elevated: false,
  };
  private readonly candidates: { index: number; distance: number; speciesId: string }[] = [];

  /** Brain ids drawn by this crowd this frame. */
  readonly claimed = new Set<number>();
  distance: number;
  perSpecies: number;

  constructor(scene: Scene, overrides: ModelOverrides, opts: { distance?: number; perSpecies?: number } = {}) {
    this.overrides = overrides;
    this.distance = opts.distance ?? 60;
    this.perSpecies = opts.perSpecies ?? 12;
    scene.add(this.root);
  }

  get active(): boolean {
    return this.overrides.speciesIds.length > 0;
  }

  private pool(speciesId: string): Pool {
    let pool = this.pools.get(speciesId);
    if (!pool) {
      pool = { instances: [], used: 0 };
      this.pools.set(speciesId, pool);
    }
    return pool;
  }

  update(count: number, read: (index: number, out: CrowdMember) => boolean, cx: number, cz: number, hidden: ReadonlySet<number>, dt: number): void {
    this.claimed.clear();
    for (const pool of this.pools.values()) pool.used = 0;
    if (!this.active) return;

    const m = this.member;
    const candidates = this.candidates;
    candidates.length = 0;
    for (let i = 0; i < count; i++) {
      if (!read(i, m) || hidden.has(m.id) || !this.overrides.ready(m.speciesId)) continue;
      const d = Math.hypot(m.x - cx, m.z - cz);
      if (d <= this.distance) candidates.push({ index: i, distance: d, speciesId: m.speciesId });
    }
    candidates.sort((a, b) => a.distance - b.distance);

    for (const c of candidates) {
      const pool = this.pool(c.speciesId);
      if (pool.used >= this.perSpecies) continue;
      read(c.index, m);
      let instance = pool.instances[pool.used];
      if (!instance) {
        instance = ModelOverrides.instantiate(this.overrides.species(c.speciesId)!);
        pool.instances.push(instance);
        this.root.add(instance.object);
      }
      pool.used++;
      const species = getSpecies(m.speciesId);
      const size = species.height * m.scale;
      instance.object.visible = true;
      instance.object.position.set(m.x, m.y, m.z);
      instance.object.rotation.set(0, Math.PI - m.yaw, 0);
      instance.object.scale.setScalar(size);
      ModelOverrides.animate(instance, Math.min(2, m.speed / Math.max(0.5, species.moveSpeed)), dt);
      this.claimed.add(m.id);
    }

    for (const pool of this.pools.values()) {
      for (let i = pool.used; i < pool.instances.length; i++) pool.instances[i].object.visible = false;
    }
  }
}
