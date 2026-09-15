/**
 * Client-side prediction and reconciliation.
 *
 * The problem: if the client waits for the server before moving, every input
 * has a full round-trip of latency and the game feels dead. If it moves freely
 * and ignores the server, players desync and cheating is trivial.
 *
 * The solution, in three parts:
 *
 * 1. **Predict.** Apply input locally at once and keep it in a pending buffer.
 * 2. **Reconcile.** When a snapshot arrives, snap to the server's authoritative
 *    state and replay every input the server had not yet processed.
 * 3. **Smooth.** Never teleport on a small correction — blend it out over a few
 *    frames, so ordinary network jitter is invisible and only a genuine
 *    divergence is visible at all.
 *
 * Remote players use a different technique entirely: they are rendered ~100ms
 * in the past and interpolated between the two snapshots that bracket that
 * time, which is always smooth because both endpoints are known.
 */
import { V3, vec3, clamp01, type Vec3 } from '@alola/core';
import type { InputCommand } from '../protocol/messages.ts';

export interface PredictedState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
}

/** Movement integration, shared by client prediction and server authority. */
export type MovementSimulator = (state: PredictedState, input: InputCommand) => void;

export interface PredictionOptions {
  /** How far a correction must exceed before we snap rather than blend. */
  readonly snapThreshold?: number;
  /** Seconds over which a small correction is blended out. */
  readonly smoothingTime?: number;
  /** Maximum unacknowledged inputs retained. */
  readonly maxPending?: number;
}

export class ClientPrediction {
  private pending: InputCommand[] = [];
  private nextSeq = 1;
  private readonly simulate: MovementSimulator;
  private readonly snapThreshold: number;
  private readonly smoothingTime: number;
  private readonly maxPending: number;

  /** The state the player actually sees. */
  readonly visual: PredictedState = { position: vec3(), velocity: vec3(), yaw: 0 };
  /** The predicted state, before smoothing. */
  private predicted: PredictedState = { position: vec3(), velocity: vec3(), yaw: 0 };
  /** Residual error being blended out. */
  private error: Vec3 = vec3();
  private errorRemaining = 0;

  /** Diagnostics for the network overlay. */
  lastCorrectionDistance = 0;
  corrections = 0;
  snaps = 0;

  constructor(simulate: MovementSimulator, opts: PredictionOptions = {}) {
    this.simulate = simulate;
    this.snapThreshold = opts.snapThreshold ?? 4;
    this.smoothingTime = opts.smoothingTime ?? 0.12;
    this.maxPending = opts.maxPending ?? 180;
  }

  /** Apply an input locally and queue it for the server. */
  applyInput(dt: number, moveX: number, moveZ: number, yaw: number, actions: number): InputCommand {
    const command: InputCommand = {
      seq: this.nextSeq++,
      dt,
      moveX,
      moveZ,
      yaw,
      actions,
    };

    this.simulate(this.predicted, command);
    this.pending.push(command);

    // A pathological connection could otherwise grow this without bound.
    if (this.pending.length > this.maxPending) {
      this.pending.splice(0, this.pending.length - this.maxPending);
    }

    return command;
  }

  /**
   * Reconcile against an authoritative snapshot.
   *
   * `ackSeq` is the last input the server processed. Everything after it is
   * replayed on top of the server's state.
   */
  reconcile(serverState: PredictedState, ackSeq: number): void {
    // Drop acknowledged inputs.
    while (this.pending.length > 0 && this.pending[0].seq <= ackSeq) {
      this.pending.shift();
    }

    // Where we thought we were, before correcting.
    const predictedBefore = V3.clone(this.predicted.position);

    // Snap to authority, then replay.
    V3.copy(this.predicted.position, serverState.position);
    V3.copy(this.predicted.velocity, serverState.velocity);
    this.predicted.yaw = serverState.yaw;

    for (const command of this.pending) {
      this.simulate(this.predicted, command);
    }

    // How wrong were we?
    const correction = V3.distance(predictedBefore, this.predicted.position);
    this.lastCorrectionDistance = correction;

    if (correction < 0.001) return;
    this.corrections++;

    if (correction > this.snapThreshold) {
      // A large divergence means something genuinely different happened —
      // a collision we missed, a teleport, a rubber-band. Show it honestly
      // rather than sliding the player across the map.
      this.snaps++;
      V3.set(this.error, 0, 0, 0);
      this.errorRemaining = 0;
      V3.copy(this.visual.position, this.predicted.position);
    } else {
      // Small correction: carry the difference as an error to blend out, so
      // the visible position never jumps.
      V3.sub(this.visual.position, this.predicted.position, this.error);
      this.errorRemaining = this.smoothingTime;
    }
  }

  /** Advance smoothing. Call once per rendered frame. */
  update(dt: number): void {
    V3.copy(this.visual.position, this.predicted.position);
    V3.copy(this.visual.velocity, this.predicted.velocity);
    this.visual.yaw = this.predicted.yaw;

    if (this.errorRemaining > 0) {
      this.errorRemaining = Math.max(0, this.errorRemaining - dt);
      const t = this.smoothingTime > 0 ? this.errorRemaining / this.smoothingTime : 0;
      V3.addScaled(this.visual.position, this.error, t, this.visual.position);
    }
  }

  /** Hard reset, e.g. after fast travel. */
  teleport(position: Readonly<Vec3>, yaw: number): void {
    V3.copy(this.predicted.position, position);
    V3.copy(this.visual.position, position);
    V3.set(this.predicted.velocity, 0, 0, 0);
    V3.set(this.visual.velocity, 0, 0, 0);
    this.predicted.yaw = yaw;
    this.visual.yaw = yaw;
    V3.set(this.error, 0, 0, 0);
    this.errorRemaining = 0;
    this.pending.length = 0;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get position(): Readonly<Vec3> {
    return this.visual.position;
  }
}

/** One received snapshot of a remote entity. */
export interface RemoteSnapshot {
  readonly tick: number;
  readonly time: number;
  readonly position: Vec3;
  readonly yaw: number;
  readonly velocity: Vec3;
}

/**
 * Entity interpolation for remote players and Pokémon.
 *
 * Renders `delay` seconds in the past so there are always two snapshots to
 * interpolate between. That is a deliberate trade: ~100ms of added latency in
 * exchange for motion that is always smooth. For anything the local player
 * does not directly control, that is the right side of the trade.
 */
export class EntityInterpolator {
  private buffer: RemoteSnapshot[] = [];
  private readonly delay: number;
  private readonly maxBuffer: number;

  /** True when the buffer ran dry and we had to extrapolate. */
  extrapolating = false;

  constructor(delaySeconds = 0.1, maxBuffer = 32) {
    this.delay = delaySeconds;
    this.maxBuffer = maxBuffer;
  }

  push(snapshot: RemoteSnapshot): void {
    // Out-of-order packets: insert in time order rather than discarding, since
    // a late packet still improves the interpolation window it lands in.
    let i = this.buffer.length;
    while (i > 0 && this.buffer[i - 1].time > snapshot.time) i--;
    this.buffer.splice(i, 0, snapshot);

    if (this.buffer.length > this.maxBuffer) {
      this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    }
  }

  /** Sample the entity's state at the current render time. */
  sample(now: number, out: { position: Vec3; yaw: number }): boolean {
    if (this.buffer.length === 0) return false;

    const target = now - this.delay;

    // Before the buffer: hold the oldest snapshot.
    if (target <= this.buffer[0].time) {
      V3.copy(out.position, this.buffer[0].position);
      out.yaw = this.buffer[0].yaw;
      this.extrapolating = false;
      return true;
    }

    // Find the bracketing pair.
    for (let i = 0; i < this.buffer.length - 1; i++) {
      const a = this.buffer[i];
      const b = this.buffer[i + 1];
      if (target >= a.time && target <= b.time) {
        const span = b.time - a.time;
        const t = span > 1e-6 ? clamp01((target - a.time) / span) : 0;
        V3.lerp(a.position, b.position, t, out.position);
        out.yaw = lerpAngle(a.yaw, b.yaw, t);
        this.extrapolating = false;
        return true;
      }
    }

    // Past the newest snapshot: extrapolate using the last known velocity.
    // Bounded, because extrapolating far past a lost packet produces a visible
    // lurch that is worse than briefly standing still.
    const last = this.buffer[this.buffer.length - 1];
    const ahead = Math.min(target - last.time, 0.25);
    V3.addScaled(last.position, last.velocity, ahead, out.position);
    out.yaw = last.yaw;
    this.extrapolating = ahead > 0.01;
    return true;
  }

  /** Discard snapshots older than the interpolation window needs. */
  prune(now: number): void {
    const cutoff = now - this.delay - 0.5;
    let drop = 0;
    while (drop < this.buffer.length - 2 && this.buffer[drop].time < cutoff) drop++;
    if (drop > 0) this.buffer.splice(0, drop);
  }

  get bufferLength(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  const TAU = Math.PI * 2;
  let delta = ((b - a) % TAU + TAU + Math.PI) % TAU - Math.PI;
  return a + delta * t;
}

/**
 * Rolling latency estimator.
 * Uses the median rather than the mean: a single 2-second stall should not
 * move the estimate the way it would with an average.
 */
export class LatencyTracker {
  private samples: number[] = [];
  private readonly capacity: number;

  constructor(capacity = 32) {
    this.capacity = capacity;
  }

  record(rttMs: number): void {
    this.samples.push(rttMs);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get median(): number {
    if (this.samples.length === 0) return 0;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  /** Jitter, as the interquartile range. Drives the interpolation delay. */
  get jitter(): number {
    if (this.samples.length < 4) return 0;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    return q3 - q1;
  }

  /** Recommended interpolation delay: enough to cover normal jitter. */
  recommendedDelay(): number {
    return Math.max(0.05, Math.min(0.3, (this.median / 2 + this.jitter * 1.5) / 1000));
  }
}
