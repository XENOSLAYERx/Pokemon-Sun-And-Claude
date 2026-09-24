/**
 * Battle staging in 3D.
 *
 * There is no battle scene to load: the fight happens on the ground the player
 * is already standing on. This module places the two combatants on the arena
 * the session generated, frames them with the shared camera helper, reacts to
 * the engine's event stream — the attacker lunges, the target flinches, a
 * fainted Pokémon collapses — and puts everything back afterwards.
 *
 * It renders; it does not decide. Every position comes from the arena, and
 * every reaction from an event the engine emitted.
 */
import {
  Scene, Group, InstancedMesh, Vector3, PerspectiveCamera, Mesh, RingGeometry, MeshBasicMaterial,
  DoubleSide, Matrix4,
} from 'three';
import { getSpecies } from '@alola/data';
import { cameraRigFor, type BattleArena, type BattleEvent } from '@alola/battle';
import {
  buildCreature, createCreatureMaterials, instancedCopy, strideFor, type CreatureMaterials,
} from '@alola/render';
import type { BattleSession, TurnResult } from '@alola/game';
import { Box3, type InstancedBufferAttribute } from 'three';
import { ModelOverrides, type ModelInstance } from './model-overrides.ts';

/** Camera pitch per rig, in radians above the horizon. */
const RIG_PITCH: Record<string, number> = {
  'open-field': 0.30,
  'enclosed': 0.16,
  'aquatic': 0.13,
  'cliff': 0.36,
  'confined': 0.22,
};

type Reaction = 'lunge' | 'flinch' | 'faint' | 'enter';

interface Combatant {
  readonly group: Group;
  readonly anim: InstancedBufferAttribute;
  readonly materials: CreatureMaterials;
  readonly height: number;
  readonly radius: number;
  readonly hover: number;
  readonly stride: number;
  readonly home: Vector3;
  readonly facing: number;
  /** +1 player side, -1 foe side: which way "forward" is along the axis. */
  readonly sign: number;
  cycle: number;
  /** Set when a drop-in glTF model replaces the procedural one. */
  custom: ModelInstance | null;
  reaction: Reaction | null;
  reactionTime: number;
  delay: number;
  fainted: boolean;
}

const REACTION_LENGTH: Record<Reaction, number> = { lunge: 0.5, flinch: 0.45, faint: 0.9, enter: 0.45 };

export class BattleStage {
  private readonly scene: Scene;
  private readonly root = new Group();
  private player: Combatant | null = null;
  private foe: Combatant | null = null;
  private arena: BattleArena | null = null;
  private axis = new Vector3(1, 0, 0);
  private centre = new Vector3();
  private separation = 4;
  private blend = 0;
  private playerBattleId = -1;
  private overrides: ModelOverrides | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.root.visible = false;
    this.scene.add(this.root);
  }

  /** Drop-in glTF models to use for combatants, where they exist. */
  setOverrides(overrides: ModelOverrides): void {
    this.overrides = overrides;
  }

  get active(): boolean {
    return this.arena !== null;
  }

  /** Build one combatant: the real model, its outline, a team ring. */
  private combatant(speciesId: string, scale: number, sign: number, ringColor: number): Combatant {
    const species = getSpecies(speciesId);
    const asset = buildCreature(speciesId, 'high');
    const materials = createCreatureMaterials(asset.rig);
    const { geometry, anim } = instancedCopy(asset.geometry, 1);
    const identity = new Matrix4();

    const body = new InstancedMesh(geometry, materials.body, 1);
    body.setMatrixAt(0, identity);
    body.castShadow = true;
    body.customDepthMaterial = materials.depth;
    body.frustumCulled = false;
    const outline = new InstancedMesh(geometry, materials.outline, 1);
    outline.instanceMatrix = body.instanceMatrix;
    outline.frustumCulled = false;

    const height = species.height * scale;
    const group = new Group();
    const model = new Group();
    const loaded = this.overrides?.species(speciesId) ?? null;
    const custom = loaded ? ModelOverrides.instantiate(loaded) : null;
    if (custom) model.add(custom.object);
    else model.add(body, outline);
    model.scale.setScalar(height);
    model.position.y = asset.rig.flies ? asset.rig.hoverHeight * height : 0;
    group.add(model);

    const box = custom ? new Box3().setFromObject(custom.object) : asset.geometry.boundingBox!;
    const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 * height;
    const ring = new Mesh(
      new RingGeometry(radius * 1.15 + 0.05, radius * 1.35 + 0.08, 32),
      new MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.55, side: DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);

    return {
      group, anim, materials, height, radius,
      hover: asset.rig.flies ? asset.rig.hoverHeight : 0,
      stride: strideFor(speciesId, asset.rig),
      home: new Vector3(), facing: 0, sign,
      cycle: 0, custom, reaction: 'enter', reactionTime: 0, delay: 0, fainted: false,
    };
  }

  private place(c: Combatant): void {
    const home = this.centre.clone().addScaledVector(this.axis, -c.sign * this.separation * 0.5);
    (c as { home: Vector3 }).home.copy(home);
    // Models face +Z; face the opponent along the axis.
    const toward = this.axis.clone().multiplyScalar(c.sign);
    (c as { facing: number }).facing = Math.atan2(toward.x, toward.z);
    c.group.position.copy(home);
    c.group.rotation.y = c.facing;
    this.root.add(c.group);
  }

  private disposeCombatant(c: Combatant | null): void {
    if (!c) return;
    this.root.remove(c.group);
    c.group.traverse((o) => {
      const mesh = o as Mesh;
      if ((mesh as { isInstancedMesh?: boolean }).isInstancedMesh) (mesh as unknown as InstancedMesh).dispose();
      else if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      }
    });
    c.materials.dispose();
  }

  begin(session: BattleSession, playerPosition: { x: number; z: number }): void {
    this.arena = session.arena;
    this.blend = 0;
    const arena = session.arena;
    const dx = arena.x - playerPosition.x;
    const dz = arena.z - playerPosition.z;
    const length = Math.hypot(dx, dz);
    this.axis = length > 0.01 ? new Vector3(dx / length, 0, dz / length) : new Vector3(1, 0, 0);
    this.centre.set(arena.x, arena.y, arena.z);

    this.player = this.combatant(session.playerActive.speciesId, session.playerActive.scale, 1, 0x6fb4ff);
    this.foe = this.combatant(session.foeActive.speciesId, session.foeActive.scale, -1, 0xff8a6f);
    this.playerBattleId = session.playerActive.id;

    // Separation scales with the combatants, not the arena. A fixed gap reads
    // fine for a Totem and leaves two small Pokémon as specks, because the
    // framing then fits the gap rather than the fighters.
    const reach = this.player.radius + this.foe.radius;
    const largest = Math.max(this.player.height, this.foe.height);
    this.separation = Math.min(Math.max(largest * 2.6, reach * 2 + 0.5, 1.3), arena.radius * 0.8, 14);

    this.place(this.player);
    this.place(this.foe);
    this.root.visible = true;
  }

  /** Swap the player's combatant after a switch or a replacement. */
  private swapPlayer(session: BattleSession): void {
    const active = session.playerActive;
    if (active.id === this.playerBattleId || !this.player) return;
    this.disposeCombatant(this.player);
    this.player = this.combatant(active.speciesId, active.scale, 1, 0x6fb4ff);
    this.playerBattleId = active.id;
    this.place(this.player);
  }

  private sideOf(session: BattleSession, id: number): Combatant | null {
    const p = session.state.pokemon.get(id);
    if (!p) return null;
    return p.side === 0 ? this.player : this.foe;
  }

  private trigger(c: Combatant | null, reaction: Reaction, delay: number): void {
    if (!c) return;
    if (c.fainted && reaction !== 'enter') return;
    c.reaction = reaction;
    c.reactionTime = 0;
    c.delay = delay;
    if (reaction === 'faint') c.fainted = true;
  }

  /**
   * React to a resolved turn, in the order the engine emitted it: each move
   * is a lunge, its hit a flinch a beat later, a faint after that.
   */
  react(session: BattleSession, result: TurnResult): void {
    let t = 0;
    for (const event of result.events as readonly BattleEvent[]) {
      switch (event.type) {
        case 'switch-in':
          if (event.side === 0) this.swapPlayer(session);
          break;
        case 'move-used':
          this.trigger(this.sideOf(session, event.userId), 'lunge', t);
          t += 0.18;
          break;
        case 'damage':
          this.trigger(this.sideOf(session, event.targetId), 'flinch', t);
          t += 0.3;
          break;
        case 'faint':
          this.trigger(this.sideOf(session, event.pokemonId), 'faint', t + 0.2);
          t += 0.5;
          break;
      }
    }
    // A switch outside an event (replacing a fainted Pokémon) still swaps.
    this.swapPlayer(session);
  }

  /** Advance reactions and idle animation. Call once per frame. */
  update(dt: number): void {
    if (!this.arena) return;
    for (const c of [this.player, this.foe]) {
      if (!c) continue;
      let offset = 0;
      let tilt = 0;
      let sink = 0;
      let grow = 1;
      let gait = 0;

      if (c.reaction) {
        if (c.delay > 0) {
          c.delay -= dt;
        } else {
          c.reactionTime += dt;
          const k = Math.min(1, c.reactionTime / REACTION_LENGTH[c.reaction]);
          switch (c.reaction) {
            case 'lunge': {
              // Out fast, back slower.
              const out = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
              offset = Math.sin(out * Math.PI * 0.5) * this.separation * 0.32;
              gait = 1.6;
              break;
            }
            case 'flinch':
              offset = -Math.sin(k * Math.PI) * c.radius * 0.6;
              tilt = Math.sin(k * Math.PI * 3) * 0.12 * (1 - k);
              break;
            case 'faint':
              tilt = -k * 1.25;
              sink = k * c.height * 0.3;
              break;
            case 'enter':
              grow = 0.2 + 0.8 * (1 - Math.pow(1 - k, 3));
              break;
          }
          if (k >= 1 && c.reaction !== 'faint') c.reaction = null;
        }
      }
      if (c.fainted && c.reaction === null) {
        tilt = -1.25;
        sink = c.height * 0.3;
      }

      c.cycle += dt * c.stride * Math.PI * 2 * (gait > 0 ? 1.4 : 0);
      c.anim.setXYZW(0, c.cycle, gait, c.sign > 0 ? 0.4 : 2.1, 0);
      c.anim.needsUpdate = true;
      if (c.custom) ModelOverrides.animate(c.custom, gait, dt);

      c.group.position.copy(c.home).addScaledVector(this.axis, c.sign * offset);
      c.group.position.y = this.arena.y - sink;
      c.group.rotation.set(tilt, c.facing, 0, 'YXZ');
      c.group.scale.setScalar(grow);
    }
  }

  /**
   * Where the camera should be this frame. Eased in so the move from
   * exploring to fighting is a move, not a cut.
   */
  cameraFor(camera: PerspectiveCamera, dt: number): { position: Vector3; lookAt: Vector3 } | null {
    if (!this.arena || !this.player || !this.foe) return null;
    this.blend = Math.min(1, this.blend + dt * 1.6);

    // The classic battle three-quarter view: the player's Pokémon near and to
    // one side, seen from behind; the opponent across the arena, seen from the
    // front. Both end up a similar size on screen, which a camera straight
    // down the axis cannot manage — it puts one fighter twice as far away as
    // the other.
    const extent = Math.max(this.player.height, this.foe.height, this.player.radius * 2, this.foe.radius * 2);
    const focus = this.centre.clone().setY(this.arena.y + extent * 0.45);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const fit = Math.min(vFov, hFov * 0.9);
    const required = this.separation * 0.5 + extent * 0.9;
    // Fitted to the fighters themselves. The shared framing helper floors at
    // 5m, which suits a Totem and leaves two 0.4m Pokémon as specks.
    const distance = Math.max(1.4, (required / Math.tan(fit / 2)) * 1.05);
    const pitch = RIG_PITCH[cameraRigFor(this.arena)] ?? 0.3;

    const side = new Vector3(-this.axis.z, 0, this.axis.x);
    const direction = this.axis.clone().multiplyScalar(-0.72).addScaledVector(side, 0.95).normalize();
    const position = focus.clone()
      .addScaledVector(direction, Math.cos(pitch) * distance)
      .setY(focus.y + Math.sin(pitch) * distance);
    // Aim a touch below centre so the fighters sit above the action dock.
    const lookAt = focus.clone().setY(focus.y - distance * 0.09);
    return { position, lookAt };
  }

  get transition(): number {
    return this.blend;
  }

  end(): void {
    this.disposeCombatant(this.player);
    this.disposeCombatant(this.foe);
    this.player = null;
    this.foe = null;
    this.arena = null;
    this.root.visible = false;
    this.blend = 0;
    this.playerBattleId = -1;
  }
}
