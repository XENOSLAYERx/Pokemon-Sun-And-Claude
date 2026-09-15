/**
 * Ocean simulation.
 *
 * The ocean is not decoration here — the player crosses it on a Sharpedo or a
 * Lapras between every island, so it has to be both convincing to look at and
 * *queryable*: the ride Pokémon must sit on the surface, boats must pitch with
 * the swell, and a wave crest must be at the same height on the server as on
 * the client.
 *
 * The model is a sum of Gerstner (trochoidal) waves. Unlike a simple sine
 * heightfield, Gerstner waves displace horizontally as well as vertically,
 * producing sharp crests and broad troughs — the characteristic silhouette of
 * real ocean. The same closed-form evaluation runs in the vertex shader for
 * rendering and on the CPU for physics, so they cannot disagree.
 *
 * Wave parameters are driven by the weather system's wind speed, so a storm
 * genuinely raises the sea state.
 */
import { TAU, clamp01, lerp } from '@alola/core';

export interface GerstnerWave {
  /** Direction of travel, unit length, on the XZ plane. */
  dirX: number;
  dirZ: number;
  /** Distance between crests, in metres. */
  wavelength: number;
  /** Peak-to-trough height contribution, in metres. */
  amplitude: number;
  /** 0 = rounded sine, 1 = sharp crest. Above ~1 the surface self-intersects. */
  steepness: number;
  /** Phase offset so waves do not all start aligned. */
  phase: number;
  /** Metres per second. Derived from wavelength by the dispersion relation. */
  speed: number;
}

/**
 * Deep-water dispersion: phase speed = sqrt(g * L / 2π).
 * Using the real relation rather than an arbitrary speed is what makes long
 * swells visibly outrun short chop, which reads as "real ocean" immediately.
 */
const GRAVITY = 9.81;

export function waveSpeed(wavelength: number): number {
  return Math.sqrt((GRAVITY * wavelength) / TAU);
}

export interface OceanOptions {
  /** Number of wave components. 4–8 is the visual sweet spot. */
  waveCount?: number;
  /** Base wind direction in radians. */
  windDirection?: number;
  /** Wind speed in m/s, from the weather system. */
  windSpeed?: number;
  /** Master amplitude multiplier. */
  scale?: number;
}

export class OceanSimulation {
  waves: GerstnerWave[] = [];
  /** Sea level in metres. */
  seaLevel = 0;
  private windDirection: number;
  private windSpeed: number;
  private scale: number;
  private time = 0;

  constructor(opts: OceanOptions = {}) {
    this.windDirection = opts.windDirection ?? 0.7;
    this.windSpeed = opts.windSpeed ?? 6;
    this.scale = opts.scale ?? 1;
    this.rebuild(opts.waveCount ?? 6);
  }

  /**
   * Rebuild the wave spectrum from the current wind.
   *
   * Wavelengths follow a geometric series so components never beat against
   * each other into a visible repeating pattern, and directions fan out around
   * the wind vector — real seas are directional but not perfectly aligned.
   */
  rebuild(waveCount = 6): void {
    this.waves.length = 0;

    // Sea state grows with wind. The exponent is empirical: wave height scales
    // roughly with the square of wind speed in developed seas.
    const seaState = clamp01(this.windSpeed / 25);
    const baseAmplitude = lerp(0.08, 1.6, seaState * seaState) * this.scale;
    const baseWavelength = lerp(9, 62, seaState);

    for (let i = 0; i < waveCount; i++) {
      // Geometric progression of wavelengths, longest first.
      const t = i / Math.max(1, waveCount - 1);
      const wavelength = baseWavelength * Math.pow(0.62, i) * 2.4;

      // Fan directions around the wind, widest for the shortest waves.
      const spread = lerp(0.15, 1.1, t);
      // Deterministic alternating offset — no RNG, so the ocean is identical
      // everywhere without needing to sync a seed.
      const offset = ((i % 2 === 0 ? 1 : -1) * spread * (0.4 + (i * 0.17) % 0.6));
      const dir = this.windDirection + offset;

      this.waves.push({
        dirX: Math.cos(dir),
        dirZ: Math.sin(dir),
        wavelength,
        amplitude: baseAmplitude * Math.pow(0.74, i),
        // Shorter waves are steeper (choppier) than long swells.
        steepness: lerp(0.35, 0.85, t) * seaState,
        phase: i * 1.7,
        speed: waveSpeed(wavelength),
      });
    }
  }

  setWind(direction: number, speed: number): void {
    const changed = Math.abs(speed - this.windSpeed) > 0.5 || Math.abs(direction - this.windDirection) > 0.05;
    this.windDirection = direction;
    this.windSpeed = speed;
    if (changed) this.rebuild(this.waves.length);
  }

  update(dt: number): void {
    this.time += dt;
  }

  /** Current simulation time — the shader needs this to match the CPU exactly. */
  get elapsed(): number {
    return this.time;
  }

  setTime(t: number): void {
    this.time = t;
  }

  /**
   * Displace a flat grid point into its wave position.
   * Returns the displaced position; note that X and Z move too, which is what
   * gives Gerstner waves their sharp crests.
   */
  displace(x: number, z: number, out: { x: number; y: number; z: number }): void {
    let dx = 0;
    let dy = 0;
    let dz = 0;

    for (const w of this.waves) {
      const k = TAU / w.wavelength;
      const f = k * (w.dirX * x + w.dirZ * z) - w.speed * k * this.time + w.phase;
      const a = w.amplitude;
      const q = w.steepness / (k * a * this.waves.length || 1);

      const cosF = Math.cos(f);
      const sinF = Math.sin(f);

      dx += q * a * w.dirX * cosF;
      dz += q * a * w.dirZ * cosF;
      dy += a * sinF;
    }

    out.x = x + dx;
    out.y = this.seaLevel + dy;
    out.z = z + dz;
  }

  /**
   * Surface height at a world XZ position.
   *
   * Gerstner waves displace horizontally, so strictly this requires inverting
   * the displacement. We do two fixed-point iterations, which converges to
   * well under a centimetre for our steepness range — more than accurate
   * enough to float a Lapras on, and dramatically cheaper than a proper solve.
   */
  heightAt(x: number, z: number): number {
    const tmp = { x: 0, y: 0, z: 0 };
    let sx = x;
    let sz = z;

    for (let iter = 0; iter < 2; iter++) {
      this.displace(sx, sz, tmp);
      // Correct the sample position by the error in the displaced result.
      sx += x - tmp.x;
      sz += z - tmp.z;
    }

    this.displace(sx, sz, tmp);
    return tmp.y;
  }

  /** Surface normal, for buoyancy orientation and specular shading. */
  normalAt(x: number, z: number, eps = 0.6): { x: number; y: number; z: number } {
    const h = this.heightAt(x, z);
    const hx = this.heightAt(x + eps, z);
    const hz = this.heightAt(x, z + eps);

    let nx = h - hx;
    let ny = eps;
    let nz = h - hz;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /**
   * Buoyancy state for a floating body.
   * Returns the surface height and the pitch/roll needed to sit flat on it —
   * what a Lapras or a boat needs every frame.
   */
  buoyancyAt(x: number, z: number, length = 4): {
    height: number;
    pitch: number;
    roll: number;
  } {
    const half = length / 2;
    const fore = this.heightAt(x, z - half);
    const aft = this.heightAt(x, z + half);
    const port = this.heightAt(x - half, z);
    const starboard = this.heightAt(x + half, z);

    return {
      height: (fore + aft + port + starboard) / 4,
      pitch: Math.atan2(fore - aft, length),
      roll: Math.atan2(starboard - port, length),
    };
  }

  /** Total significant wave height — the number the sailing HUD shows. */
  get significantWaveHeight(): number {
    let sum = 0;
    for (const w of this.waves) sum += w.amplitude;
    return sum * 2;
  }

  /** Pack the wave set for upload to a shader uniform buffer. */
  toUniformArray(): Float32Array {
    // 6 floats per wave: dirX, dirZ, wavelength, amplitude, steepness, phase.
    const out = new Float32Array(this.waves.length * 6);
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      const o = i * 6;
      out[o] = w.dirX;
      out[o + 1] = w.dirZ;
      out[o + 2] = w.wavelength;
      out[o + 3] = w.amplitude;
      out[o + 4] = w.steepness;
      out[o + 5] = w.phase;
    }
    return out;
  }
}
