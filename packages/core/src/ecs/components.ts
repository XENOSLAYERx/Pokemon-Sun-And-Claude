/**
 * Components shared across every package.
 *
 * Package-specific components (battle state, quest markers) live with their
 * own package; these are the ones that more than one system must agree on.
 *
 * Every component is a plain object — no methods, no prototypes — so the whole
 * world is structured-clonable for Worker transfer and JSON-able for saves.
 */
import { defineComponent } from './world.ts';
import { vec3, type Vec3 } from '../math/vec3.ts';

/** Position, orientation and scale in world space. */
export interface TransformData {
  position: Vec3;
  /** Yaw in radians. Pokémon are upright; full quaternions are only needed for
   *  flyers and ragdolls, which carry an extra component. */
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
}
export const Transform = defineComponent<TransformData>('Transform', () => ({
  position: vec3(),
  yaw: 0,
  pitch: 0,
  roll: 0,
  scale: 1,
}));

/** Previous transform, captured each tick so rendering can interpolate. */
export interface PrevTransformData {
  position: Vec3;
  yaw: number;
}
export const PrevTransform = defineComponent<PrevTransformData>('PrevTransform', () => ({
  position: vec3(),
  yaw: 0,
}));

/** Linear motion state. */
export interface VelocityData {
  linear: Vec3;
  /** Yaw rate, radians/sec. */
  angular: number;
}
export const Velocity = defineComponent<VelocityData>('Velocity', () => ({
  linear: vec3(),
  angular: 0,
}));

/** Locomotion tuning — how an agent is *allowed* to move. */
export interface LocomotionData {
  walkSpeed: number;
  runSpeed: number;
  /** Max yaw change per second, radians. Low = ponderous (Mudsdale), high = darty (Yungoos). */
  turnRate: number;
  acceleration: number;
  /** Which media this agent can traverse. */
  canSwim: boolean;
  canFly: boolean;
  canClimb: boolean;
  /** Steepest walkable slope, in radians. */
  maxSlope: number;
  /** Current movement medium, set by the locomotion system. */
  medium: 'ground' | 'water' | 'air' | 'lava';
  grounded: boolean;
}
export const Locomotion = defineComponent<LocomotionData>('Locomotion', () => ({
  walkSpeed: 2.2,
  runSpeed: 5.5,
  turnRate: 3.2,
  acceleration: 12,
  canSwim: false,
  canFly: false,
  canClimb: false,
  maxSlope: 0.9,
  medium: 'ground',
  grounded: true,
}));

/** Marks the entity the local player controls. */
export interface PlayerTagData {
  /** Stable player id — matters for multiplayer and for save ownership. */
  playerId: string;
}
export const PlayerTag = defineComponent<PlayerTagData>('PlayerTag', () => ({ playerId: 'local' }));

/** A Pokémon existing in the overworld (as distinct from one in a party/box). */
export interface WildPokemonData {
  speciesId: string;
  /** Form index — Alolan forms, Oricorio styles, etc. */
  form: number;
  level: number;
  shiny: boolean;
  /** Alpha/Totem-sized individuals: larger, stronger, aggressive. */
  alpha: boolean;
  /** Visual size multiplier, 0.85..1.15 normally. */
  sizeScale: number;
  gender: 'male' | 'female' | 'genderless';
  /** Personality value — drives IVs, nature and cosmetic variation deterministically. */
  personality: number;
  /** Chunk this Pokémon belongs to; despawns with it. */
  homeChunk: number;
}
export const WildPokemon = defineComponent<WildPokemonData>('WildPokemon', () => ({
  speciesId: 'MISSINGNO',
  form: 0,
  level: 1,
  shiny: false,
  alpha: false,
  sizeScale: 1,
  gender: 'genderless',
  personality: 0,
  homeChunk: -1,
}));

/** Vital statistics for anything that can be damaged in the overworld. */
export interface HealthData {
  current: number;
  max: number;
  /** Set when fainted; the despawn system collects these. */
  fainted: boolean;
}
export const Health = defineComponent<HealthData>('Health', () => ({ current: 1, max: 1, fainted: false }));

/**
 * Simulation level-of-detail.
 *
 * The single most important optimisation in the world simulation: a Pokémon
 * 800m away does not need perception, pathfinding or animation. It needs a
 * position that drifts plausibly so that when the player approaches, it is
 * where it should be.
 */
export const SimLod = {
  /** Full AI, full animation, full physics. Within ~60m. */
  Full: 0,
  /** Behaviour ticks at reduced rate, no fine steering. ~60–180m. */
  Reduced: 1,
  /** Position advances on a coarse schedule only. ~180–500m. */
  Coarse: 2,
  /** Not simulated; state is a summary. Beyond ~500m. */
  Dormant: 3,
} as const;

export type SimLod = (typeof SimLod)[keyof typeof SimLod];
export interface SimLodData {
  level: SimLod;
  /** Distance to nearest observer, cached by the LOD system. */
  distanceToObserver: number;
  /** Ticks to skip before the next behaviour update — staggered to avoid spikes. */
  tickOffset: number;
}
export const SimLodComponent = defineComponent<SimLodData>('SimLod', () => ({
  level: SimLod.Full,
  distanceToObserver: 0,
  tickOffset: 0,
}));

/** Human-readable name, for debugging overlays and NPC dialogue. */
export interface NameData {
  value: string;
}
export const Name = defineComponent<NameData>('Name', () => ({ value: '' }));

/** Marks an entity for destruction at the end of the tick. */
export const Despawning = defineComponent<{ reason: string }>('Despawning', () => ({ reason: 'unspecified' }));

/** An axis-aligned interaction volume. Triggers, trial gates, encounter zones. */
export interface TriggerVolumeData {
  halfExtents: Vec3;
  /** Identifier the gameplay layer keys behaviour off. */
  triggerId: string;
  /** Only fire once per save. */
  once: boolean;
  fired: boolean;
  /** Who can trip it. */
  filter: 'player' | 'pokemon' | 'any';
}
export const TriggerVolume = defineComponent<TriggerVolumeData>('TriggerVolume', () => ({
  halfExtents: vec3(2, 2, 2),
  triggerId: '',
  once: false,
  fired: false,
  filter: 'player',
}));
