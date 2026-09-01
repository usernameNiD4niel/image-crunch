import { StaleResult } from "@/lib/engine/client";
import type { MatteResponse, MatteResult } from "./types";

interface Pending {
  resolve: (result: MatteResult) => void;
  reject: (error: Error) => void;
  generation: number;
}

// A pending entry is keyed by id AND the generation it was dispatched
// under — not just id. Two matte() calls for the same row id can be in
// flight at once (a fresh request issued before an older one for the same
// id has settled, with no intervening bumpGeneration()); keying by id
// alone would let the second dispatch's Map.set overwrite the first
// entry, silently orphaning its resolve/reject forever. Mirrors
// EncodeClient's pendingKey in src/lib/engine/client.ts.
function pendingKey(id: string, generation: number): string {
  return `${id}:${generation}`;
}

// The wire protocol (MatteResponse) echoes back only id + generation, with
// no per-dispatch correlation token. So two matte() calls for the same id
// under the same generation are indistinguishable to the worker, and their
// replies are indistinguishable to us too — the composite key alone still
// collides for them. Each key therefore maps to a FIFO queue rather than a
// single entry: the worker processes/replies to messages in the order it
// received them, so the earliest still-pending dispatch for a given key is
// always the correct one to settle next.

/**
 * One worker, one model, loaded on demand.
 *
 * Deliberately NOT the encode pool: four pooled workers would mean four
 * copies of an 85 MB model, and a single inference would starve three
 * encodes for as long as it ran. The generation/staleness contract is the
 * same as EncodeClient's, so both subsystems cancel work the same way.
 */
export class MatteClient {
  private worker: Worker | null = null;
  private generation = 0;
  private pending = new Map<string, Pending[]>();
  private disposed = false;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<MatteResponse>) => this.handle(event.data);
      this.worker.onerror = (event) => this.handleWorkerError(event);
    }
    return this.worker;
  }

  private handle(message: MatteResponse): void {
    const key = pendingKey(message.id, message.generation);
    const queue = this.pending.get(key);
    if (!queue || queue.length === 0) return;
    // FIFO, not "the" entry: see the queue comment above for why a key can
    // hold more than one pending dispatch.
    const entry = queue.shift()!;
    if (queue.length === 0) this.pending.delete(key);
    // Keep the generation check even though the composite key already
    // constrains it: it costs nothing and documents the invariant a reader
    // would otherwise have to infer from pendingKey alone.
    if (entry.generation !== message.generation) return;

    if (message.type === "done") entry.resolve(message.result);
    else entry.reject(new Error(message.message));
  }

  private handleWorkerError(event: { message?: string; preventDefault?: () => void }): void {
    // Mirrors EncodeClient.handleWorkerError: without this, a hard worker
    // failure also surfaces as an uncaught error even though it is fully
    // handled here.
    event.preventDefault?.();
    const message = event.message ?? "the background-removal worker failed";
    for (const [key, queue] of this.pending) {
      for (const entry of queue) entry.reject(new Error(message));
      this.pending.delete(key);
    }
    // The model's state is unknowable after a hard failure; drop the worker
    // so the next request starts clean rather than talking to a corpse.
    this.worker?.terminate();
    this.worker = null;
  }

  bumpGeneration(): number {
    this.generation += 1;
    for (const [key, queue] of this.pending) {
      const survivors: Pending[] = [];
      for (const entry of queue) {
        if (entry.generation < this.generation) entry.reject(new StaleResult());
        else survivors.push(entry);
      }
      if (survivors.length === 0) this.pending.delete(key);
      else this.pending.set(key, survivors);
    }
    return this.generation;
  }

  matte(id: string, file: File): Promise<MatteResult> {
    if (this.disposed) return Promise.reject(new Error("MatteClient has been disposed"));

    const worker = this.ensureWorker();
    const generation = this.generation;

    return new Promise<MatteResult>((resolve, reject) => {
      const key = pendingKey(id, generation);
      const queue = this.pending.get(key) ?? [];
      queue.push({ resolve, reject, generation });
      this.pending.set(key, queue);
      worker.postMessage({ type: "matte", id, generation, file });
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const [key, queue] of this.pending) {
      for (const entry of queue) entry.reject(new StaleResult());
      this.pending.delete(key);
    }
    this.worker?.terminate();
    this.worker = null;
  }
}
