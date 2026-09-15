/**
 * Day/night cycle and celestial state.
 *
 * Alola runs on its own clock, not the system clock. That is a deliberate
 * design call: tying time of day to the player's wall clock means anyone
 * playing in the evening never sees daytime spawns, and it makes the world
 * unreproducible for testing and multiplayer. Instead the world has a game
 * clock that the player can influence through rest, and which the server is
 * authoritative over in multiplayer.
 *
 * One in-game day = 72 real minutes by default (a 20x compression). That is
 * long enough for a day to feel like a day and short enough that a player who
 * needs a nocturnal Pokémon is never more than ~35 minutes from nightfall.
 */
import { clamp01, lerp, smoothstep, TAU } from '@alola/core';

export interface CelestialState {
  /** 0–24 continuous. */
  hour: number;
  /** Days elapsed since the save began. */
  day: number;
  /** Sun elevation in radians. Negative = below horizon. */
  sunElevation: number;
  /** Sun azimuth in radians. */
  sunAzimuth: number;
  /** Sun direction as a unit vector (points *from* the sun toward the world). */
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
  /** Moon elevation in radians. */
  moonElevation: number;
  /** Moon phase, 0 = new, 0.5 = full, 1 = new again. */
  moonPhase: number;
  /** 0 at night, 1 at midday. Drives light intensity and spawn tables. */
  daylight: number;
  /** 1 during the golden hour window, tapering either side. */
  goldenHour: number;
  /** 1 during civil twilight. */
  twilight: number;
  /** Which broad period of day it is — what content systems actually key off. */
  period: 'dawn' | 'morning' | 'day' | 'afternoon' | 'dusk' | 'night' | 'deep-night';
}

export interface TimeOfDayOptions {
  /** Real seconds per in-game day. */
  secondsPerDay?: number;
  /** Starting hour. */
  startHour?: number;
  /** Starting day index. */
  startDay?: number;
  /** Latitude in degrees. Alola sits near 20°N; affects solar arc tilt. */
  latitude?: number;
}

export class TimeOfDay {
  private readonly secondsPerDay: number;
  private readonly latitudeRad: number;

  /** Total in-game seconds elapsed. The authoritative value; everything derives. */
  private totalSeconds = 0;

  /** Multiplier on time passage. Raised while resting, zeroed in cutscenes. */
  timeScale = 1;

  state: CelestialState;

  constructor(opts: TimeOfDayOptions = {}) {
    this.secondsPerDay = opts.secondsPerDay ?? 72 * 60;
    this.latitudeRad = ((opts.latitude ?? 20) * Math.PI) / 180;
    const startHour = opts.startHour ?? 8;
    const startDay = opts.startDay ?? 0;
    this.totalSeconds = startDay * this.secondsPerDay + (startHour / 24) * this.secondsPerDay;
    this.state = this.compute();
  }

  update(dt: number): void {
    this.totalSeconds += dt * this.timeScale;
    this.state = this.compute();
  }

  /** Jump forward, e.g. resting at a Pokémon Center until morning. */
  advanceToHour(targetHour: number): void {
    const current = this.state.hour;
    let delta = targetHour - current;
    if (delta <= 0) delta += 24;
    this.totalSeconds += (delta / 24) * this.secondsPerDay;
    this.state = this.compute();
  }

  setHour(hour: number): void {
    const day = Math.floor(this.totalSeconds / this.secondsPerDay);
    this.totalSeconds = day * this.secondsPerDay + (hour / 24) * this.secondsPerDay;
    this.state = this.compute();
  }

  private compute(): CelestialState {
    const dayFraction = (this.totalSeconds % this.secondsPerDay) / this.secondsPerDay;
    const hour = dayFraction * 24;
    const day = Math.floor(this.totalSeconds / this.secondsPerDay);

    // Solar position. Hour angle is zero at solar noon.
    const hourAngle = (hour - 12) * (TAU / 24);
    // Simplified declination: Alola is tropical, so seasonal tilt is mild.
    const declination = 0.409 * Math.sin((TAU * (day % 365)) / 365 - 1.39) * 0.45;

    const sinElevation =
      Math.sin(this.latitudeRad) * Math.sin(declination) +
      Math.cos(this.latitudeRad) * Math.cos(declination) * Math.cos(hourAngle);
    const sunElevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)));

    const cosAzimuth =
      (Math.sin(declination) - Math.sin(this.latitudeRad) * sinElevation) /
      (Math.cos(this.latitudeRad) * Math.cos(sunElevation) || 1e-6);
    let sunAzimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth)));
    if (hourAngle > 0) sunAzimuth = TAU - sunAzimuth;

    // Direction from the sun toward the world (what a light needs).
    const cosEl = Math.cos(sunElevation);
    const sunDirX = -cosEl * Math.sin(sunAzimuth);
    const sunDirY = -Math.sin(sunElevation);
    const sunDirZ = -cosEl * Math.cos(sunAzimuth);

    // Moon: opposite the sun, offset by phase so it is not always full-opposed.
    const moonPhase = ((day % 29.53) / 29.53);
    const moonHourAngle = hourAngle + Math.PI + moonPhase * TAU;
    const moonElevation = Math.asin(
      Math.max(-1, Math.min(1,
        Math.sin(this.latitudeRad) * Math.sin(declination) +
        Math.cos(this.latitudeRad) * Math.cos(declination) * Math.cos(moonHourAngle),
      )),
    );

    // Daylight: ramps across the horizon rather than snapping at elevation 0,
    // because atmospheric scattering keeps the world lit below the horizon.
    const daylight = smoothstep(-0.12, 0.18, sunElevation);

    // Golden hour: sun low but above the horizon.
    const goldenHour =
      sunElevation > -0.05 && sunElevation < 0.22
        ? 1 - Math.abs(sunElevation - 0.085) / 0.135
        : 0;

    // Civil twilight: sun between -6° and 0°.
    const twilight =
      sunElevation < 0 && sunElevation > -0.105
        ? 1 - Math.abs(sunElevation + 0.0525) / 0.0525
        : 0;

    return {
      hour, day,
      sunElevation, sunAzimuth,
      sunDirX, sunDirY, sunDirZ,
      moonElevation, moonPhase,
      daylight,
      goldenHour: clamp01(goldenHour),
      twilight: clamp01(twilight),
      period: periodFor(hour),
    };
  }

  /** Serialise for the save file. */
  save(): { totalSeconds: number } {
    return { totalSeconds: this.totalSeconds };
  }

  restore(data: { totalSeconds: number }): void {
    this.totalSeconds = data.totalSeconds;
    this.state = this.compute();
  }

  get hour(): number {
    return this.state.hour;
  }

  get day(): number {
    return this.state.day;
  }

  /** Is it night? The single most-asked question in the codebase. */
  get isNight(): boolean {
    return this.state.daylight < 0.25;
  }
}

function periodFor(hour: number): CelestialState['period'] {
  if (hour < 3) return 'deep-night';
  if (hour < 6) return 'night';
  if (hour < 8) return 'dawn';
  if (hour < 11) return 'morning';
  if (hour < 15) return 'day';
  if (hour < 17.5) return 'afternoon';
  if (hour < 19.5) return 'dusk';
  if (hour < 23) return 'night';
  return 'deep-night';
}

/**
 * Ambient light colour for a given celestial state, as linear RGB.
 *
 * Three named looks rather than a single day/night ramp, because the two
 * transitional states are the ones players photograph:
 *   - golden hour: sun just above the horizon, warm and orange.
 *   - blue hour (civil twilight): sun just below, cool and deeply saturated.
 * Blending only on `daylight` collapses both into a grey mid-tone.
 */
export function ambientColorFor(state: CelestialState): [number, number, number] {
  const night: [number, number, number] = [0.06, 0.08, 0.16];
  const golden: [number, number, number] = [0.95, 0.62, 0.34];
  const blueHour: [number, number, number] = [0.16, 0.24, 0.48];
  const day: [number, number, number] = [0.85, 0.89, 1.0];

  let r = lerp(night[0], day[0], state.daylight);
  let g = lerp(night[1], day[1], state.daylight);
  let b = lerp(night[2], day[2], state.daylight);

  // Blue hour first — golden hour overlaps it slightly and should win where
  // both are non-zero, since a visible sun dominates the sky's colour.
  const t = state.twilight * 0.8;
  if (t > 0) {
    r = lerp(r, blueHour[0], t);
    g = lerp(g, blueHour[1], t);
    b = lerp(b, blueHour[2], t);
  }

  const gh = state.goldenHour * 0.85;
  if (gh > 0) {
    r = lerp(r, golden[0], gh);
    g = lerp(g, golden[1], gh);
    b = lerp(b, golden[2], gh);
  }

  return [r, g, b];
}
