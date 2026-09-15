/**
 * Dynamic weather.
 *
 * Weather is simulated per-island rather than globally, because "it is raining
 * on Ula'ula while Melemele is clear" is one of the cheapest, most effective
 * ways to make a world feel large and real. The player can see a storm over
 * the next island across the water and decide to sail toward it — which is
 * exactly the kind of self-directed goal an open world needs.
 *
 * The model is a Markov chain over weather states, with transition weights
 * biased by the island's climate, the season and the hour. This is far more
 * legible to designers than a fluid simulation, and it produces the property
 * that matters: weather that persists long enough to plan around, changes
 * often enough to notice, and never whiplashes from sandstorm to blizzard.
 *
 * Transitions blend over `transitionSeconds` so the sky, the audio mix, the
 * particle systems and the spawn tables all cross-fade instead of popping.
 */
import { Rng, clamp01, lerp, Interval } from '@alola/core';
import { ISLANDS, type WeatherId } from '@alola/data';

export interface WeatherProfile {
  readonly id: WeatherId;
  readonly name: string;
  /** Rain/snow particle rate, 0–1. */
  readonly precipitation: number;
  /** Wind speed in m/s — drives foliage, ocean and cloth. */
  readonly windSpeed: number;
  /** Cloud coverage, 0–1. */
  readonly cloudCover: number;
  /** Fog density multiplier. */
  readonly fogDensity: number;
  /** Multiplier on directional light intensity. */
  readonly lightScale: number;
  /** Lightning strikes per minute. */
  readonly lightningRate: number;
  /** Battle field effect this weather imposes, if any. */
  readonly battleWeather: string | null;
  /** Ambient audio loop. */
  readonly ambience: string;
  /** Minimum and maximum duration in in-game seconds. */
  readonly duration: readonly [number, number];
}

export const WEATHER_PROFILES: Readonly<Record<WeatherId, WeatherProfile>> = {
  clear: {
    id: 'clear', name: 'Clear', precipitation: 0, windSpeed: 3, cloudCover: 0.12,
    fogDensity: 0.3, lightScale: 1, lightningRate: 0, battleWeather: null,
    ambience: 'amb/weather_clear', duration: [600, 2400],
  },
  cloudy: {
    id: 'cloudy', name: 'Cloudy', precipitation: 0, windSpeed: 6, cloudCover: 0.7,
    fogDensity: 0.6, lightScale: 0.72, lightningRate: 0, battleWeather: null,
    ambience: 'amb/weather_cloudy', duration: [500, 1800],
  },
  rain: {
    id: 'rain', name: 'Rain', precipitation: 0.55, windSpeed: 9, cloudCover: 0.92,
    fogDensity: 1.1, lightScale: 0.5, lightningRate: 0, battleWeather: 'rain',
    ambience: 'amb/weather_rain', duration: [400, 1500],
  },
  'heavy-rain': {
    id: 'heavy-rain', name: 'Heavy Rain', precipitation: 1, windSpeed: 15, cloudCover: 1,
    fogDensity: 1.8, lightScale: 0.34, lightningRate: 0.4, battleWeather: 'heavy-rain',
    ambience: 'amb/weather_rain_heavy', duration: [300, 900],
  },
  thunderstorm: {
    id: 'thunderstorm', name: 'Thunderstorm', precipitation: 0.85, windSpeed: 18, cloudCover: 1,
    fogDensity: 1.5, lightScale: 0.3, lightningRate: 6, battleWeather: 'rain',
    ambience: 'amb/weather_storm', duration: [240, 720],
  },
  sandstorm: {
    id: 'sandstorm', name: 'Sandstorm', precipitation: 0, windSpeed: 22, cloudCover: 0.5,
    fogDensity: 2.6, lightScale: 0.45, lightningRate: 0, battleWeather: 'sandstorm',
    ambience: 'amb/weather_sandstorm', duration: [300, 1100],
  },
  hail: {
    id: 'hail', name: 'Hail', precipitation: 0.7, windSpeed: 12, cloudCover: 0.95,
    fogDensity: 1.3, lightScale: 0.48, lightningRate: 0, battleWeather: 'hail',
    ambience: 'amb/weather_hail', duration: [240, 800],
  },
  snow: {
    id: 'snow', name: 'Snow', precipitation: 0.6, windSpeed: 7, cloudCover: 0.9,
    fogDensity: 1.6, lightScale: 0.6, lightningRate: 0, battleWeather: 'hail',
    ambience: 'amb/weather_snow', duration: [500, 1800],
  },
  fog: {
    id: 'fog', name: 'Fog', precipitation: 0, windSpeed: 1.5, cloudCover: 0.6,
    fogDensity: 3.4, lightScale: 0.55, lightningRate: 0, battleWeather: 'fog',
    ambience: 'amb/weather_fog', duration: [400, 1400],
  },
  'harsh-sunlight': {
    id: 'harsh-sunlight', name: 'Harsh Sunlight', precipitation: 0, windSpeed: 2, cloudCover: 0.02,
    fogDensity: 0.18, lightScale: 1.35, lightningRate: 0, battleWeather: 'harsh-sunlight',
    ambience: 'amb/weather_clear', duration: [400, 1200],
  },
  aurora: {
    id: 'aurora', name: 'Aurora', precipitation: 0, windSpeed: 4, cloudCover: 0.2,
    fogDensity: 0.9, lightScale: 0.35, lightningRate: 0, battleWeather: null,
    ambience: 'amb/weather_aurora', duration: [300, 900],
  },
};

/**
 * Per-island transition affinity.
 * Higher = more likely. These are the designer-facing knobs that give each
 * island its felt climate: Akala is humid and stormy, Ula'ula is dry with a
 * snowline, Poni is foggy and unsettled.
 */
const ISLAND_AFFINITY: Readonly<Record<string, Partial<Record<WeatherId, number>>>> = {
  melemele: { clear: 5, cloudy: 3, rain: 2, thunderstorm: 1, 'harsh-sunlight': 1.5, fog: 0.4 },
  akala: { clear: 3, cloudy: 3, rain: 3.5, 'heavy-rain': 1.6, thunderstorm: 2, 'harsh-sunlight': 2, fog: 0.8 },
  ulaula: { clear: 3.5, cloudy: 2.5, rain: 1.5, sandstorm: 2.5, snow: 2, hail: 1.2, thunderstorm: 1.2, fog: 0.6 },
  poni: { clear: 2, cloudy: 3.5, rain: 2.5, 'heavy-rain': 1.4, fog: 3, thunderstorm: 1.5, hail: 0.8 },
  aether: { clear: 4, cloudy: 3, rain: 1.5, fog: 1 },
};

/** Weather that cannot follow certain weather — keeps transitions plausible. */
const FORBIDDEN_TRANSITIONS: Readonly<Partial<Record<WeatherId, readonly WeatherId[]>>> = {
  // You do not go straight from a sandstorm to a blizzard.
  sandstorm: ['snow', 'hail', 'heavy-rain'],
  snow: ['sandstorm', 'harsh-sunlight'],
  hail: ['sandstorm', 'harsh-sunlight'],
  'harsh-sunlight': ['snow', 'hail', 'heavy-rain', 'thunderstorm'],
  'heavy-rain': ['harsh-sunlight', 'sandstorm'],
  thunderstorm: ['harsh-sunlight', 'sandstorm'],
};

export interface IslandWeather {
  readonly islandId: string;
  current: WeatherId;
  /** Weather being blended toward, or null when stable. */
  next: WeatherId | null;
  /** 0–1 blend progress toward `next`. */
  blend: number;
  /** In-game seconds remaining in the current state. */
  remaining: number;
  /** Blended, ready-to-consume values. */
  precipitation: number;
  windSpeed: number;
  windDirection: number;
  cloudCover: number;
  fogDensity: number;
  lightScale: number;
  lightningRate: number;
}

export interface WeatherOptions {
  /** Seconds a weather transition takes to blend. */
  transitionSeconds?: number;
  /** Re-evaluation cadence in in-game seconds. */
  evaluateEvery?: number;
}

export class WeatherSystem {
  private readonly rng: Rng;
  private readonly transitionSeconds: number;
  private readonly islands = new Map<string, IslandWeather>();
  private readonly evaluator: Interval;

  /** Forced weather, used by story events (an Ultra Beast arriving). Overrides
   *  the simulation for the given island until cleared. */
  private forced = new Map<string, WeatherId>();

  constructor(seed: number, opts: WeatherOptions = {}) {
    this.rng = new Rng(seed ^ 0x5ea50a);
    this.transitionSeconds = opts.transitionSeconds ?? 45;
    this.evaluator = new Interval(opts.evaluateEvery ?? 30);

    for (const island of ISLANDS) {
      const start: WeatherId = 'clear';
      const profile = WEATHER_PROFILES[start];
      this.islands.set(island.id, {
        islandId: island.id,
        current: start,
        next: null,
        blend: 0,
        remaining: this.rng.range(profile.duration[0], profile.duration[1]),
        precipitation: profile.precipitation,
        windSpeed: profile.windSpeed,
        windDirection: island.windDirection,
        cloudCover: profile.cloudCover,
        fogDensity: profile.fogDensity,
        lightScale: profile.lightScale,
        lightningRate: profile.lightningRate,
      });
    }
  }

  /**
   * Advance weather. `dt` is in-game seconds (so weather moves with the world
   * clock, not the wall clock — resting through the night should change it).
   */
  update(dt: number, hour: number): void {
    const fires = this.evaluator.update(dt);

    for (const w of this.islands.values()) {
      // Blend an in-progress transition.
      if (w.next !== null) {
        w.blend += dt / this.transitionSeconds;
        if (w.blend >= 1) {
          w.current = w.next;
          w.next = null;
          w.blend = 0;
          const p = WEATHER_PROFILES[w.current];
          w.remaining = this.rng.range(p.duration[0], p.duration[1]);
        }
      } else {
        w.remaining -= dt;
        if (fires > 0 && w.remaining <= 0) {
          const forcedId = this.forced.get(w.islandId);
          const target = forcedId ?? this.rollNext(w.islandId, w.current, hour);
          if (target !== w.current) {
            w.next = target;
            w.blend = 0;
          } else {
            // Same weather persists; re-roll its duration so it does not
            // re-evaluate every tick.
            const p = WEATHER_PROFILES[w.current];
            w.remaining = this.rng.range(p.duration[0], p.duration[1]);
          }
        }
      }

      this.applyBlend(w);
    }
  }

  private applyBlend(w: IslandWeather): void {
    const a = WEATHER_PROFILES[w.current];
    const b = w.next !== null ? WEATHER_PROFILES[w.next] : a;
    const t = w.next !== null ? clamp01(w.blend) : 0;

    w.precipitation = lerp(a.precipitation, b.precipitation, t);
    w.windSpeed = lerp(a.windSpeed, b.windSpeed, t);
    w.cloudCover = lerp(a.cloudCover, b.cloudCover, t);
    w.fogDensity = lerp(a.fogDensity, b.fogDensity, t);
    w.lightScale = lerp(a.lightScale, b.lightScale, t);
    w.lightningRate = lerp(a.lightningRate, b.lightningRate, t);
  }

  /** Markov roll for the next weather state on an island. */
  private rollNext(islandId: string, from: WeatherId, hour: number): WeatherId {
    const affinity = ISLAND_AFFINITY[islandId] ?? { clear: 1, cloudy: 1 };
    const forbidden = new Set(FORBIDDEN_TRANSITIONS[from] ?? []);

    const candidates: WeatherId[] = [];
    const weights: number[] = [];

    for (const [id, base] of Object.entries(affinity) as [WeatherId, number][]) {
      if (forbidden.has(id)) continue;

      let w = base;

      // Persistence bias: weather is more likely to continue than to change,
      // which is what stops the sky flickering between states.
      if (id === from) w *= 2.2;

      // Diurnal bias. Fog forms around dawn; storms build in the afternoon;
      // aurora only appears deep at night.
      if (id === 'fog') w *= hour >= 4 && hour <= 8 ? 3.5 : 0.35;
      if (id === 'thunderstorm' || id === 'heavy-rain') w *= hour >= 13 && hour <= 20 ? 1.9 : 0.6;
      if (id === 'harsh-sunlight') w *= hour >= 10 && hour <= 16 ? 2.2 : 0.15;

      candidates.push(id);
      weights.push(w);
    }

    // Aurora is never in the affinity tables: it is a story-driven event that
    // the Ultra Beast arc forces via `force()`, so it always means something.

    if (candidates.length === 0) return 'clear';
    const idx = this.rng.weightedIndex(weights);
    return idx >= 0 ? candidates[idx] : 'clear';
  }

  get(islandId: string): IslandWeather {
    const w = this.islands.get(islandId);
    if (!w) throw new Error(`No weather state for island "${islandId}".`);
    return w;
  }

  /** The dominant weather id for gameplay (spawning, battle field effects). */
  weatherIdFor(islandId: string): WeatherId {
    const w = this.islands.get(islandId);
    if (!w) return 'clear';
    // Past the halfway point of a blend, the new weather is what the player
    // perceives, and — more importantly — what the spawn tables should use.
    return w.next !== null && w.blend > 0.5 ? w.next : w.current;
  }

  /** Force weather on an island. Story events use this. */
  force(islandId: string, weather: WeatherId, immediate = false): void {
    this.forced.set(islandId, weather);
    const w = this.islands.get(islandId);
    if (!w) return;
    if (immediate) {
      w.current = weather;
      w.next = null;
      w.blend = 0;
      this.applyBlend(w);
    } else {
      w.next = weather;
      w.blend = 0;
    }
    w.remaining = WEATHER_PROFILES[weather].duration[1];
  }

  release(islandId: string): void {
    this.forced.delete(islandId);
    const w = this.islands.get(islandId);
    if (w) w.remaining = 0; // Re-evaluate on the next tick.
  }

  all(): IterableIterator<IslandWeather> {
    return this.islands.values();
  }

  save(): Record<string, { current: WeatherId; remaining: number }> {
    const out: Record<string, { current: WeatherId; remaining: number }> = {};
    for (const [id, w] of this.islands) {
      out[id] = { current: w.current, remaining: w.remaining };
    }
    return out;
  }

  restore(data: Record<string, { current: WeatherId; remaining: number }>): void {
    for (const [id, saved] of Object.entries(data)) {
      const w = this.islands.get(id);
      if (!w) continue;
      w.current = saved.current;
      w.next = null;
      w.blend = 0;
      w.remaining = saved.remaining;
      this.applyBlend(w);
    }
  }
}
