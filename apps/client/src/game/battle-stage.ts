/**
 * Battle staging in 3D.
 *
 * There is no battle scene to load: the fight happens on the ground the player
 * is already standing on. This module places the two combatants on the arena
 * the session generated, frames them with the shared camera helper, and puts
 * everything back afterwards.
 *
 * It renders — it does not decide. Every position here comes from the arena
 * the simulation produced.
 */
import {
  Scene, Mesh, Object3D, Box3, CapsuleGeometry, MeshStandardMaterial, Vector3, PerspectiveCamera,
  Group, RingGeometry, MeshBasicMaterial, DoubleSide,
} from 'three';
import { getSpecies } from '@alola/data';
import { cameraRigFor, type BattleArena } from '@alola/battle';
import { frameBattle } from '@alola/render';
import type { BattleSession } from '@alola/game';
import { loadPokemonModel } from './pokemon-models.ts';

const TYPE_COLORS: Record<string, number> = {
  normal: 0xa8a878, fire: 0xf08030, water: 0x6890f0, electric: 0xf8d030,
  grass: 0x78c850, ice: 0x98d8d8, fighting: 0xc03028, poison: 0xa040a0,
  ground: 0xe0c068, flying: 0xa890f0, psychic: 0xf85888, bug: 0xa8b820,
  rock: 0xb8a038, ghost: 0x705898, dragon: 0x7038f8, dark: 0x705848,
  steel: 0xb8b8d0, fairy: 0xee99ac,
};

/** Camera pitch per rig, in radians above the horizon. */
const RIG_PITCH: Record<string, number> = {
  'open-field': 0.30,
  'enclosed': 0.16,
  'aquatic': 0.13,
  'cliff': 0.36,
  'confined': 0.22,
};

/** The placeholder shown immediately, and permanently for any species with no model. */
function capsuleFor(speciesId: string, scale: number): Mesh {
  const species = getSpecies(speciesId);
  const height = Math.max(0.3, Math.min(6, species.height)) * scale;
  const radius = Math.max(0.14, Math.min(Math.cbrt(species.weight) * 0.055, height * 0.42));
  const mesh = new Mesh(
    new CapsuleGeometry(radius, Math.max(0.05, height - radius * 2), 6, 12),
    new MeshStandardMaterial({
      color: TYPE_COLORS[species.types[0]] ?? 0xcccccc,
      roughness: 0.65,
      metalness: 0.05,
    }),
  );
  mesh.castShadow = true;
  mesh.userData.height = height;
  mesh.userData.radius = radius;
  mesh.userData.disposable = true;
  return mesh;
}

export interface StagedCamera {
  readonly position: Vector3;
  readonly lookAt: Vector3;
}

export class BattleStage {
  private readonly scene: Scene;
  private readonly group = new Group();
  private playerMon: Object3D | null = null;
  private foeMon: Object3D | null = null;
  private arena: BattleArena | null = null;
  private axis = new Vector3(1, 0, 0);

  /** Blend factor from the overworld camera to the battle camera, 0-1. */
  private blend = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.visible = false;
    this.scene.add(this.group);
  }

  get active(): boolean {
    return this.arena !== null;
  }

  /**
   * Place the combatants.
   *
   * They face along the axis from the player to the wild Pokémon, so the fight
   * is oriented the way the player approached it rather than snapped to a
   * fixed compass direction.
   */
  begin(session: BattleSession, playerPosition: { x: number; z: number }): void {
    this.arena = session.arena;
    this.blend = 0;

    const arena = session.arena;
    const dx = arena.x - playerPosition.x;
    const dz = arena.z - playerPosition.z;
    const length = Math.hypot(dx, dz);
    this.axis = length > 0.01 ? new Vector3(dx / length, 0, dz / length) : new Vector3(1, 0, 0);

    const centre = new Vector3(arena.x, arena.y, arena.z);

    this.playerMon = capsuleFor(session.playerActive.speciesId, session.playerActive.scale);
    this.foeMon = capsuleFor(session.foeActive.speciesId, session.foeActive.scale);

    // Separation scales with the combatants, not with the arena. A fixed 9m
    // gap reads fine for a Totem and leaves two 0.4m Pokemon as specks in the
    // middle of a field, because `frameBattle` then pulls the camera back far
    // enough to fit the *gap* rather than the fighters.
    const largest = Math.max(
      this.playerMon.userData.height as number,
      this.foeMon.userData.height as number,
    );
    const separation = Math.min(Math.max(largest * 4.5, 2.6), arena.radius * 0.78, 14);

    const place = (mesh: Object3D, sign: number): void => {
      mesh.position.copy(centre).addScaledVector(this.axis, sign * separation * 0.5);
      mesh.position.y = arena.y + (mesh.userData.height as number) / 2;
      // Face the opponent.
      mesh.rotation.y = Math.atan2(-sign * this.axis.x, -sign * this.axis.z);
      this.group.add(mesh);

      const ring = new Mesh(
        new RingGeometry((mesh.userData.radius as number) * 1.5, (mesh.userData.radius as number) * 1.8, 24),
        new MeshBasicMaterial({ color: sign < 0 ? 0x6fb4ff : 0xff8a6f, transparent: true, opacity: 0.5, side: DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(mesh.position.x, arena.y + 0.03, mesh.position.z);
      ring.userData.disposable = true;
      this.group.add(ring);
    };

    place(this.playerMon, -1);
    place(this.foeMon, 1);
    this.applyModel('player', session.playerActive.speciesId, this.playerMon);
    this.applyModel('foe', session.foeActive.speciesId, this.foeMon);
    this.group.visible = true;
  }

  /**
   * Swap a placeholder capsule for its real model, if one exists.
   *
   * The capsule is already placed and visible by the time this resolves, so
   * a slow or missing fetch never delays the battle — it just leaves the
   * capsule up. `placeholder` is captured by reference: if a switch, a
   * faint, or `end()` has since moved the slot on to something else, this
   * silently drops the now-stale swap instead of clobbering it.
   */
  private applyModel(target: 'player' | 'foe', speciesId: string, placeholder: Object3D): void {
    loadPokemonModel(speciesId).then((scene) => {
      if (!scene) return;
      const current = target === 'player' ? this.playerMon : this.foeMon;
      if (current !== placeholder) return;

      const height = placeholder.userData.height as number;
      const radius = placeholder.userData.radius as number;

      const size = new Box3().setFromObject(scene).getSize(new Vector3());
      if (size.y > 0) scene.scale.multiplyScalar(height / size.y);
      // Re-centre so the wrapper's origin sits at the model's midpoint, the
      // same convention the capsule uses — everything else here positions by
      // that assumption.
      scene.position.sub(new Box3().setFromObject(scene).getCenter(new Vector3()));

      const wrapper = new Group();
      wrapper.add(scene);
      wrapper.userData.height = height;
      wrapper.userData.radius = radius;
      wrapper.position.copy(placeholder.position);
      wrapper.rotation.y = placeholder.rotation.y;
      wrapper.traverse((child) => {
        if ((child as Mesh).isMesh) child.castShadow = true;
      });

      this.group.remove(placeholder);
      this.disposeIfOwned(placeholder);
      this.group.add(wrapper);

      if (target === 'player') this.playerMon = wrapper;
      else this.foeMon = wrapper;
    });
  }

  /** Only frees resources this stage created itself — a loaded model's are cache-owned. */
  private disposeIfOwned(obj: Object3D): void {
    if (!obj.userData.disposable) return;
    const mesh = obj as Mesh;
    mesh.geometry?.dispose();
    (mesh.material as MeshStandardMaterial | undefined)?.dispose();
  }

  /** Swap the player's combatant model, after a switch or a faint. */
  setPlayerSpecies(speciesId: string, scale: number): void {
    if (!this.playerMon || !this.arena) return;
    const old = this.playerMon;
    const replacement = capsuleFor(speciesId, scale);
    replacement.position.copy(old.position);
    replacement.position.y = this.arena.y + (replacement.userData.height as number) / 2;
    replacement.rotation.y = old.rotation.y;
    this.group.remove(old);
    this.disposeIfOwned(old);
    this.group.add(replacement);
    this.playerMon = replacement;
    this.applyModel('player', speciesId, replacement);
  }

  /**
   * Where the camera should be this frame.
   *
   * Eased in over the first moments so the transition from exploring to
   * fighting is a move, not a cut — the brief asks for seamless battles and a
   * hard cut is the one thing that would break it.
   */
  cameraFor(camera: PerspectiveCamera, dt: number): StagedCamera | null {
    if (!this.arena || !this.playerMon || !this.foeMon) return null;
    this.blend = Math.min(1, this.blend + dt * 1.6);

    const framing = frameBattle(
      this.playerMon.position,
      (this.playerMon.userData.radius as number) * 2,
      this.foeMon.position,
      (this.foeMon.userData.radius as number) * 2,
      camera.fov,
      camera.aspect,
    );

    const rig = cameraRigFor(this.arena);
    const pitch = RIG_PITCH[rig] ?? 0.3;

    // Sit behind and slightly to the side of the player's Pokémon, looking
    // down the axis toward the opponent — the classic over-the-shoulder
    // three-quarter view, derived rather than hand-placed.
    const back = this.axis.clone().multiplyScalar(-1);
    const side = new Vector3(-this.axis.z, 0, this.axis.x).multiplyScalar(0.42);
    const direction = back.add(side).normalize();

    // `frameBattle` fits the pair with headroom on all sides and floors the
    // distance at 5m, which is right for a Totem and too far for a pair of
    // 0.4m creatures. Pull in, but never inside the pair itself.
    const midHeight = Math.max(
      this.playerMon.userData.height as number,
      this.foeMon.userData.height as number,
    );
    const distance = Math.max(3.2, framing.distance * 0.82);

    const horizontal = Math.cos(pitch) * distance;
    const position = framing.focus.clone()
      .addScaledVector(direction, horizontal)
      .setY(framing.focus.y + Math.sin(pitch) * distance + midHeight * 0.9);

    // Aim below the combatants so they sit in the upper two-thirds of the
    // frame. The action dock occupies the bottom of the screen, and a subject
    // centred vertically is a subject half behind the battle log.
    const frameLift = distance * 0.17;
    return {
      position,
      lookAt: framing.focus.clone().setY(framing.focus.y + midHeight * 0.5 - frameLift),
    };
  }

  /** Smoothing weight for this frame — low at the start, so the move eases in. */
  get transition(): number {
    return this.blend;
  }

  end(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      this.disposeIfOwned(child);
    }
    this.group.visible = false;
    this.playerMon = null;
    this.foeMon = null;
    this.arena = null;
    this.blend = 0;
  }
}
