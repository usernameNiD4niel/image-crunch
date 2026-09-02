import { StaleResult } from "@/lib/engine/client";
import type { MatteResponse, MatteResult } from "./types";

interface Pending {
  resolve: (result: MatteResult) => void;
  reject: (error: Error) => void;
  generation: number;
}

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
  // Keyed by seq, not id (or id+generation): worker.ts's self.onmessage is
  // async with no serialization, so two overlapping matte() calls for the
  // same id interleave at every await and can finish in EITHER order — a
  // smaller file can decode and infer faster than one dispatched earlier.
  // seq is a client-generated, per-dispatch-unique correlation token that
  // the worker echoes back unchanged, so a reply always resolves the exact
  // request that produced it, never "whichever one happened to be next in
  // a queue".
  private pending = new Map<number, Pending>();
  private nextSeq = 0;
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
    const entry = this.pending.get(message.seq);
    // Not just "unknown seq": a late reply for a generation we have already
    // superseded must be dropped, never delivered. seq alone would still
    // find the entry (it's unique), but the generation check is what makes
    // a superseded reply droppable rather than resolving stale state.
    if (!entry || entry.generation !== message.generation) return;
    this.pending.delete(message.seq);

    if (message.type === "done") entry.resolve(message.result);
    else entry.reject(new Error(message.message));
  }

  private handleWorkerError(event: { message?: string; preventDefault?: () => void }): void {
    // Mirrors EncodeClient.handleWorkerError: without this, a hard worker
    // failure also surfaces as an uncaught error even though it is fully
    // handled here.
    event.preventDefault?.();
    const message = event.message ?? "the background-removal worker failed";
    for (const [seq, entry] of this.pending) {
      entry.reject(new Error(message));
      this.pending.delete(seq);
    }
    // The model's state is unknowable after a hard failure; drop the worker
    // so the next request starts clean rather than talking to a corpse.
    this.worker?.terminate();
    this.worker = null;
  }

  bumpGeneration(): number {
    this.generation += 1;
    for (const [seq, entry] of this.pending) {
      if (entry.generation < this.generation) {
        entry.reject(new StaleResult());
        this.pending.delete(seq);
      }
    }
    return this.generation;
  }

  matte(id: string, file: File): Promise<MatteResult> {
    if (this.disposed) return Promise.reject(new Error("MatteClient has been disposed"));

    const worker = this.ensureWorker();
    const generation = this.generation;
    const seq = this.nextSeq;
    this.nextSeq += 1;

    return new Promise<MatteResult>((resolve, reject) => {
      this.pending.set(seq, { resolve, reject, generation });
      worker.postMessage({ type: "matte", id, generation, seq, file });
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const [seq, entry] of this.pending) {
      entry.reject(new StaleResult());
      this.pending.delete(seq);
    }
    this.worker?.terminate();
    this.worker = null;
  }
}
