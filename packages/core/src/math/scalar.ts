/** Scalar helpers shared by every subsystem. All pure, all allocation-free. */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp — where does `v` sit between a and b, as 0..1? */
export function invLerp(a: number, b: number, v: number): number {
  if (a === b) return 0;
  return clamp01((v - a) / (b - a));
}

export function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(outMin, outMax, invLerp(inMin, inMax, v));
}

/** Hermite smoothstep. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = invLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
}

/** Ken Perlin's quintic curve — zero 1st AND 2nd derivative at the edges. */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = invLerp(edge0, edge1, x);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** True modulo — result always has the sign of `n`, unlike JS `%`. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Shortest signed angular delta from `a` to `b`, in radians, within (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  return mod(b - a + Math.PI, TAU) - Math.PI;
}

/** Rotate `current` toward `target` by at most `maxDelta` radians. */
export function rotateTowards(current: number, target: number, maxDelta: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Frame-rate independent scalar damping. See vec3.damp. */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  return lerp(current, target, 1 - Math.pow(2, -dt / halfLife));
}

export function sign(v: number): number {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

/** Round half away from zero — matches the official damage-roll convention. */
export function roundHalfUp(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

export function isPowerOfTwo(v: number): boolean {
  return v > 0 && (v & (v - 1)) === 0;
}

export function nextPowerOfTwo(v: number): number {
  let n = 1;
  while (n < v) n <<= 1;
  return n;
}
