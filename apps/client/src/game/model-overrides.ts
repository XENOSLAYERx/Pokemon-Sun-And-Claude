/**
 * Drop-in model overrides.
 *
 * Every Pokémon and the player have a procedural model. Any of them can be
 * replaced by a glTF binary (.glb) placed in `public/models/` and listed in
 * `public/models/manifest.json`:
 *
 *   {
 *     "player": "trainer.glb",
 *     "species": { "PIKACHU": "pikachu.glb", "LAPRAS": "lapras.glb" }
 *   }
 *
 * A model is normalised on load — scaled so its largest dimension is one unit,
 * centred, feet on the ground — so it drops into the same place the procedural
 * one occupied, at the species' real height. glTF's own convention (+Y up, +Z
 * forward) is the convention the game already uses, so a model exported from
 * Blender with default settings faces the right way.
 *
 * Animation clips are picked up by name if present: anything containing
 * "idle", "walk" or "run" (case-insensitive). A model with none is shown
 * static, and still moves around the world correctly.
 *
 * No manifest, or an empty one, means every model is procedural. A missing or
 * broken file is reported once and falls back to the procedural model rather
 * than leaving a hole in the world.
 */
import {
  Box3, Vector3, Group, AnimationMixer, LoopRepeat,
  type AnimationAction, type AnimationClip, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface OverrideManifest {
  readonly player?: string | null;
  readonly species?: Readonly<Record<string, string>>;
}

export interface LoadedModel {
  /** Normalised template: one unit in its largest dimension, feet on y = 0. */
  readonly template: Group;
  readonly clips: readonly AnimationClip[];
  readonly source: string;
}

export interface ModelInstance {
  readonly object: Group;
  readonly mixer: AnimationMixer | null;
  readonly idle: AnimationAction | null;
  readonly walk: AnimationAction | null;
  readonly run: AnimationAction | null;
  /** 0 idle, 1 walk, 2 run: which clip is currently leading. */
  gait: number;
}

function normalise(scene: Object3D): Group {
  const box = new Box3().setFromObject(scene);
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const largest = Math.max(size.x, size.y, size.z) || 1;
  const inner = new Group();
  inner.add(scene);
  // Centre on X/Z, feet on the ground, one unit across its largest dimension.
  scene.position.set(-centre.x, -box.min.y, -centre.z);
  inner.scale.setScalar(1 / largest);
  const outer = new Group();
  outer.add(inner);
  scene.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return outer;
}

const clipFor = (clips: readonly AnimationClip[], name: string): AnimationClip | undefined =>
  clips.find((c) => c.name.toLowerCase().includes(name));

export class ModelOverrides {
  private readonly base: string;
  private readonly manifest: OverrideManifest;
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<LoadedModel | null>>();
  private readonly loaded = new Map<string, LoadedModel>();
  private readonly failures: string[] = [];

  private constructor(base: string, manifest: OverrideManifest) {
    this.base = base;
    this.manifest = manifest;
  }

  /** Read the manifest. Never throws: a missing manifest means no overrides. */
  static async load(base = 'models/'): Promise<ModelOverrides> {
    try {
      const response = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
      if (!response.ok) return new ModelOverrides(base, {});
      const manifest = (await response.json()) as OverrideManifest;
      return new ModelOverrides(base, manifest ?? {});
    } catch {
      return new ModelOverrides(base, {});
    }
  }

  get speciesIds(): string[] {
    return Object.keys(this.manifest.species ?? {});
  }

  get hasPlayer(): boolean {
    return typeof this.manifest.player === 'string' && this.manifest.player.length > 0;
  }

  /** Is a species' override loaded and ready to draw right now? */
  ready(speciesId: string): boolean {
    return this.loaded.has(`species:${speciesId}`);
  }

  get playerReady(): boolean {
    return this.loaded.has('player');
  }

  /** Problems loading files, for a one-time notice. */
  get errors(): readonly string[] {
    return this.failures;
  }

  private fetchModel(key: string, file: string): Promise<LoadedModel | null> {
    let pending = this.cache.get(key);
    if (pending) return pending;
    pending = this.loader.loadAsync(`${this.base}${file}`)
      .then((gltf) => {
        const model: LoadedModel = { template: normalise(gltf.scene), clips: gltf.animations, source: file };
        this.loaded.set(key, model);
        return model;
      })
      .catch((error: unknown) => {
        this.failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
    this.cache.set(key, pending);
    return pending;
  }

  /** Start loading everything the manifest lists. */
  async preload(): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (const [id, file] of Object.entries(this.manifest.species ?? {})) jobs.push(this.fetchModel(`species:${id}`, file));
    if (this.hasPlayer) jobs.push(this.fetchModel('player', this.manifest.player!));
    await Promise.all(jobs);
  }

  species(speciesId: string): LoadedModel | null {
    return this.loaded.get(`species:${speciesId}`) ?? null;
  }

  player(): LoadedModel | null {
    return this.loaded.get('player') ?? null;
  }

  /**
   * A new copy of a loaded model, with its own animation state. Skinned
   * meshes need SkeletonUtils' clone — Object3D.clone() would leave every
   * copy sharing one skeleton, so they would all move as one.
   */
  static instantiate(model: LoadedModel): ModelInstance {
    const object = cloneSkinned(model.template) as Group;
    let mixer: AnimationMixer | null = null;
    let idle: AnimationAction | null = null;
    let walk: AnimationAction | null = null;
    let run: AnimationAction | null = null;
    if (model.clips.length > 0) {
      mixer = new AnimationMixer(object);
      const make = (clip: AnimationClip | undefined): AnimationAction | null => {
        if (!clip) return null;
        const action = mixer!.clipAction(clip);
        action.setLoop(LoopRepeat, Infinity);
        action.play();
        action.setEffectiveWeight(0);
        return action;
      };
      const walkClip = clipFor(model.clips, 'walk');
      const runClip = clipFor(model.clips, 'run');
      // With no clip named idle, fall back to one that isn't already the walk
      // or run — and if walking is all there is, let it play throughout. The
      // mixer returns one action per clip, so sharing a clip between two slots
      // would have the second weight overwrite the first and freeze the model.
      const idleClip = clipFor(model.clips, 'idle')
        ?? model.clips.find((c) => c !== walkClip && c !== runClip)
        ?? model.clips[0];
      idle = make(idleClip);
      walk = walkClip === idleClip ? null : make(walkClip);
      run = runClip === idleClip || runClip === walkClip ? null : make(runClip);
      idle?.setEffectiveWeight(1);
    }
    return { object, mixer, idle, walk, run, gait: 0 };
  }

  /** Blend clips toward a gait (0 idle, 1 walk, 2 run) and advance time. */
  static animate(instance: ModelInstance, gait: number, dt: number): void {
    if (!instance.mixer) return;
    instance.gait += (gait - instance.gait) * Math.min(1, dt * 6);
    const g = instance.gait;
    const walkWeight = instance.walk ? Math.max(0, 1 - Math.abs(g - 1)) : 0;
    const runWeight = instance.run ? Math.max(0, Math.min(1, g - 1)) : 0;
    // Whatever the model lacks, idle covers.
    const idleWeight = Math.max(0, 1 - walkWeight - runWeight);
    instance.idle?.setEffectiveWeight(idleWeight);
    instance.walk?.setEffectiveWeight(walkWeight);
    instance.run?.setEffectiveWeight(runWeight);
    instance.mixer.update(dt);
  }
}
