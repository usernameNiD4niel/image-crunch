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
  workerIndex: number;
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

export class EncodeClient {
  private workers: Worker[] = [];
  private next = 0;
  private generation = 0;
  private pending = new Map<string, Pending>();
  private disposed = false;
  private readonly useWorkers = canUseOffscreen() && typeof Worker !== "undefined";

  constructor() {
    if (!this.useWorkers) return;

    const size = Math.max(1, Math.min(3, navigator.hardwareConcurrency || 2));
    for (let i = 0; i < size; i += 1) {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event) => this.handle(event.data);
      // A native `error` event (module-evaluation failure, a synchronous
      // throw before worker.ts's try/catch, a structured-clone failure
      // on postMessage) never produces a done/error message, so handle()
      // would never run for it. Without this, the entry that dispatch
      // created sits in `pending` until some FUTURE bumpGeneration
      // happens to reap it — if the user never changes settings again,
      // it hangs forever. Reject only THIS worker's pending entries;
      // other workers' in-flight work is unaffected.
      worker.onerror = (event) => this.handleWorkerError(i, event);
      this.workers.push(worker);
    }
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

    if (!this.useWorkers) {
      const result = await encodeOne(file, source, settings);
      if (generation < this.generation) throw new StaleResult();
      return result;
    }

    const workerIndex = this.next % this.workers.length;
    this.next += 1;

    return new Promise<EncodeResult>((resolve, reject) => {
      this.pending.set(pendingKey(id, generation), { resolve, reject, generation, workerIndex });
      this.workers[workerIndex].postMessage({ type: "encode", id, generation, file, source, settings });
    });
  }

  private handle(data: { type: string; id: string; generation: number; result?: EncodeResult; message?: string }) {
    const key = pendingKey(data.id, data.generation);
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);

    if (data.generation < this.generation) {
      entry.reject(new StaleResult());
      return;
    }

    if (data.type === "done" && data.result) entry.resolve(data.result);
    else entry.reject(new Error(data.message ?? "Encoding failed"));
  }

  private handleWorkerError(workerIndex: number, event: ErrorEvent) {
    event.preventDefault?.();
    const message = event.message || "Worker encountered an unrecoverable error";
    for (const [key, entry] of this.pending) {
      if (entry.workerIndex === workerIndex) {
        entry.reject(new Error(message));
        this.pending.delete(key);
      }
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

    for (const worker of this.workers) worker.terminate();
    this.workers = [];
  }
}

export class StaleResult extends Error {
  constructor() {
    super("Superseded by newer settings");
    this.name = "StaleResult";
  }
}
