import type { EncodeResult, EncodeSettings, SourceInfo } from "./types";
import { canUseOffscreen, encodeOne } from "./encode";

const liveUrls = new Set<string>();

export function trackUrl(url: string): string {
  liveUrls.add(url);
  return url;
}

export function releaseUrl(url: string): void {
  if (liveUrls.delete(url)) URL.revokeObjectURL(url);
}

export function releaseAll(): void {
  for (const url of liveUrls) URL.revokeObjectURL(url);
  liveUrls.clear();
}

interface Pending {
  resolve: (r: EncodeResult) => void;
  reject: (e: Error) => void;
  generation: number;
  // A stable identity for the worker a request was dispatched to. This is
  // NOT an array index: the pool self-heals by removing dead workers (see
  // handleWorkerError), which would shift array positions out from under
  // any entry still storing a plain index. An ever-incrementing id survives
  // that.
  workerId: number;
}

// A pending entry is keyed by id AND the generation it was dispatched
// under. Two different dispatches for the same queue item id (an old,
// now-stale one and a fresh replacement) can be in flight on two
// different pooled workers at once — each worker tracks staleness
// against its OWN local generation counter (see worker.ts), so a late
// reply from the worker that ran the stale dispatch must never be able
// to resolve/reject the entry created by the fresh dispatch. Composing
// the key from both fields makes that structurally impossible: a reply
// can only ever look up the exact entry its own dispatch created.
function pendingKey(id: string, generation: number): string {
  return `${id}:${generation}`;
}

interface WorkerSlot {
  id: number;
  worker: Worker;
}

export class EncodeClient {
  private workers: WorkerSlot[] = [];
  private nextWorkerId = 0;
  private poolSize = 0;
  private next = 0;
  private generation = 0;
  private pending = new Map<string, Pending>();
  private disposed = false;
  // Not readonly: a worker pool that fails to self-heal (see
  // handleWorkerError) falls back to the main-thread path for all future
  // work rather than dispatching into an empty pool and hanging.
  private useWorkers = canUseOffscreen() && typeof Worker !== "undefined";

  constructor() {
    if (!this.useWorkers) return;

    this.poolSize = Math.max(1, Math.min(3, navigator.hardwareConcurrency || 2));
    for (let i = 0; i < this.poolSize; i += 1) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): void {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    } catch {
      // Construction itself failed (e.g. the module can't be evaluated at
      // all). Don't retry in a loop here — handleWorkerError's caller
      // already falls back to the main-thread path if the pool ends up
      // empty.
      return;
    }

    const slot: WorkerSlot = { id: this.nextWorkerId, worker };
    this.nextWorkerId += 1;

    worker.onmessage = (event) => this.handle(event.data);
    // A native `error` event (module-evaluation failure, a synchronous
    // throw before worker.ts's try/catch, a structured-clone failure
    // on postMessage) never produces a done/error message, so handle()
    // would never run for it. Without this, the entry that dispatch
    // created sits in `pending` until some FUTURE bumpGeneration
    // happens to reap it — if the user never changes settings again,
    // it hangs forever. Reject only THIS worker's pending entries;
    // other workers' in-flight work is unaffected.
    worker.onerror = (event) => this.handleWorkerError(slot.id, event);

    this.workers.push(slot);
  }

  bumpGeneration(): number {
    this.generation += 1;

    // The worker silently drops any response for a now-stale generation
    // (see worker.ts: it just `return`s without posting). Any pending
    // entry whose generation predates this bump can therefore NEVER
    // receive a "done"/"error" message from the worker, so its promise
    // must be settled here — proactively, not by waiting for a message
    // that will never arrive.
    for (const [key, entry] of this.pending) {
      if (entry.generation < this.generation) {
        entry.reject(new StaleResult());
        this.pending.delete(key);
      }
    }

    return this.generation;
  }

  async encode(
    id: string,
    file: File,
    source: SourceInfo,
    settings: EncodeSettings,
  ): Promise<EncodeResult> {
    if (this.disposed) {
      throw new Error("EncodeClient has been disposed");
    }

    const generation = this.generation;

    if (!this.useWorkers || this.workers.length === 0) {
      const result = await encodeOne(file, source, settings);
      if (generation < this.generation) throw new StaleResult();
      return result;
    }

    const slot = this.workers[this.next % this.workers.length];
    this.next += 1;

    return new Promise<EncodeResult>((resolve, reject) => {
      this.pending.set(pendingKey(id, generation), { resolve, reject, generation, workerId: slot.id });
      slot.worker.postMessage({ type: "encode", id, generation, file, source, settings });
    });
  }

  private handle(data: { type: string; id: string; generation: number; result?: EncodeResult; message?: string }) {
    const key = pendingKey(data.id, data.generation);
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);

    // No staleness re-check here: the composite key already guarantees
    // entry.generation === data.generation for any successful lookup, and
    // bumpGeneration() sweeps every entry whose generation trails the
    // current one SYNCHRONOUSLY — fully, before returning — so by the time
    // this handler ever runs (always as a later task/microtask reacting to
    // a worker message) any entry that fell behind is already gone. There
    // is no interleaving that lets a stale entry reach this point.
    if (data.type === "done" && data.result) entry.resolve(data.result);
    else entry.reject(new Error(data.message ?? "Encoding failed"));
  }

  private handleWorkerError(workerId: number, event: ErrorEvent) {
    event.preventDefault?.();
    const message = event.message || "Worker encountered an unrecoverable error";
    for (const [key, entry] of this.pending) {
      if (entry.workerId === workerId) {
        entry.reject(new Error(message));
        this.pending.delete(key);
      }
    }

    // A worker killed by a module-evaluation failure or an early
    // synchronous throw generally will NOT fire further `onerror` events —
    // the browser just silently swallows later postMessage calls to it.
    // Leaving it in the round-robin rotation would black-hole one-in-N
    // future encode() calls (no done, no error, no onerror — the exact
    // symptom this handler exists to eliminate). Remove it for good.
    const index = this.workers.findIndex((slot) => slot.id === workerId);
    if (index !== -1) {
      this.workers[index].worker.terminate();
      this.workers.splice(index, 1);
    }

    // Try to keep the pool at full strength so the pool self-heals rather
    // than shrinking one dead worker at a time.
    if (!this.disposed && this.workers.length < this.poolSize) {
      this.spawnWorker();
    }

    // If the pool is now empty (replacement construction failed too, or
    // this was a size-1 pool with no replacement yet), don't dispatch
    // future work into nothing: fall back to the main-thread path, same
    // as when workers are unavailable at construction time.
    if (this.workers.length === 0) {
      this.useWorkers = false;
    }
  }

  dispose(): void {
    this.disposed = true;

    // Never leave a mounted-away caller's promise dangling: settle
    // everything still outstanding before tearing workers down.
    for (const entry of this.pending.values()) {
      entry.reject(new StaleResult());
    }
    this.pending.clear();

    for (const slot of this.workers) slot.worker.terminate();
    this.workers = [];
  }
}

export class StaleResult extends Error {
  constructor() {
    super("Superseded by newer settings");
    this.name = "StaleResult";
  }
}
