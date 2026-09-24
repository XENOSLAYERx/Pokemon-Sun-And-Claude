/**
 * Creature rig: bones, and how each one moves.
 *
 * Creatures are not skinned. Every vertex belongs to exactly one rigid "bone"
 * — a group like "front-left leg" or "tail" — and the vertex shader rotates
 * that group about its pivot. That is a fraction of the cost of skinning,
 * needs no skeleton upload per instance, and works with instancing, so a
 * hillside of forty Pikipek is one draw call. What it cannot do is bend a
 * limb in the middle; for this art style that is not missed.
 *
 * The motion itself is procedural: a walk cycle driven by how fast the AI is
 * actually moving, idle sway, wing flaps. A creature that is standing still
 * breathes; one that is fleeing runs.
 */

export const Bone = {
  Root: 0,
  Head: 1,
  LegFrontLeft: 2,
  LegFrontRight: 3,
  LegBackLeft: 4,
  LegBackRight: 5,
  Tail: 6,
  WingLeft: 7,
  WingRight: 8,
  ArmLeft: 9,
  ArmRight: 10,
  /** Follows the head, then adds its own twitch. The one parented bone. */
  Ear: 11,
} as const;

export type Bone = (typeof Bone)[keyof typeof Bone];

export const BONE_COUNT = 12;

/** How a bone is driven. */
export const Motion = {
  /** Swings with the walk cycle; still at rest. Legs, arms. */
  Walk: 0,
  /** Always sways a little, more when moving. Tails, heads, fins. */
  Sway: 1,
  /** Always oscillates at its own rate. Wings, hovering parts. */
  Flap: 2,
  /** Rigid with the body. */
  None: 3,
} as const;

export type Motion = (typeof Motion)[keyof typeof Motion];

export type V3 = readonly [number, number, number];

export interface BoneRig {
  /** Rotation centre, in model space. */
  pivot: V3;
  /** Rotation axis, in model space. Normalised on upload. */
  axis: V3;
  /** Peak rotation, radians. */
  amplitude: number;
  /** Cycles per walk cycle (Walk) or per second (Sway, Flap). */
  frequency: number;
  /** Phase offset, radians. Diagonal leg pairs differ by π. */
  phase: number;
  motion: Motion;
}

export interface RigSpec {
  readonly bones: BoneRig[];
  /** Vertical bounce per step while walking, model units. */
  walkBob: number;
  /** Hover bob for fliers and floaters, model units. */
  hoverBob: number;
  /** Idle breathing, as a scale fraction. */
  breath: number;
  /**
   * Walk cycles per second at gait 1, before the per-species stride scale.
   * Short legs step fast; long legs step slowly.
   */
  strideRate: number;
  /** Does it fly (hover bob, wings always flap)? */
  flies: boolean;
  /** Height of the model's lowest point above its origin, when not flying. */
  groundOffset: number;
  /** How high a flier holds itself above the ground, in model units. */
  hoverHeight: number;
}

export function emptyRig(): RigSpec {
  return {
    bones: Array.from({ length: BONE_COUNT }, () => ({
      pivot: [0, 0, 0] as V3,
      axis: [1, 0, 0] as V3,
      amplitude: 0,
      frequency: 1,
      phase: 0,
      motion: Motion.None,
    })),
    walkBob: 0.03,
    hoverBob: 0,
    breath: 0.018,
    strideRate: 1.6,
    flies: false,
    groundOffset: 0,
    hoverHeight: 0,
  };
}

/** Pack the rig into the flat arrays the shader reads. */
export function packRig(rig: RigSpec): {
  pivots: Float32Array;
  axes: Float32Array;
  params: Float32Array;
  motion: [number, number, number];
} {
  const pivots = new Float32Array(BONE_COUNT * 3);
  const axes = new Float32Array(BONE_COUNT * 3);
  const params = new Float32Array(BONE_COUNT * 4);
  rig.bones.forEach((bone, i) => {
    pivots.set(bone.pivot, i * 3);
    const len = Math.hypot(bone.axis[0], bone.axis[1], bone.axis[2]) || 1;
    axes.set([bone.axis[0] / len, bone.axis[1] / len, bone.axis[2] / len], i * 3);
    params.set([bone.amplitude, bone.frequency, bone.phase, bone.motion], i * 4);
  });
  return { pivots, axes, params, motion: [rig.walkBob, rig.hoverBob, rig.breath] };
}
