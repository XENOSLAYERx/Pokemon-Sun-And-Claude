/**
 * Fixed-timestep simulation clock with render interpolation.
 *
 * Why fixed-step: the battle engine, AI and netcode all require that a given
 * tick produces a given result. A variable dt makes replays drift and makes
 * client/server reconciliation impossible. Rendering still runs at display
 * rate; presentation systems interpolate using `alpha`.
 *
 * The spiral-of-death guard is essential on Steam Deck and on a browser tab
 * that was backgrounded: without a cap on catch-up steps, a 4-second stall
 * queues 240 ticks, which takes longer than 4 seconds to simulate, which
 * queues more ticks, and the game never recovers.
 */
export interface ClockOptions {
  /** Simulation rate in Hz. 60 for a game this reactive. */
  tickRate?: number;
  /** Max simulation steps per frame before we drop time. */
  maxStepsPerFrame?: number;
  /** Clamp on a single frame's wall-clock delta, in seconds. */
  maxFrameTime?: number;
}

export class FixedClock {
  readonly tickRate: number;
  readonly fixedDt: number;
  private readonly maxSteps: number;
  private readonly maxFrameTime: number;

  private accumulator = 0;
  private lastTime = 0;
  private started = false;

  /** Monotonic simulation tick. Deterministic — never derived from wall time. */
  tick = 0;
  /** Simulation time in seconds = tick * fixedDt. */
  elapsed = 0;
  /** 0..1 progress toward the next tick, for render interpolation. */
  alpha = 0;
  /** Simulation speed multiplier. 0 pauses; used by cutscenes and the pause menu. */
  timeScale = 1;

  /** Number of steps dropped last frame because we exceeded maxSteps. */
  droppedSteps = 0;
  /** Smoothed real frame time in ms, for the perf overlay. */
  frameTimeMs = 0;

  constructor(opts: ClockOptions = {}) {
    this.tickRate = opts.tickRate ?? 60;
    this.fixedDt = 1 / this.tickRate;
    this.maxSteps = opts.maxStepsPerFrame ?? 5;
    this.maxFrameTime = opts.maxFrameTime ?? 0.25;
  }

  /**
   * Advance by real elapsed time and invoke `step` once per fixed tick.
   * Returns the number of steps actually run.
   */
  advance(nowSeconds: number, step: (dt: number, tick: number, elapsed: number) => void): number {
    if (!this.started) {
      this.started = true;
      this.lastTime = nowSeconds;
      return 0;
    }

    let frameTime = nowSeconds - this.lastTime;
    this.lastTime = nowSeconds;

    // Guard against negative deltas (clock adjustment) and huge stalls.
    if (frameTime < 0) frameTime = 0;
    if (frameTime > this.maxFrameTime) frameTime = this.maxFrameTime;

    this.frameTimeMs += (frameTime * 1000 - this.frameTimeMs) * 0.1;

    this.accumulator += frameTime * this.timeScale;

    let steps = 0;
    this.droppedSteps = 0;
    while (this.accumulator >= this.fixedDt) {
      if (steps >= this.maxSteps) {
        // Drop the backlog rather than spiral. The sim runs slow for one frame;
        // that is always better than never catching up.
        this.droppedSteps = Math.floor(this.accumulator / this.fixedDt);
        this.accumulator = 0;
        break;
      }
      this.accumulator -= this.fixedDt;
      this.tick++;
      this.elapsed += this.fixedDt;
      step(this.fixedDt, this.tick, this.elapsed);
      steps++;
    }

    this.alpha = this.accumulator / this.fixedDt;
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
    this.tick = 0;
    this.elapsed = 0;
    this.alpha = 0;
    this.started = false;
  }
}

/**
 * A repeating timer that survives pause and supports fractional overflow.
 * Used for spawn cadence, weather re-evaluation, NPC schedule ticks.
 */
export class Interval {
  period: number;
  private remaining: number;

  constructor(period: number, startElapsed = false) {
    this.period = period;
    this.remaining = startElapsed ? 0 : period;
  }

  /** Returns how many times the interval elapsed this update (usually 0 or 1). */
  update(dt: number): number {
    if (this.period <= 0) return 0;
    this.remaining -= dt;
    let fires = 0;
    while (this.remaining <= 0) {
      this.remaining += this.period;
      fires++;
      // Defensive: a huge dt with a tiny period shouldn't lock up.
      if (fires > 64) {
        this.remaining = this.period;
        break;
      }
    }
    return fires;
  }

  reset(): void {
    this.remaining = this.period;
  }

  get progress(): number {
    return this.period <= 0 ? 0 : 1 - this.remaining / this.period;
  }
}

/** One-shot countdown. */
export class Timer {
  private remaining = 0;
  private running = false;

  start(seconds: number): void {
    this.remaining = seconds;
    this.running = seconds > 0;
  }

  /** Returns true on the tick the timer completes. */
  update(dt: number): boolean {
    if (!this.running) return false;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.running = false;
      this.remaining = 0;
      return true;
    }
    return false;
  }

  cancel(): void {
    this.running = false;
    this.remaining = 0;
  }

  get active(): boolean {
    return this.running;
  }

  get timeLeft(): number {
    return this.remaining;
  }
}
