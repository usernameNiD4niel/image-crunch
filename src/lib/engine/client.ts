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
}

export class EncodeClient {
  private workers: Worker[] = [];
  private next = 0;
  private generation = 0;
  private pending = new Map<string, Pending>();
  private readonly useWorkers = canUseOffscreen() && typeof Worker !== "undefined";

  constructor() {
    if (!this.useWorkers) return;

    const size = Math.max(1, Math.min(3, navigator.hardwareConcurrency || 2));
    for (let i = 0; i < size; i += 1) {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event) => this.handle(event.data);
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
    for (const [id, entry] of this.pending) {
      if (entry.generation < this.generation) {
        entry.reject(new StaleResult());
        this.pending.delete(id);
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
    const generation = this.generation;

    if (!this.useWorkers) {
      const result = await encodeOne(file, source, settings);
      if (generation < this.generation) throw new StaleResult();
      return result;
    }

    return new Promise<EncodeResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, generation });
      const worker = this.workers[this.next % this.workers.length];
      this.next += 1;
      worker.postMessage({ type: "encode", id, generation, file, source, settings });
    });
  }

  private handle(data: { type: string; id: string; generation: number; result?: EncodeResult; message?: string }) {
    const entry = this.pending.get(data.id);
    if (!entry) return;
    this.pending.delete(data.id);

    if (data.generation < this.generation) {
      entry.reject(new StaleResult());
      return;
    }

    if (data.type === "done" && data.result) entry.resolve(data.result);
    else entry.reject(new Error(data.message ?? "Encoding failed"));
  }

  dispose(): void {
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
