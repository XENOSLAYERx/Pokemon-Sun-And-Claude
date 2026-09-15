/**
 * Z-Move cinematic director.
 *
 * Turns a Z-Move's authored beat timeline into a frame-by-frame schedule the
 * presentation layer plays back, and evaluates the player's pose performance.
 *
 * The pose is the part that makes a Z-Move feel like the player did something
 * rather than watched something. The input window is generous (1.5–2.8s) and
 * a miss is never a failure — it costs power, which keeps the moment
 * celebratory rather than punishing.
 */
import { clamp01 } from '@alola/core';
import { getZMove, zMoveDuration, type ZMoveDefinition, type ZMoveBeat } from '@alola/data';
import type { BattleArena } from '../engine/state.ts';
import { resolveEnvironmentReactions, cameraRigFor } from '../arena/arena.ts';

export interface PoseInput {
  /** The button pressed. */
  readonly input: string;
  /** Seconds from the start of the pose window. */
  readonly at: number;
}

export interface PoseResult {
  /** 0–1. 1 = a perfect performance. */
  readonly accuracy: number;
  /** How many inputs were correct and in order. */
  readonly correct: number;
  readonly total: number;
  /** Power multiplier applied to the Z-Move. */
  readonly powerMultiplier: number;
  readonly rating: 'perfect' | 'great' | 'good' | 'missed';
}

/**
 * Evaluate a pose performance.
 *
 * Scoring is forgiving by design: getting the sequence right at all gives full
 * power, and timing only separates "perfect" from "great" for the flourish.
 * The failure case still delivers 85% power — a Z-Move should never feel like
 * a wasted resource because of a fumbled input.
 */
export function evaluatePose(zMove: ZMoveDefinition, inputs: readonly PoseInput[]): PoseResult {
  const expected = zMove.pose.inputs;
  const total = expected.length;

  let correct = 0;
  let expectedIndex = 0;
  let lastTime = 0;
  let timingSum = 0;

  for (const input of inputs) {
    if (expectedIndex >= total) break;
    if (input.at > zMove.pose.window) break;

    if (input.input === expected[expectedIndex]) {
      correct++;
      // Reward even spacing — a rhythmic performance, not a mash.
      const gap = input.at - lastTime;
      const idealGap = zMove.pose.window / total;
      timingSum += 1 - clamp01(Math.abs(gap - idealGap) / idealGap);
      lastTime = input.at;
      expectedIndex++;
    }
    // A wrong input is simply ignored rather than resetting the sequence:
    // resetting punishes a slip far more than the mechanic warrants.
  }

  const sequenceAccuracy = total > 0 ? correct / total : 1;
  const timingAccuracy = correct > 0 ? timingSum / correct : 0;
  const accuracy = sequenceAccuracy * 0.75 + timingAccuracy * 0.25;

  let rating: PoseResult['rating'];
  let powerMultiplier: number;

  if (sequenceAccuracy >= 1 && timingAccuracy > 0.8) {
    rating = 'perfect';
    powerMultiplier = 1.1;
  } else if (sequenceAccuracy >= 1) {
    rating = 'great';
    powerMultiplier = 1.0;
  } else if (sequenceAccuracy >= 0.5) {
    rating = 'good';
    powerMultiplier = 0.95;
  } else {
    rating = 'missed';
    powerMultiplier = 0.85;
  }

  return { accuracy, correct, total, powerMultiplier, rating };
}

export interface ScheduledBeat extends ZMoveBeat {
  /** Beat index. */
  readonly index: number;
  /** Seconds until the next beat, or until the cinematic ends. */
  readonly duration: number;
  /** Camera rig this beat should use, resolved against the arena. */
  readonly resolvedCamera: ZMoveBeat['camera'];
}

export interface ZMoveCinematic {
  readonly zMoveId: string;
  readonly name: string;
  readonly totalDuration: number;
  readonly beats: readonly ScheduledBeat[];
  /** Environment reactions that will actually play in this arena. */
  readonly environmentEffects: readonly { effect: string; radius: number; duration: number }[];
  /** The pose the player must perform, and when the window opens. */
  readonly pose: {
    readonly name: string;
    readonly inputs: readonly string[];
    readonly window: number;
    readonly startsAt: number;
  };
  readonly cameraRig: string;
}

/**
 * Build the playable cinematic for a Z-Move in a specific arena.
 *
 * Camera beats are rewritten where the arena cannot support them: a
 * `sky-wide` shot inside a cave becomes `low-hero`, because pointing the
 * camera at a ceiling two metres up is worse than not moving it at all.
 */
export function buildCinematic(zMoveId: string, arena: BattleArena): ZMoveCinematic {
  const zMove = getZMove(zMoveId);
  const totalDuration = zMoveDuration(zMove);
  const rig = cameraRigFor(arena);

  const beats: ScheduledBeat[] = zMove.beats.map((beat, index) => {
    const next = zMove.beats[index + 1];
    const duration = (next ? next.at : totalDuration) - beat.at;

    let resolvedCamera = beat.camera;
    if (arena.enclosed && beat.camera === 'sky-wide') {
      resolvedCamera = 'low-hero';
    }
    if (rig === 'confined' && beat.camera === 'orbit-slow') {
      resolvedCamera = 'pose-closeup';
    }

    return { ...beat, index, duration, resolvedCamera };
  });

  return {
    zMoveId: zMove.id,
    name: zMove.name,
    totalDuration,
    beats,
    environmentEffects: resolveEnvironmentReactions(arena, zMove.environment),
    pose: {
      name: zMove.pose.name,
      inputs: zMove.pose.inputs,
      window: zMove.pose.window,
      // The window opens immediately: the pose *is* the opening beat.
      startsAt: 0,
    },
    cameraRig: rig,
  };
}

/** Which beat is active at time `t`? Used by the playback system each frame. */
export function beatAt(cinematic: ZMoveCinematic, t: number): ScheduledBeat | null {
  let active: ScheduledBeat | null = null;
  for (const beat of cinematic.beats) {
    if (t >= beat.at) active = beat;
    else break;
  }
  return active;
}

/** Time dilation at time `t`, interpolated between beats. */
export function timeScaleAt(cinematic: ZMoveCinematic, t: number): number {
  const beat = beatAt(cinematic, t);
  return beat?.timeScale ?? 1;
}

/** Screen shake amplitude at time `t`, decaying within each beat. */
export function shakeAt(cinematic: ZMoveCinematic, t: number): number {
  const beat = beatAt(cinematic, t);
  if (!beat || beat.shake === undefined) return 0;
  // Shake is an impulse: full at the beat, decaying over ~0.4s.
  const since = t - beat.at;
  return beat.shake * Math.max(0, 1 - since / 0.4);
}
