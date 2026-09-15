/**
 * Flocking and steering.
 *
 * Reynolds' three rules (separation, alignment, cohesion) plus the steering
 * behaviours the goal library needs: seek, flee, arrive, pursue, evade,
 * wander, and obstacle/memory avoidance.
 *
 * All forces accumulate into one steering vector which the locomotion system
 * integrates. Keeping steering separate from locomotion matters: a Wingull and
 * a Mudsdale compute the same desired direction but move toward it completely
 * differently, and conflating the two makes every species feel the same.
 *
 * Reynolds observed that a boid only needs to consider its ~7 nearest
 * neighbours for the flock to look right; we cap at that, which turns a dense
 * 40-member Wingull colony from O(n²) into O(n).
 */
import { V3, vec3, clamp01, type Vec3 } from '@alola/core';

export const MAX_FLOCK_NEIGHBOURS = 7;

export interface Boid {
  readonly id: number;
  readonly position: Readonly<Vec3>;
  readonly velocity: Readonly<Vec3>;
  readonly packId: number;
}

export interface FlockWeights {
  separation: number;
  alignment: number;
  cohesion: number;
  /** Radius within which separation applies. */
  separationRadius: number;
  /** Radius within which alignment and cohesion apply. */
  cohesionRadius: number;
}

// Scratch vectors, module-scoped so steering never allocates in the hot loop.
const _sep = vec3();
const _ali = vec3();
const _coh = vec3();
const _tmp = vec3();

/**
 * Accumulate flocking forces into `out`.
 * `neighbours` should already be filtered to the same pack and capped.
 */
export function flock(
  self: Boid,
  neighbours: readonly Boid[],
  weights: FlockWeights,
  out: Vec3,
): Vec3 {
  V3.set(_sep, 0, 0, 0);
  V3.set(_ali, 0, 0, 0);
  V3.set(_coh, 0, 0, 0);

  let sepCount = 0;
  let flockCount = 0;
  const sepRadiusSq = weights.separationRadius * weights.separationRadius;
  const cohRadiusSq = weights.cohesionRadius * weights.cohesionRadius;

  for (let i = 0; i < neighbours.length && i < MAX_FLOCK_NEIGHBOURS; i++) {
    const other = neighbours[i];
    if (other.id === self.id) continue;

    const distSq = V3.distanceSq(self.position, other.position);
    if (distSq < 1e-6) continue;

    // Separation: push away, weighted by inverse distance so the force rises
    // sharply as bodies get close. Without the inverse weighting, flocks
    // either drift apart or interpenetrate.
    if (distSq < sepRadiusSq) {
      V3.sub(self.position, other.position, _tmp);
      const dist = Math.sqrt(distSq);
      V3.scale(_tmp, 1 / (dist * dist), _tmp);
      V3.add(_sep, _tmp, _sep);
      sepCount++;
    }

    if (distSq < cohRadiusSq) {
      V3.add(_ali, other.velocity, _ali);
      V3.add(_coh, other.position, _coh);
      flockCount++;
    }
  }

  V3.set(out, 0, 0, 0);

  if (sepCount > 0) {
    V3.scale(_sep, 1 / sepCount, _sep);
    V3.normalize(_sep, _sep);
    V3.addScaled(out, _sep, weights.separation, out);
  }

  if (flockCount > 0) {
    // Alignment: match average heading.
    V3.scale(_ali, 1 / flockCount, _ali);
    V3.normalize(_ali, _ali);
    V3.addScaled(out, _ali, weights.alignment, out);

    // Cohesion: steer toward the centre of mass.
    V3.scale(_coh, 1 / flockCount, _coh);
    V3.sub(_coh, self.position, _coh);
    V3.normalize(_coh, _coh);
    V3.addScaled(out, _coh, weights.cohesion, out);
  }

  return out;
}

/** Steer directly toward a point. */
export function seek(position: Readonly<Vec3>, target: Readonly<Vec3>, out: Vec3): Vec3 {
  V3.sub(target, position, out);
  return V3.normalize(out, out);
}

/** Steer directly away from a point. */
export function flee(position: Readonly<Vec3>, threat: Readonly<Vec3>, out: Vec3): Vec3 {
  V3.sub(position, threat, out);
  return V3.normalize(out, out);
}

/**
 * Seek, but decelerate into the target.
 * Returns a vector whose magnitude is the desired speed fraction (0–1), so the
 * caller can slow down rather than orbiting the target forever.
 */
export function arrive(
  position: Readonly<Vec3>,
  target: Readonly<Vec3>,
  slowRadius: number,
  out: Vec3,
): Vec3 {
  V3.sub(target, position, out);
  const dist = V3.length(out);
  if (dist < 1e-4) return V3.set(out, 0, 0, 0);
  V3.scale(out, 1 / dist, out);
  const speed = dist < slowRadius ? dist / slowRadius : 1;
  return V3.scale(out, speed, out);
}

/**
 * Intercept a moving target by aiming where it will be.
 * This is what makes a Sharpedo feel like a predator rather than a
 * heat-seeking missile that always trails just behind.
 */
export function pursue(
  position: Readonly<Vec3>,
  targetPos: Readonly<Vec3>,
  targetVel: Readonly<Vec3>,
  selfSpeed: number,
  out: Vec3,
): Vec3 {
  const distance = V3.distance(position, targetPos);
  // Look ahead proportional to distance and inversely to our own speed.
  const lookAhead = selfSpeed > 0.1 ? distance / selfSpeed : 0;
  V3.addScaled(targetPos, targetVel, Math.min(lookAhead, 3), _tmp);
  return seek(position, _tmp, out);
}

/** Flee from where a pursuer will be, not where it is. */
export function evade(
  position: Readonly<Vec3>,
  threatPos: Readonly<Vec3>,
  threatVel: Readonly<Vec3>,
  selfSpeed: number,
  out: Vec3,
): Vec3 {
  const distance = V3.distance(position, threatPos);
  const lookAhead = selfSpeed > 0.1 ? distance / selfSpeed : 0;
  V3.addScaled(threatPos, threatVel, Math.min(lookAhead, 3), _tmp);
  return flee(position, _tmp, out);
}

/**
 * Wander: a smoothly-varying random direction.
 *
 * Implemented as a point moving around a circle projected ahead of the agent,
 * rather than re-randomising the direction each tick. Random-per-tick produces
 * a visible jitter that no amount of smoothing fixes; this produces the lazy,
 * meandering path real animals take.
 *
 * `state.angle` must persist per agent between calls.
 */
export interface WanderState {
  angle: number;
}

export function wander(
  forward: Readonly<Vec3>,
  state: WanderState,
  jitter: number,
  radius: number,
  distance: number,
  random: () => number,
  out: Vec3,
): Vec3 {
  state.angle += (random() * 2 - 1) * jitter;

  // Circle centre, projected ahead of the agent.
  V3.normalize(forward, _tmp);
  V3.scale(_tmp, distance, out);

  // Displacement on the circle.
  out.x += Math.cos(state.angle) * radius;
  out.z += Math.sin(state.angle) * radius;

  return V3.normalize(out, out);
}

/** Steer away from a set of obstacle points, weighted by proximity. */
export function avoid(
  position: Readonly<Vec3>,
  obstacles: readonly { position: Readonly<Vec3>; radius: number }[],
  lookAhead: number,
  out: Vec3,
): Vec3 {
  V3.set(out, 0, 0, 0);
  let count = 0;

  for (const obs of obstacles) {
    const dist = V3.distanceFlat(position, obs.position);
    const threshold = obs.radius + lookAhead;
    if (dist > threshold || dist < 1e-4) continue;

    V3.sub(position, obs.position, _tmp);
    V3.normalize(_tmp, _tmp);
    // Force rises sharply inside the obstacle radius.
    const strength = clamp01(1 - (dist - obs.radius) / lookAhead);
    V3.addScaled(out, _tmp, strength, out);
    count++;
  }

  if (count > 0) V3.normalize(out, out);
  return out;
}

/**
 * Keep an agent inside its territory.
 * Returns a force that grows as the agent nears the boundary, so it turns back
 * naturally instead of hitting an invisible wall.
 */
export function containWithin(
  position: Readonly<Vec3>,
  home: Readonly<Vec3>,
  radius: number,
  out: Vec3,
): Vec3 {
  V3.set(out, 0, 0, 0);
  if (radius <= 0) return out;

  const dist = V3.distanceFlat(position, home);
  // No force until 70% of the way out — inside that, the agent roams freely.
  if (dist < radius * 0.7) return out;

  seek(position, home, out);
  const strength = clamp01((dist - radius * 0.7) / (radius * 0.3));
  return V3.scale(out, strength, out);
}

/**
 * Combine weighted steering forces with priority truncation.
 *
 * Forces are applied in order until the accumulated magnitude saturates. This
 * beats a plain weighted sum because it lets a critical force (avoid a cliff)
 * genuinely dominate a soft one (drift toward the flock), instead of being
 * averaged into irrelevance.
 */
export function combineSteering(
  forces: readonly { force: Readonly<Vec3>; weight: number }[],
  maxForce: number,
  out: Vec3,
): Vec3 {
  V3.set(out, 0, 0, 0);
  let remaining = maxForce;

  for (const { force, weight } of forces) {
    if (remaining <= 1e-4) break;
    const magnitude = V3.length(force) * weight;
    if (magnitude < 1e-6) continue;

    const applied = Math.min(magnitude, remaining);
    V3.normalize(force, _tmp);
    V3.addScaled(out, _tmp, applied, out);
    remaining -= applied;
  }

  return out;
}
