/**
 * Audio director.
 *
 * Decides *what should be heard*, without knowing how sound is played. The
 * client wires the resulting mix state to Web Audio; the headless build and
 * the tests use the same director with no output at all.
 *
 * The music model is vertical layering, not track switching. One island theme
 * is authored as several stems (base, percussion, melody, tension, danger)
 * that fade in and out against live game state. Crossfading between separate
 * tracks always produces an audible seam at exactly the moment the player is
 * most engaged — a predator appearing, a trial starting. Layering means the
 * music can intensify continuously without ever restarting a bar.
 */
import { clamp01, damp } from '@alola/core';
import { getBiome, type BiomeId } from '@alola/data';

export type MusicStem = 'base' | 'percussion' | 'melody' | 'tension' | 'danger' | 'wonder';

export const MUSIC_STEMS: readonly MusicStem[] = [
  'base', 'percussion', 'melody', 'tension', 'danger', 'wonder',
];

export interface MusicState {
  /** Which island/area theme is loaded. */
  theme: string;
  /** Per-stem gain, 0–1. */
  stems: Record<MusicStem, number>;
  /** Playback position in seconds, shared by every stem so they stay in sync. */
  position: number;
  /** Beats per minute, for syncing VFX and camera cuts to the music. */
  bpm: number;
}

/** Everything the director reads to decide the mix. */
export interface AudioContext {
  readonly biome: BiomeId;
  readonly island: string | null;
  /** 0–24. */
  readonly hour: number;
  /** 0–1. */
  readonly daylight: number;
  readonly weather: string;
  readonly precipitation: number;
  readonly windSpeed: number;
  /** Is the player indoors or underground? */
  readonly enclosed: boolean;
  /** Is the player in a battle? */
  readonly inBattle: boolean;
  /** Is this a Totem or legendary encounter? */
  readonly isBossBattle: boolean;
  /** Nearest threat distance in metres, or Infinity. */
  readonly threatDistance: number;
  /** Player health fraction, 0–1. */
  readonly healthFraction: number;
  /** Is the player riding? */
  readonly riding: boolean;
  /** Is the player swimming or sailing? */
  readonly onWater: boolean;
  /** Is a story cutscene playing? */
  readonly inCutscene: boolean;
  /** Is an Ultra Beast event active? */
  readonly ultraEvent: boolean;
}

export interface AmbienceLayer {
  readonly id: string;
  /** Target gain. */
  gain: number;
  /** Whether the layer loops or is a one-shot. */
  readonly loop: boolean;
}

export interface MixState {
  readonly music: MusicState;
  /** Mutable: silent layers are retired by replacing the array. */
  ambience: AmbienceLayer[];
  /** Global reverb send, 0–1. Caves and enclosed spaces raise it. */
  reverb: number;
  /** Low-pass cutoff in Hz. Underwater and muffled states lower it. */
  lowpass: number;
  /** Master duck, applied during dialogue and cinematics. */
  duck: number;
}

export interface DirectorOptions {
  /** Half-life in seconds for stem gain changes. Lower = snappier. */
  readonly stemHalfLife?: number;
  /** Half-life for ambience changes. Slower, so biome transitions breathe. */
  readonly ambienceHalfLife?: number;
}

export class AudioDirector {
  private readonly stemHalfLife: number;
  private readonly ambienceHalfLife: number;

  readonly mix: MixState = {
    music: {
      theme: 'bgm/melemele',
      stems: { base: 1, percussion: 0, melody: 0, tension: 0, danger: 0, wonder: 0 },
      position: 0,
      bpm: 120,
    },
    ambience: [],
    reverb: 0,
    lowpass: 20000,
    duck: 0,
  };

  /** Target values the current mix is easing toward. */
  private targetStems: Record<MusicStem, number> = {
    base: 1, percussion: 0, melody: 0, tension: 0, danger: 0, wonder: 0,
  };
  private targetAmbience = new Map<string, number>();
  private targetReverb = 0;
  private targetLowpass = 20000;

  constructor(opts: DirectorOptions = {}) {
    this.stemHalfLife = opts.stemHalfLife ?? 0.7;
    this.ambienceHalfLife = opts.ambienceHalfLife ?? 1.6;
  }

  /** Recompute targets from game state. Cheap; safe to call every frame. */
  evaluate(ctx: AudioContext): void {
    this.targetStems = this.computeStems(ctx);
    this.targetAmbience = this.computeAmbience(ctx);

    // Enclosed spaces are reverberant; open coastline is not.
    this.targetReverb = ctx.enclosed ? 0.75 : ctx.biome === 'canyon' ? 0.45 : 0.12;

    // Underwater muffles everything. So does being inside a Z-Move cinematic
    // impact, but that is driven separately by the cinematic system.
    this.targetLowpass = ctx.onWater && ctx.biome === 'deep-ocean' ? 900 : 20000;

    this.mix.music.theme = this.selectTheme(ctx);
  }

  private selectTheme(ctx: AudioContext): string {
    if (ctx.ultraEvent) return 'bgm/ultra_event';
    if (ctx.isBossBattle) return 'bgm/totem_battle';
    if (ctx.inBattle) return 'bgm/battle_wild';
    if (ctx.biome === 'ultra-space') return 'bgm/ultra_space';
    if (ctx.enclosed && (ctx.biome === 'cave' || ctx.biome === 'crystal-cave')) return 'bgm/cave';
    if (ctx.onWater) return 'bgm/ocean';
    if (ctx.island) return `bgm/${ctx.island}`;
    return 'bgm/ocean';
  }

  /**
   * Stem gains.
   *
   * The rules read as a mixing desk a composer could operate: each stem has a
   * clear job and a clear trigger, so a designer can predict what the player
   * will hear without running the game.
   */
  private computeStems(ctx: AudioContext): Record<MusicStem, number> {
    const stems: Record<MusicStem, number> = {
      base: 1, percussion: 0, melody: 0, tension: 0, danger: 0, wonder: 0,
    };

    if (ctx.inCutscene) {
      // Cutscenes carry their own scoring; hold the bed only.
      return { base: 0.6, percussion: 0, melody: 0.3, tension: 0, danger: 0, wonder: 0 };
    }

    if (ctx.inBattle) {
      stems.percussion = 1;
      stems.melody = 1;
      // The music tightens as the player's position worsens — the single most
      // effective piece of dynamic scoring in a battle.
      stems.tension = clamp01(1 - ctx.healthFraction) * 0.9;
      stems.danger = ctx.isBossBattle ? 1 : 0;
      return stems;
    }

    // Exploration. Percussion rides with the time of day: full by day,
    // sparse at night, so a route feels different after dark without
    // changing track.
    stems.percussion = clamp01(ctx.daylight * 0.9 + 0.1);
    stems.melody = clamp01(ctx.daylight * 0.7 + 0.15);

    // Riding adds drive.
    if (ctx.riding) stems.percussion = Math.min(1, stems.percussion + 0.35);

    // Proximity to a threat raises tension well before a battle starts, which
    // is what gives the player the chance to notice and avoid it.
    if (Number.isFinite(ctx.threatDistance)) {
      stems.tension = clamp01(1 - ctx.threatDistance / 45);
    }

    // Dangerous biomes carry a permanent undertone.
    const danger = getBiome(ctx.biome).danger;
    stems.danger = clamp01((danger - 2) / 3) * 0.6;

    // Wonder: legendary sites, Ultra Space, and the first sight of a new island.
    if (ctx.biome === 'ruins' || ctx.biome === 'ultra-space' || ctx.biome === 'crystal-cave') {
      stems.wonder = 0.8;
    }

    // Storms suppress melody and raise tension — the weather takes the mix over.
    if (ctx.precipitation > 0.5) {
      stems.melody *= 0.5;
      stems.tension = Math.max(stems.tension, ctx.precipitation * 0.4);
    }

    return stems;
  }

  private computeAmbience(ctx: AudioContext): Map<string, number> {
    const layers = new Map<string, number>();

    // Biome bed.
    layers.set(getBiome(ctx.biome).ambience, 1);

    // Weather overlay.
    if (ctx.precipitation > 0.05) {
      layers.set('amb/rain_layer', clamp01(ctx.precipitation));
    }
    if (ctx.windSpeed > 6) {
      layers.set('amb/wind_layer', clamp01((ctx.windSpeed - 6) / 16));
    }

    // Night insects, day birdsong. Separate layers so dawn crossfades between
    // them rather than cutting.
    const nightness = 1 - clamp01(ctx.daylight);
    if (nightness > 0.15 && !ctx.enclosed) {
      layers.set('amb/night_insects', nightness * 0.8);
    }
    if (ctx.daylight > 0.25 && !ctx.enclosed) {
      layers.set('amb/day_birds', clamp01(ctx.daylight) * 0.7);
    }

    // Surf is audible from inland near the coast.
    if (ctx.biome === 'beach' || ctx.biome === 'coastal-cliff' || ctx.onWater) {
      layers.set('amb/surf', 0.9);
    }

    if (ctx.ultraEvent) {
      layers.set('amb/reality_distortion', 1);
    }

    return layers;
  }

  /**
   * Sync the music position to the audio hardware clock.
   *
   * Accumulating per-frame `dt` drifts: 120 frames of 1/60s sums to slightly
   * under 2 seconds, and the error compounds. Over a few minutes that is
   * enough to slide beat-synced VFX visibly out of time with the music. The
   * client therefore calls this each frame with `AudioContext.currentTime`,
   * which is driven by the audio hardware and never drifts. The accumulator
   * in `update` is only a fallback for headless runs with no audio device.
   */
  syncPosition(audioClockSeconds: number): void {
    this.mix.music.position = audioClockSeconds;
  }

  /** Ease the live mix toward its targets. Call once per frame. */
  update(dt: number): void {
    this.mix.music.position += dt;

    for (const stem of MUSIC_STEMS) {
      this.mix.music.stems[stem] = damp(
        this.mix.music.stems[stem],
        this.targetStems[stem],
        this.stemHalfLife,
        dt,
      );
    }

    // Ease existing layers toward target, and fade out any that vanished.
    for (const layer of this.mix.ambience) {
      const target = this.targetAmbience.get(layer.id) ?? 0;
      layer.gain = damp(layer.gain, target, this.ambienceHalfLife, dt);
    }

    // Add newly-requested layers at zero gain so they fade in.
    for (const [id, target] of this.targetAmbience) {
      if (target <= 0) continue;
      if (!this.mix.ambience.some((l) => l.id === id)) {
        this.mix.ambience.push({ id, gain: 0, loop: true });
      }
    }

    // Retire silent, no-longer-wanted layers.
    this.mix.ambience = this.mix.ambience.filter(
      (l) => l.gain > 0.002 || (this.targetAmbience.get(l.id) ?? 0) > 0,
    );

    this.mix.reverb = damp(this.mix.reverb, this.targetReverb, 0.5, dt);
    this.mix.lowpass = damp(this.mix.lowpass, this.targetLowpass, 0.35, dt);
    this.mix.duck = damp(this.mix.duck, 0, 0.25, dt);
  }

  /** Duck the music under dialogue or a cry. Decays automatically. */
  duck(amount: number): void {
    this.mix.duck = Math.max(this.mix.duck, clamp01(amount));
  }

  /** Effective gain for a stem after ducking. What the mixer should apply. */
  stemGain(stem: MusicStem): number {
    return this.mix.music.stems[stem] * (1 - this.mix.duck * 0.7);
  }

  /** Beat index at the current position — lets VFX land on the beat. */
  currentBeat(): number {
    return Math.floor((this.mix.music.position * this.mix.music.bpm) / 60);
  }

  /** Seconds until the next beat. Used to schedule a cut musically. */
  timeToNextBeat(): number {
    const beatLength = 60 / this.mix.music.bpm;
    return beatLength - (this.mix.music.position % beatLength);
  }
}

/**
 * 3D positional audio attenuation.
 *
 * Inverse-distance with a rolloff factor, matching the Web Audio "inverse"
 * distance model so the director's own calculations agree with what the
 * browser does to a PannerNode.
 */
export function attenuation(distance: number, refDistance = 1, rolloff = 1, maxDistance = 200): number {
  if (distance <= refDistance) return 1;
  if (distance >= maxDistance) return 0;
  return refDistance / (refDistance + rolloff * (distance - refDistance));
}

/** Pick a Pokémon cry variant, so a flock does not sound like one voice. */
export function cryVariant(baseCry: string, personality: number, variantCount = 3): string {
  return `${baseCry}_${personality % variantCount}`;
}

/** Pitch offset for a cry, derived from size — big Pokémon sound big. */
export function cryPitch(scale: number): number {
  // A 1.5x Totem drops roughly a fourth; a 0.85x runt rises slightly.
  return Math.pow(scale, -0.6);
}
