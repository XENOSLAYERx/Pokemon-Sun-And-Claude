/**
 * Graphics quality presets.
 *
 * The brief calls for scalable settings across PC and Steam Deck. This module
 * defines what actually scales, and — importantly — detects when the renderer
 * has no hardware acceleration at all and falls back rather than presenting an
 * unplayable frame rate.
 *
 * The scaling factors here are chosen from measurement, not guesswork.
 * Profiling the prototype under SwiftShader (software rasterisation, no GPU)
 * showed that hiding terrain meshes took the frame rate from 2.3 to 36.3 fps
 * while the entire JavaScript simulation cost 0.01ms per tick. Rendering load
 * — draw calls, vertex throughput and fill rate — is therefore what a quality
 * preset must control. Simulation fidelity is nearly free by comparison, which
 * is why even the lowest preset keeps full AI: dropping Pokémon behaviour to
 * gain frames would trade the thing that makes the world alive for nothing.
 */

export type QualityLevel = 'potato' | 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  readonly name: QualityLevel;
  readonly label: string;

  // --- Rendering
  /** Device pixel ratio cap. */
  readonly pixelRatio: number;
  /** Render scale applied before upscaling, 0–1. */
  readonly renderScale: number;
  readonly antialias: boolean;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  /** Ring index beyond which chunks stop casting shadows. */
  readonly shadowCastLod: number;

  // --- World
  /** Multiplier on the streaming radius. */
  readonly drawDistanceScale: number;
  /** Chunks built per frame. */
  readonly chunkBuildsPerFrame: number;
  /** Multiplier on foliage instance budgets. */
  readonly foliageDensity: number;
  /** Maximum wild Pokémon rendered. */
  readonly maxVisiblePokemon: number;

  // --- Shaders
  /** Volumetric cloud raymarch steps. 0 disables volumetrics. */
  readonly cloudSteps: number;
  /** Ocean surface tessellation per side. */
  readonly oceanTessellation: number;
  /** Gerstner wave components. */
  readonly oceanWaves: number;
  readonly triplanarTerrain: boolean;

  // --- Post
  readonly bloom: boolean;
  readonly motionBlur: boolean;
  readonly ambientOcclusion: boolean;
}

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  /**
   * Software rendering / no GPU. Not a shipping preset — a safety net so the
   * game is inspectable in a CI container or a VM instead of hanging at one
   * frame every two seconds.
   */
  potato: {
    name: 'potato', label: 'Software fallback',
    pixelRatio: 0.5, renderScale: 0.5, antialias: false,
    shadows: false, shadowMapSize: 512, shadowCastLod: -1,
    drawDistanceScale: 0.25, chunkBuildsPerFrame: 1,
    foliageDensity: 0, maxVisiblePokemon: 40,
    cloudSteps: 0, oceanTessellation: 24, oceanWaves: 3, triplanarTerrain: false,
    bloom: false, motionBlur: false, ambientOcclusion: false,
  },
  low: {
    name: 'low', label: 'Low',
    pixelRatio: 1, renderScale: 0.75, antialias: false,
    shadows: true, shadowMapSize: 1024, shadowCastLod: 0,
    drawDistanceScale: 0.5, chunkBuildsPerFrame: 1,
    foliageDensity: 0.35, maxVisiblePokemon: 80,
    cloudSteps: 8, oceanTessellation: 64, oceanWaves: 4, triplanarTerrain: false,
    bloom: false, motionBlur: false, ambientOcclusion: false,
  },
  /** The Steam Deck target: 60fps at 1280x800. */
  medium: {
    name: 'medium', label: 'Medium (Steam Deck)',
    pixelRatio: 1, renderScale: 1, antialias: false,
    shadows: true, shadowMapSize: 1536, shadowCastLod: 0,
    drawDistanceScale: 0.75, chunkBuildsPerFrame: 2,
    foliageDensity: 0.6, maxVisiblePokemon: 140,
    cloudSteps: 16, oceanTessellation: 128, oceanWaves: 5, triplanarTerrain: true,
    bloom: true, motionBlur: false, ambientOcclusion: false,
  },
  high: {
    name: 'high', label: 'High',
    pixelRatio: 1.5, renderScale: 1, antialias: true,
    shadows: true, shadowMapSize: 2048, shadowCastLod: 1,
    drawDistanceScale: 1, chunkBuildsPerFrame: 2,
    foliageDensity: 1, maxVisiblePokemon: 220,
    cloudSteps: 24, oceanTessellation: 192, oceanWaves: 6, triplanarTerrain: true,
    bloom: true, motionBlur: true, ambientOcclusion: true,
  },
  ultra: {
    name: 'ultra', label: 'Ultra',
    pixelRatio: 2, renderScale: 1, antialias: true,
    shadows: true, shadowMapSize: 4096, shadowCastLod: 2,
    drawDistanceScale: 1.35, chunkBuildsPerFrame: 3,
    foliageDensity: 1.5, maxVisiblePokemon: 320,
    cloudSteps: 40, oceanTessellation: 256, oceanWaves: 8, triplanarTerrain: true,
    bloom: true, motionBlur: true, ambientOcclusion: true,
  },
};

export const QUALITY_ORDER: readonly QualityLevel[] = ['potato', 'low', 'medium', 'high', 'ultra'];

/**
 * Detect hardware acceleration from the WebGL renderer string.
 *
 * SwiftShader, llvmpipe and Mesa's software paths all identify themselves, and
 * any of them means the frame budget is a hundred times smaller than a GPU's.
 * Guessing wrong in the optimistic direction produces a game that appears
 * broken, so the check errs toward the fallback.
 */
export function isSoftwareRenderer(rendererString: string): boolean {
  const s = rendererString.toLowerCase();
  return (
    s.includes('swiftshader') ||
    s.includes('llvmpipe') ||
    s.includes('softpipe') ||
    s.includes('software') ||
    s.includes('microsoft basic render')
  );
}

/**
 * Pick a starting preset.
 * The player can override it; this only decides what they see first.
 */
export function detectQuality(params: {
  readonly rendererString: string;
  readonly deviceMemoryGb?: number;
  readonly hardwareConcurrency?: number;
  readonly screenWidth?: number;
}): QualityLevel {
  if (isSoftwareRenderer(params.rendererString)) return 'potato';

  const memory = params.deviceMemoryGb ?? 8;
  const cores = params.hardwareConcurrency ?? 4;
  const width = params.screenWidth ?? 1920;

  if (memory <= 4 || cores <= 2) return 'low';
  // The Steam Deck reports 8 cores and a 1280-wide screen.
  if (width <= 1366 || cores <= 8) return 'medium';
  // Never 'ultra' automatically. Core count, memory and screen width say
  // nothing about the GPU, and a 16-core laptop on integrated graphics driving
  // a 1440p panel matches every one of them. Ultra doubles the pixel count and
  // quadruples the shadow map; a player who has the GPU for it can choose it.
  return 'high';
}

/**
 * Adaptive quality.
 *
 * Watches frame time and steps the preset down when the game is persistently
 * missing its target, then back up when it has headroom to spare. The
 * asymmetry is deliberate: drop quickly so a struggling scene recovers, raise
 * slowly and only after sustained headroom, so the settings do not oscillate
 * every time the player walks past a dense stand of trees.
 */
export class AdaptiveQuality {
  private level: QualityLevel;
  private readonly targetMs: number;
  private belowTarget = 0;
  private aboveTarget = 0;
  private locked = false;

  /** Fired when the preset changes, so the client can rebuild resources. */
  onChange: ((preset: QualityPreset) => void) | null = null;

  constructor(initial: QualityLevel, targetFps = 60) {
    this.level = initial;
    this.targetMs = 1000 / targetFps;
  }

  /** Stop adapting — the player has chosen a preset explicitly. */
  lock(level: QualityLevel): void {
    this.locked = true;
    if (level !== this.level) {
      this.level = level;
      this.onChange?.(this.preset);
    }
  }

  unlock(): void {
    this.locked = false;
  }

  update(frameMs: number): void {
    if (this.locked) return;

    // Drop after ~1 second of missing the target by 25%.
    if (frameMs > this.targetMs * 1.25) {
      this.belowTarget++;
      this.aboveTarget = 0;
      if (this.belowTarget > 60) {
        this.belowTarget = 0;
        this.step(-1);
      }
      return;
    }

    // Raise only after ~5 seconds of comfortable headroom.
    if (frameMs < this.targetMs * 0.65) {
      this.aboveTarget++;
      this.belowTarget = 0;
      if (this.aboveTarget > 300) {
        this.aboveTarget = 0;
        this.step(1);
      }
      return;
    }

    this.belowTarget = 0;
    this.aboveTarget = 0;
  }

  private step(direction: number): void {
    const index = QUALITY_ORDER.indexOf(this.level);
    const next = index + direction;
    if (next < 0 || next >= QUALITY_ORDER.length) return;
    this.level = QUALITY_ORDER[next];
    this.onChange?.(this.preset);
  }

  get preset(): QualityPreset {
    return QUALITY_PRESETS[this.level];
  }

  get current(): QualityLevel {
    return this.level;
  }
}

/** Read the renderer string from a WebGL context, for detection. */
export function readRendererString(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    }
    return String(gl.getParameter(gl.RENDERER));
  } catch {
    return 'unknown';
  }
}
