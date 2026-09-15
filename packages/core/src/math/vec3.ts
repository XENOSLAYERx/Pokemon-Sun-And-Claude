/**
 * Vec3 — plain-object 3D vector math.
 *
 * Deliberately NOT a class. The simulation core must stay serialisable and
 * structurally-clonable so that it can cross a Worker boundary, be snapshotted
 * for netcode, and be written to a save file without a custom (de)serialiser.
 * Every function that produces a vector takes an optional `out` parameter so
 * hot loops can run allocation-free.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const V3_ZERO: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });
export const V3_UP: Readonly<Vec3> = Object.freeze({ x: 0, y: 1, z: 0 });
export const V3_FORWARD: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: -1 });
export const V3_RIGHT: Readonly<Vec3> = Object.freeze({ x: 1, y: 0, z: 0 });

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out: Vec3, a: Readonly<Vec3>): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function clone(a: Readonly<Vec3>): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function add(a: Readonly<Vec3>, b: Readonly<Vec3>, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a: Readonly<Vec3>, b: Readonly<Vec3>, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(a: Readonly<Vec3>, s: number, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x * s, a.y * s, a.z * s);
}

/** out = a + b * s — the single most common operation in an integrator. */
export function addScaled(a: Readonly<Vec3>, b: Readonly<Vec3>, s: number, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
}

export function mul(a: Readonly<Vec3>, b: Readonly<Vec3>, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x * b.x, a.y * b.y, a.z * b.z);
}

export function negate(a: Readonly<Vec3>, out: Vec3 = vec3()): Vec3 {
  return set(out, -a.x, -a.y, -a.z);
}

export function dot(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Readonly<Vec3>, b: Readonly<Vec3>, out: Vec3 = vec3()): Vec3 {
  // Written into locals first so `cross(a, b, a)` is safe.
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  return set(out, x, y, z);
}

export function lengthSq(a: Readonly<Vec3>): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function length(a: Readonly<Vec3>): number {
  return Math.sqrt(lengthSq(a));
}

export function distanceSq(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.sqrt(distanceSq(a, b));
}

/** Horizontal (XZ) distance. Used constantly by AI: a Wingull 40m overhead is not "near". */
export function distanceFlatSq(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function distanceFlat(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.sqrt(distanceFlatSq(a, b));
}

export function normalize(a: Readonly<Vec3>, out: Vec3 = vec3()): Vec3 {
  const len = length(a);
  if (len < 1e-8) return set(out, 0, 0, 0);
  const inv = 1 / len;
  return set(out, a.x * inv, a.y * inv, a.z * inv);
}

export function lerp(a: Readonly<Vec3>, b: Readonly<Vec3>, t: number, out: Vec3 = vec3()): Vec3 {
  return set(out, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

/** Clamp a vector's magnitude. Returns a copy when already within `max`. */
export function clampLength(a: Readonly<Vec3>, max: number, out: Vec3 = vec3()): Vec3 {
  const lenSq = lengthSq(a);
  if (lenSq <= max * max || lenSq < 1e-16) return copy(out, a);
  const s = max / Math.sqrt(lenSq);
  return set(out, a.x * s, a.y * s, a.z * s);
}

/**
 * Frame-rate independent exponential smoothing toward `target`.
 * `halfLife` is the time in seconds for the gap to halve — an intuitive knob
 * that behaves identically at 30fps and 144fps, unlike a raw lerp factor.
 */
export function damp(current: Readonly<Vec3>, target: Readonly<Vec3>, halfLife: number, dt: number, out: Vec3 = vec3()): Vec3 {
  if (halfLife <= 0) return copy(out, target);
  const t = 1 - Math.pow(2, -dt / halfLife);
  return lerp(current, target, t, out);
}

/** Yaw (radians) of a direction vector, measured on the XZ plane. */
export function yawOf(dir: Readonly<Vec3>): number {
  return Math.atan2(dir.x, -dir.z);
}

export function fromYaw(yaw: number, out: Vec3 = vec3()): Vec3 {
  return set(out, Math.sin(yaw), 0, -Math.cos(yaw));
}

export function equalsApprox(a: Readonly<Vec3>, b: Readonly<Vec3>, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
}
