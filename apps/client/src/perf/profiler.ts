/**
 * Per-frame phase profiler.
 *
 * "It feels laggy" has two very different causes that need different fixes: a
 * frame budget that is consistently too small (throughput), and occasional
 * frames that take ten times longer than the rest (stutter). An FPS counter
 * averages the second one away. This records every frame's time per phase so
 * both are visible — p50 for throughput, p95/max and the count of long frames
 * for stutter.
 *
 * It measures main-thread time. GPU time is not visible to JavaScript without
 * timer queries, so `submit` is the cost of *issuing* the frame, which on a
 * real GPU is small and on a software rasteriser is everything.
 */

export const PHASES = ['sim', 'meshing', 'streaming', 'prep', 'submit', 'hud'] as const;
export type PhaseName = (typeof PHASES)[number];

const CAPACITY = 4096;

export interface PhaseStats {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

export interface ProfileSnapshot {
  readonly frames: number;
  readonly total: PhaseStats;
  readonly phases: Record<PhaseName, PhaseStats>;
  /** Frames whose main-thread work alone exceeded 33ms / 50ms / 100ms. */
  readonly over33: number;
  readonly over50: number;
  readonly over100: number;
  readonly chunksBuilt: number;
}

export class FrameProfiler {
  private readonly data: Record<PhaseName, Float32Array>;
  private readonly totals = new Float32Array(CAPACITY);
  private readonly current: Record<PhaseName, number>;
  private head = 0;
  private count = 0;
  private chunks = 0;
  private marks: Partial<Record<PhaseName, number>> = {};

  constructor() {
    this.data = Object.fromEntries(PHASES.map((p) => [p, new Float32Array(CAPACITY)])) as Record<PhaseName, Float32Array>;
    this.current = Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<PhaseName, number>;
  }

  begin(phase: PhaseName): void {
    this.marks[phase] = performance.now();
  }

  end(phase: PhaseName): void {
    const start = this.marks[phase];
    if (start === undefined) return;
    this.current[phase] += performance.now() - start;
    this.marks[phase] = undefined;
  }

  /** Add time measured elsewhere — used for meshing inside the streaming phase. */
  add(phase: PhaseName, ms: number): void {
    this.current[phase] += ms;
  }

  countChunk(): void {
    this.chunks++;
  }

  /** Close the frame and push it into the ring. */
  commit(): void {
    let total = 0;
    for (const phase of PHASES) {
      // Meshing is measured inside streaming, so it is not added twice.
      if (phase !== 'meshing') total += this.current[phase];
      this.data[phase][this.head] = this.current[phase];
      this.current[phase] = 0;
    }
    this.totals[this.head] = total;
    this.head = (this.head + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.chunks = 0;
  }

  snapshot(): ProfileSnapshot {
    const stats = (source: Float32Array): PhaseStats => {
      const values = Array.from(source.subarray(0, this.count)).sort((a, b) => a - b);
      if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
      const at = (q: number): number => values[Math.min(values.length - 1, Math.floor(values.length * q))];
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: values[values.length - 1], mean };
    };

    let over33 = 0, over50 = 0, over100 = 0;
    for (let i = 0; i < this.count; i++) {
      const t = this.totals[i];
      if (t > 33) over33++;
      if (t > 50) over50++;
      if (t > 100) over100++;
    }

    return {
      frames: this.count,
      total: stats(this.totals),
      phases: Object.fromEntries(PHASES.map((p) => [p, stats(this.data[p])])) as Record<PhaseName, PhaseStats>,
      over33, over50, over100,
      chunksBuilt: this.chunks,
    };
  }
}
