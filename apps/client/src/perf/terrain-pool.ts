/**
 * A small pool of terrain meshing workers.
 *
 * Owns dispatch and failure; knows nothing about the streamer or the scene.
 * Results are queued rather than applied as they arrive, so the main thread
 * decides how many to turn into GPU buffers each frame — a burst of eight
 * finished LOD0 chunks uploaded in one frame is its own stutter.
 *
 * If a worker cannot be created or dies, the pool reports itself unavailable
 * and hands every job it was holding back to the caller's synchronous path.
 * Terrain must never silently stop streaming because a Worker failed.
 */
import type { TerrainMeshArrays } from '@alola/render';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from '../workers/terrain.worker.ts';

export interface TerrainJob {
  readonly key: number;
  readonly cx: number;
  readonly cz: number;
  readonly lod: number;
}

export interface TerrainResult extends TerrainJob {
  readonly arrays: TerrainMeshArrays;
  /** Worker-side meshing time, for the profiler. */
  readonly ms: number;
}

interface Slot {
  readonly worker: Worker;
  readonly pending: Map<number, TerrainJob>;
}

export class TerrainWorkerPool {
  private readonly slots: Slot[] = [];
  private readonly results: TerrainResult[] = [];
  private nextId = 1;
  private failed = false;

  /** Called with any jobs orphaned by a worker failure. */
  onFailure: ((orphans: TerrainJob[], reason: string) => void) | null = null;

  constructor(seed: number, size: number) {
    try {
      for (let i = 0; i < size; i++) {
        const worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
        const slot: Slot = { worker, pending: new Map() };
        worker.onmessage = (event: MessageEvent<TerrainWorkerResponse>) => this.receive(slot, event.data);
        worker.onerror = (event) => this.fail(`terrain worker error: ${event.message || 'unknown'}`);
        worker.postMessage({ type: 'init', seed } satisfies TerrainWorkerRequest);
        this.slots.push(slot);
      }
    } catch (error) {
      this.fail(`could not start terrain workers: ${String(error)}`);
    }
  }

  get available(): boolean {
    return !this.failed && this.slots.length > 0;
  }

  get size(): number {
    return this.slots.length;
  }

  get outstanding(): number {
    let n = 0;
    for (const slot of this.slots) n += slot.pending.size;
    return n;
  }

  /** Send a job to the least-loaded worker. */
  request(job: TerrainJob): void {
    let best = this.slots[0];
    for (const slot of this.slots) {
      if (slot.pending.size < best.pending.size) best = slot;
    }
    const id = this.nextId++;
    best.pending.set(id, job);
    best.worker.postMessage({ type: 'build', id, key: job.key, cx: job.cx, cz: job.cz, lod: job.lod } satisfies TerrainWorkerRequest);
  }

  /** Take up to `max` finished results, oldest first. */
  drain(max: number): TerrainResult[] {
    return this.results.splice(0, Math.max(0, max));
  }

  get ready(): number {
    return this.results.length;
  }

  private receive(slot: Slot, message: TerrainWorkerResponse): void {
    const job = slot.pending.get(message.id);
    slot.pending.delete(message.id);
    if (!job) return;

    if (message.type === 'error') {
      this.fail(message.message, [job]);
      return;
    }
    this.results.push({ ...job, arrays: message.arrays, ms: message.ms });
  }

  private fail(reason: string, extra: TerrainJob[] = []): void {
    if (this.failed) return;
    this.failed = true;
    const orphans = [...extra];
    for (const slot of this.slots) {
      orphans.push(...slot.pending.values());
      slot.pending.clear();
      slot.worker.terminate();
    }
    this.onFailure?.(orphans, reason);
  }

  dispose(): void {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots.length = 0;
  }
}
