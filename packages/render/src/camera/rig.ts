/**
 * Camera rig.
 *
 * One rig serves exploration, riding, battle and cinematics, because switching
 * between camera *systems* produces a visible discontinuity at exactly the
 * moments the game is trying to feel seamless. Instead there is one camera with
 * a target state that different modes write to, and a single smoothing pass.
 *
 * The collision handling is the part that matters most in practice: a
 * third-person camera in dense jungle spends half its time trying to clip
 * through a tree. The rig sphere-casts toward the desired position and pulls
 * in, then eases back out slowly — pulling in fast and pushing out slow is what
 * stops the camera lurching every time a fern passes behind the player.
 */
import { Vector3, Quaternion, Euler, MathUtils } from 'three';
import { clamp, damp as dampScalar } from '@alola/core';

export type CameraMode = 'explore' | 'ride' | 'fly' | 'swim' | 'battle' | 'cinematic' | 'photo';

export interface CameraModeConfig {
  /** Distance behind the target, in metres. */
  readonly distance: number;
  /** Height above the target's feet. */
  readonly height: number;
  /** Vertical field of view, degrees. */
  readonly fov: number;
  /** Pitch limits, radians. */
  readonly minPitch: number;
  readonly maxPitch: number;
  /** Position smoothing half-life. Lower = tighter. */
  readonly positionHalfLife: number;
  /** Rotation smoothing half-life. */
  readonly rotationHalfLife: number;
  /** Lateral offset — a slight shoulder offset reads better than dead-centre. */
  readonly shoulderOffset: number;
}

export const CAMERA_MODES: Readonly<Record<CameraMode, CameraModeConfig>> = {
  explore: {
    distance: 6.5, height: 2.1, fov: 55,
    minPitch: -0.55, maxPitch: 1.0,
    positionHalfLife: 0.12, rotationHalfLife: 0.08, shoulderOffset: 0.45,
  },
  ride: {
    // Further back and wider: a Mudsdale is large, and speed needs more lead.
    distance: 9.5, height: 3.0, fov: 65,
    minPitch: -0.45, maxPitch: 0.85,
    positionHalfLife: 0.2, rotationHalfLife: 0.14, shoulderOffset: 0.3,
  },
  fly: {
    distance: 14, height: 4.5, fov: 75,
    minPitch: -1.1, maxPitch: 1.0,
    positionHalfLife: 0.3, rotationHalfLife: 0.22, shoulderOffset: 0,
  },
  swim: {
    distance: 7.5, height: 1.6, fov: 60,
    minPitch: -0.9, maxPitch: 0.7,
    positionHalfLife: 0.25, rotationHalfLife: 0.18, shoulderOffset: 0.2,
  },
  battle: {
    distance: 8, height: 2.6, fov: 48,
    minPitch: -0.3, maxPitch: 0.6,
    positionHalfLife: 0.18, rotationHalfLife: 0.12, shoulderOffset: 0,
  },
  cinematic: {
    distance: 6, height: 2, fov: 40,
    minPitch: -1.4, maxPitch: 1.4,
    positionHalfLife: 0.05, rotationHalfLife: 0.05, shoulderOffset: 0,
  },
  photo: {
    distance: 0, height: 1.7, fov: 50,
    minPitch: -1.4, maxPitch: 1.4,
    positionHalfLife: 0.02, rotationHalfLife: 0.02, shoulderOffset: 0,
  },
};

/** A sphere cast against world geometry, supplied by the client. */
export type SphereCast = (
  from: Vector3,
  to: Vector3,
  radius: number,
) => { hit: boolean; distance: number };

export interface ShakeImpulse {
  amplitude: number;
  /** Seconds remaining. */
  remaining: number;
  readonly duration: number;
  readonly frequency: number;
}

export class CameraRig {
  readonly position = new Vector3();
  readonly target = new Vector3();
  readonly quaternion = new Quaternion();
  fov = 55;

  mode: CameraMode = 'explore';

  /** Orbit angles, driven by player input. */
  yaw = 0;
  pitch = 0.25;

  /** Where the camera is looking at — usually the player's head. */
  private readonly focus = new Vector3();
  private readonly desired = new Vector3();
  private readonly smoothedFocus = new Vector3();

  /** Current collision-shortened distance. */
  private currentDistance = 6.5;
  private shakes: ShakeImpulse[] = [];
  private readonly shakeOffset = new Vector3();
  private time = 0;

  /** Cinematic override: when set, the rig follows this instead of the player. */
  private cinematicTarget: { position: Vector3; lookAt: Vector3; fov: number } | null = null;
  private cinematicBlend = 0;

  /** Radius used for the collision sphere cast. */
  collisionRadius = 0.35;

  setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  /** Apply look input, respecting per-mode pitch limits. */
  applyLook(deltaYaw: number, deltaPitch: number): void {
    const config = CAMERA_MODES[this.mode];
    this.yaw += deltaYaw;
    this.pitch = clamp(this.pitch + deltaPitch, config.minPitch, config.maxPitch);
  }

  /** Drive a cinematic shot. `blend` 0 hands control back to gameplay. */
  setCinematic(position: Vector3, lookAt: Vector3, fov: number, blend: number): void {
    this.cinematicTarget = { position: position.clone(), lookAt: lookAt.clone(), fov };
    this.cinematicBlend = clamp(blend, 0, 1);
  }

  clearCinematic(): void {
    this.cinematicTarget = null;
    this.cinematicBlend = 0;
  }

  /** Add a shake impulse. Amplitude 0–1; Z-Move impacts use 1. */
  shake(amplitude: number, duration = 0.4, frequency = 28): void {
    this.shakes.push({
      amplitude: clamp(amplitude, 0, 1),
      remaining: duration,
      duration,
      frequency,
    });
    // Keep the list short: overlapping shakes beyond a handful are inaudible
    // visually and just cost time.
    if (this.shakes.length > 6) this.shakes.shift();
  }

  /**
   * Update the rig.
   *
   * `focusPoint` is what the camera orbits — the player's head in exploration,
   * the midpoint between combatants in battle.
   */
  update(
    dt: number,
    focusPoint: Vector3,
    sphereCast: SphereCast | null,
  ): void {
    this.time += dt;
    const config = CAMERA_MODES[this.mode];

    // Smooth the focus point itself, so the camera does not inherit every
    // footstep bob and stair step from the character controller.
    this.focus.copy(focusPoint);
    this.focus.y += config.height;
    if (this.smoothedFocus.lengthSq() === 0) {
      this.smoothedFocus.copy(this.focus);
    } else {
      dampVector(this.smoothedFocus, this.focus, config.positionHalfLife * 0.7, dt);
    }

    // Desired position: orbit the focus by yaw/pitch at the mode distance.
    const cosPitch = Math.cos(this.pitch);
    this.desired.set(
      this.smoothedFocus.x + Math.sin(this.yaw) * cosPitch * config.distance,
      this.smoothedFocus.y + Math.sin(this.pitch) * config.distance,
      this.smoothedFocus.z + Math.cos(this.yaw) * cosPitch * config.distance,
    );

    // Shoulder offset, perpendicular to the view direction.
    if (config.shoulderOffset !== 0) {
      this.desired.x += Math.cos(this.yaw) * config.shoulderOffset;
      this.desired.z -= Math.sin(this.yaw) * config.shoulderOffset;
    }

    // Collision: pull in fast, ease out slow.
    let targetDistance = config.distance;
    if (sphereCast) {
      const result = sphereCast(this.smoothedFocus, this.desired, this.collisionRadius);
      if (result.hit) {
        targetDistance = Math.max(0.8, result.distance - this.collisionRadius);
      }
    }
    if (targetDistance < this.currentDistance) {
      // Snap in almost immediately — being inside a wall is never acceptable.
      this.currentDistance = dampScalar(this.currentDistance, targetDistance, 0.03, dt);
    } else {
      // Ease back out, so a fern passing behind the player does not cause a lurch.
      this.currentDistance = dampScalar(this.currentDistance, targetDistance, 0.35, dt);
    }

    const ratio = config.distance > 0 ? this.currentDistance / config.distance : 0;
    this.desired.sub(this.smoothedFocus).multiplyScalar(ratio).add(this.smoothedFocus);

    // Smooth toward the desired position.
    dampVector(this.position, this.desired, config.positionHalfLife, dt);

    // Look at the focus.
    this.target.copy(this.smoothedFocus);

    // Cinematic override.
    if (this.cinematicTarget && this.cinematicBlend > 0) {
      this.position.lerp(this.cinematicTarget.position, this.cinematicBlend);
      this.target.lerp(this.cinematicTarget.lookAt, this.cinematicBlend);
      this.fov = MathUtils.lerp(config.fov, this.cinematicTarget.fov, this.cinematicBlend);
    } else {
      this.fov = dampScalar(this.fov, config.fov, config.rotationHalfLife, dt);
    }

    // Shake, applied after everything else so it never fights the smoothing.
    this.updateShake(dt);
    this.position.add(this.shakeOffset);

    // Orientation.
    const forward = this.target.clone().sub(this.position).normalize();
    const euler = new Euler(
      Math.asin(clamp(-forward.y, -1, 1)),
      Math.atan2(-forward.x, -forward.z),
      0,
      'YXZ',
    );
    this.quaternion.setFromEuler(euler);
  }

  private updateShake(dt: number): void {
    this.shakeOffset.set(0, 0, 0);
    if (this.shakes.length === 0) return;

    for (const shake of this.shakes) {
      shake.remaining -= dt;
      if (shake.remaining <= 0) continue;
      // Decay quadratically: a sharp initial jolt that settles quickly.
      const t = shake.remaining / shake.duration;
      const magnitude = shake.amplitude * t * t;
      // Different frequencies per axis so the motion is not a straight line.
      this.shakeOffset.x += Math.sin(this.time * shake.frequency) * magnitude * 0.45;
      this.shakeOffset.y += Math.sin(this.time * shake.frequency * 1.37 + 1.1) * magnitude * 0.35;
      this.shakeOffset.z += Math.sin(this.time * shake.frequency * 0.83 + 2.3) * magnitude * 0.45;
    }

    this.shakes = this.shakes.filter((s) => s.remaining > 0);
  }

  /** Snap to the desired position without smoothing. For teleports and cuts. */
  snap(focusPoint: Vector3): void {
    const config = CAMERA_MODES[this.mode];
    this.smoothedFocus.copy(focusPoint);
    this.smoothedFocus.y += config.height;
    this.currentDistance = config.distance;

    const cosPitch = Math.cos(this.pitch);
    this.position.set(
      this.smoothedFocus.x + Math.sin(this.yaw) * cosPitch * config.distance,
      this.smoothedFocus.y + Math.sin(this.pitch) * config.distance,
      this.smoothedFocus.z + Math.cos(this.yaw) * cosPitch * config.distance,
    );
    this.target.copy(this.smoothedFocus);
    this.fov = config.fov;
    this.shakes.length = 0;
    this.shakeOffset.set(0, 0, 0);
  }

  get shakeCount(): number {
    return this.shakes.length;
  }
}

function dampVector(current: Vector3, target: Vector3, halfLife: number, dt: number): void {
  if (halfLife <= 0) {
    current.copy(target);
    return;
  }
  const t = 1 - Math.pow(2, -dt / halfLife);
  current.lerp(target, t);
}

/**
 * Battle camera framing.
 *
 * Frames two combatants so both stay on screen with headroom, which is
 * genuinely non-trivial when one is a 0.2m Mimikyu and the other is a 3.4m
 * Totem. Returns the focus point and distance the rig should use.
 */
export function frameBattle(
  a: Vector3,
  aRadius: number,
  b: Vector3,
  bRadius: number,
  fovDegrees: number,
  aspect: number,
): { focus: Vector3; distance: number } {
  const focus = a.clone().add(b).multiplyScalar(0.5);
  const separation = a.distanceTo(b);
  // The sphere that must fit in frame.
  const required = separation / 2 + Math.max(aRadius, bRadius) * 1.6;

  const vFov = MathUtils.degToRad(fovDegrees);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  // Fit on the tighter axis.
  const fitFov = Math.min(vFov, hFov);
  const distance = required / Math.tan(fitFov / 2);

  return { focus, distance: Math.max(5, distance * 1.15) };
}
