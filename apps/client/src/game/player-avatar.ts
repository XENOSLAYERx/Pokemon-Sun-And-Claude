/**
 * The player's body in the world, and the Pokémon they ride.
 *
 * Built from the saved character — appearance and outfit — and rebuilt when
 * they change. Animated by the same vertex shader as the wildlife: a walk
 * cycle that follows actual movement speed, arms swinging, idle breathing.
 * Riding puts the player on a real mount: Tauros on land, Lapras on water.
 */
import {
  Group, InstancedMesh, Matrix4, type Scene, type InstancedBufferAttribute, type BufferGeometry, type Material,
} from 'three';
import { getSpecies } from '@alola/data';
import {
  buildPlayerModel, humanoidHeight, createCreatureMaterials, instancedCopy, buildCreature, strideFor,
  type HumanoidLook, type CreatureMaterials,
} from '@alola/render';
import { ModelOverrides, type ModelInstance } from './model-overrides.ts';

interface Rigged {
  readonly group: Group;
  readonly anim: InstancedBufferAttribute;
  readonly materials: CreatureMaterials;
  readonly meshes: InstancedMesh<BufferGeometry, Material>[];
  readonly stride: number;
  cycle: number;
  gait: number;
}

function rigged(geometrySource: Parameters<typeof instancedCopy>[0], materials: CreatureMaterials, stride: number, outline: boolean): Rigged {
  const { geometry, anim } = instancedCopy(geometrySource, 1);
  const body = new InstancedMesh(geometry, materials.body, 1);
  body.setMatrixAt(0, new Matrix4());
  body.castShadow = true;
  body.customDepthMaterial = materials.depth;
  body.frustumCulled = false;
  const meshes: InstancedMesh<BufferGeometry, Material>[] = [body];
  const group = new Group();
  group.add(body);
  if (outline) {
    const line = new InstancedMesh(geometry, materials.outline, 1);
    line.instanceMatrix = body.instanceMatrix;
    line.frustumCulled = false;
    group.add(line);
    meshes.push(line);
  }
  return { group, anim, materials, meshes, stride, cycle: 0, gait: 0 };
}

function disposeRigged(r: Rigged | null): void {
  if (!r) return;
  r.group.removeFromParent();
  for (const m of r.meshes) m.dispose();
  r.materials.dispose();
}

export class PlayerAvatar {
  private readonly scene: Scene;
  readonly root = new Group();
  private body: Rigged | null = null;
  private mount: Rigged | null = null;
  private mountSpecies = '';
  private mountSaddle = 0;
  private height = 1.65;
  private lookKey = '';
  /** A drop-in glTF player model, when the manifest provides one. */
  private custom: ModelInstance | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.scene.add(this.root);
  }

  /**
   * Use a drop-in glTF model for the player instead of the procedural one.
   * It is still scaled to the height chosen in the creator.
   */
  useCustom(overrides: ModelOverrides): void {
    const model = overrides.player();
    if (!model || this.custom) return;
    this.custom = ModelOverrides.instantiate(model);
    this.custom.object.scale.setScalar(this.height);
    this.root.add(this.custom.object);
    if (this.body) this.body.group.visible = false;
  }

  /** Rebuild the model if the character's look has changed. */
  setLook(look: HumanoidLook): void {
    const key = JSON.stringify(look);
    if (key === this.lookKey) return;
    this.lookKey = key;
    disposeRigged(this.body);

    const { builder, rig } = buildPlayerModel(look);
    const geometry = builder.build();
    this.height = humanoidHeight(look.appearance.height);
    this.body = rigged(geometry, createCreatureMaterials(rig, { outlineWidth: 0.008 }), rig.strideRate / Math.sqrt(this.height), true);
    this.body.group.scale.setScalar(this.height);
    this.body.group.visible = this.custom === null;
    this.root.add(this.body.group);
    this.custom?.object.scale.setScalar(this.height);
  }

  private setMount(speciesId: string | null): void {
    if ((speciesId ?? '') === this.mountSpecies) return;
    disposeRigged(this.mount);
    this.mount = null;
    this.mountSpecies = speciesId ?? '';
    if (!speciesId) return;

    const asset = buildCreature(speciesId, 'high');
    const species = getSpecies(speciesId);
    this.mount = rigged(asset.geometry, createCreatureMaterials(asset.rig), strideFor(speciesId, asset.rig), true);
    // A rideable Pokémon is scaled to carry a person, whatever its dex height.
    const scale = Math.max(1.4, Math.min(2.2, species.height));
    this.mount.group.scale.setScalar(scale);
    const box = asset.geometry.boundingBox!;
    this.mountSaddle = box.max.y * scale * 0.72;
    this.root.add(this.mount.group);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  set visible(value: boolean) {
    this.root.visible = value;
  }

  /**
   * Place and animate for this frame.
   *
   * `yaw` uses the simulation's convention (forward is (sin, 0, -cos)); the
   * models face +Z, hence π − yaw.
   */
  update(x: number, y: number, z: number, yaw: number, speed: number, riding: boolean, onWater: boolean, dt: number): void {
    if (!this.body) return;
    this.setMount(riding ? (onWater ? 'LAPRAS' : 'TAUROS') : null);

    this.root.position.set(x, y, z);
    this.root.rotation.set(0, Math.PI - yaw, 0);

    const advance = (r: Rigged, target: number, phase: number): void => {
      r.gait += (target - r.gait) * Math.min(1, dt * 7);
      r.cycle += dt * r.stride * Math.PI * 2 * (0.35 + Math.min(r.gait, 1.8) * 0.9) * (r.gait > 0.05 ? 1 : 0);
      r.anim.setXYZW(0, r.cycle, r.gait, phase, 0);
      r.anim.needsUpdate = true;
    };

    const seat = this.mount ? this.mountSaddle - this.height * 0.3 : 0;
    if (this.mount) {
      // Seated: the rider sits still; the mount does the walking.
      advance(this.mount, Math.min(2, speed / 8), 1.3);
      advance(this.body, 0, 0.2);
    } else {
      // 4.5 m/s is a walk and 9 a sprint, matching the movement code.
      advance(this.body, Math.min(2, speed / 4.5), 0.2);
    }
    this.body.group.position.set(0, seat, this.mount ? -0.05 : 0);
    if (this.custom) {
      this.custom.object.position.set(0, seat, this.mount ? -0.05 : 0);
      ModelOverrides.animate(this.custom, this.mount ? 0 : Math.min(2, speed / 4.5), dt);
    }
  }

  dispose(): void {
    disposeRigged(this.body);
    disposeRigged(this.mount);
    this.root.removeFromParent();
  }
}
