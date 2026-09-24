/**
 * Assembly kit for creature models: the recurring parts (legs, arms, rig
 * wiring) so a species definition only has to say what makes it distinctive.
 */
import { Bone, Motion, type RigSpec, type V3 } from './rig.ts';
import { ModelBuilder, hex, type RGB } from './geometry.ts';

export type CreatureModel = (b: ModelBuilder, rig: RigSpec) => void;

// ----------------------------------------------------------------- rigging

export function swing(rig: RigSpec, bone: Bone, pivot: V3, phase: number, amplitude = 0.55, axis: V3 = [1, 0, 0]): void {
  rig.bones[bone] = { pivot, axis, amplitude, frequency: 1, phase, motion: Motion.Walk };
}

export function sway(rig: RigSpec, bone: Bone, pivot: V3, amplitude: number, frequency: number, axis: V3 = [0, 1, 0], phase = 0): void {
  rig.bones[bone] = { pivot, axis, amplitude, frequency, phase, motion: Motion.Sway };
}

export function flap(rig: RigSpec, bone: Bone, pivot: V3, amplitude: number, frequency: number, axis: V3, phase = 0): void {
  rig.bones[bone] = { pivot, axis, amplitude, frequency, phase, motion: Motion.Flap };
}

/** A gentle look-around on the head. Almost every species wants one. */
export function headLook(rig: RigSpec, pivot: V3, amplitude = 0.12, frequency = 0.9): void {
  sway(rig, Bone.Head, pivot, amplitude, frequency, [0.15, 1, 0]);
}

// -------------------------------------------------------------- assemblies

export interface LegSpec {
  /** Half the distance between left and right legs. */
  readonly x: number;
  /** Where the leg meets the body. */
  readonly hipY: number;
  readonly frontZ: number;
  readonly backZ: number;
  readonly thickness: number;
  readonly color: RGB;
  readonly paw?: RGB;
  /** Taper toward the foot, 0-1. */
  readonly taper?: number;
  readonly amplitude?: number;
}

/** Four legs, trotting: diagonal pairs move together. */
export function quadLegs(b: ModelBuilder, rig: RigSpec, s: LegSpec): void {
  const taper = s.taper ?? 0.8;
  const legs: [Bone, number, number, number][] = [
    [Bone.LegFrontLeft, s.x, s.frontZ, 0],
    [Bone.LegFrontRight, -s.x, s.frontZ, Math.PI],
    [Bone.LegBackLeft, s.x, s.backZ, Math.PI],
    [Bone.LegBackRight, -s.x, s.backZ, 0],
  ];
  for (const [bone, x, z, phase] of legs) {
    const hip: V3 = [x, s.hipY, z];
    const foot: V3 = [x, s.thickness * taper, z + s.thickness * 0.15];
    b.limb(hip, foot, s.thickness, s.thickness * taper, s.color, bone);
    if (s.paw) {
      b.ellipsoid([x, s.thickness * taper * 0.8, z + s.thickness * 0.35], [s.thickness * 1.05, s.thickness * 0.6, s.thickness * 1.25], s.paw, bone);
    }
    swing(rig, bone, hip, phase, s.amplitude ?? 0.5);
  }
}

/** Two legs, alternating. Uses the back-leg bones. */
export function bipedLegs(b: ModelBuilder, rig: RigSpec, s: {
  x: number; hipY: number; z?: number; thickness: number; color: RGB;
  foot?: RGB; footLength?: number; amplitude?: number;
}): void {
  const z = s.z ?? 0;
  for (const [bone, x, phase] of [[Bone.LegBackLeft, s.x, 0], [Bone.LegBackRight, -s.x, Math.PI]] as const) {
    const hip: V3 = [x, s.hipY, z];
    b.limb(hip, [x, s.thickness * 0.9, z], s.thickness, s.thickness * 0.9, s.color, bone);
    const footLength = s.footLength ?? s.thickness * 1.6;
    b.ellipsoid([x, s.thickness * 0.55, z + footLength * 0.35], [s.thickness * 1.05, s.thickness * 0.6, footLength], s.foot ?? s.color, bone);
    swing(rig, bone, hip, phase, s.amplitude ?? 0.6);
  }
}

/** Two arms, swinging opposite the legs. */
export function arms(b: ModelBuilder, rig: RigSpec, s: {
  x: number; shoulderY: number; z?: number; length: number; thickness: number; color: RGB;
  hand?: RGB; spread?: number; forward?: number; amplitude?: number;
}): void {
  const z = s.z ?? 0;
  const spread = s.spread ?? 0.25;
  const forward = s.forward ?? 0.2;
  for (const [bone, side, phase] of [[Bone.ArmLeft, 1, Math.PI], [Bone.ArmRight, -1, 0]] as const) {
    const shoulder: V3 = [s.x * side, s.shoulderY, z];
    const hand: V3 = [
      s.x * side + Math.sin(spread) * s.length * side,
      s.shoulderY - Math.cos(spread) * s.length,
      z + forward * s.length,
    ];
    b.limb(shoulder, hand, s.thickness, s.thickness * 0.85, s.color, bone);
    if (s.hand) b.ellipsoid(hand, [s.thickness * 1.15, s.thickness * 1.15, s.thickness * 1.15], s.hand, bone);
    swing(rig, bone, shoulder, phase, s.amplitude ?? 0.45);
  }
}

/**
 * A curving chain of limb segments — tails, necks, tentacles, cables.
 * Every segment goes on the same bone so the whole chain sways as one.
 */
export function chain(b: ModelBuilder, points: readonly V3[], radii: readonly number[], color: RGB, bone: Bone, tipColor?: RGB, tipFrom = 1): void {
  for (let i = 0; i < points.length - 1; i++) {
    const c = tipColor && i >= points.length - 1 - tipFrom ? tipColor : color;
    b.limb(points[i], points[i + 1], radii[i], radii[i + 1], c, bone);
  }
}

/** Small round cheek or marking on a surface. */
export function spot(b: ModelBuilder, at: V3, radius: number, color: RGB, bone: Bone, facing: V3 = [0, 0, 0]): void {
  b.ellipsoid(at, [radius, radius * 0.9, radius * 0.35], color, bone, facing);
}

/** A default for species with no bespoke model yet — never a capsule. */
export function genericCreature(primary: RGB, secondary: RGB): CreatureModel {
  return (b, rig) => {
    b.ellipsoid([0, 0.38, 0], [0.26, 0.24, 0.3], primary, Bone.Root);
    b.ellipsoid([0, 0.46, -0.05], [0.2, 0.16, 0.22], secondary, Bone.Root);
    b.ellipsoid([0, 0.7, 0.14], [0.2, 0.19, 0.19], primary, Bone.Head);
    b.eyes([0, 0.72, 0.14], [0.2, 0.19, 0.19], { spread: 0.45, lift: 0.15, size: 0.035 });
    headLook(rig, [0, 0.6, 0.1]);
    quadLegs(b, rig, { x: 0.14, hipY: 0.3, frontZ: 0.14, backZ: -0.15, thickness: 0.07, color: primary });
  };
}

export { hex, Bone };
