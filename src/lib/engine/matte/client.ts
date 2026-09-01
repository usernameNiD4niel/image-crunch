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
  private pending = new Map<string, Pending>();
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
    const entry = this.pending.get(message.id);
    // Not just "unknown id": a late reply for a generation we have already
    // superseded must be dropped, never delivered.
    if (!entry || entry.generation !== message.generation) return;
    this.pending.delete(message.id);

    if (message.type === "done") entry.resolve(message.result);
    else entry.reject(new Error(message.message));
  }

  private handleWorkerError(event: { message?: string }): void {
    const message = event.message ?? "the background-removal worker failed";
    for (const [id, entry] of this.pending) {
      entry.reject(new Error(message));
      this.pending.delete(id);
    }
    // The model's state is unknowable after a hard failure; drop the worker
    // so the next request starts clean rather than talking to a corpse.
    this.worker?.terminate();
    this.worker = null;
  }

  bumpGeneration(): number {
    this.generation += 1;
    for (const [id, entry] of this.pending) {
      if (entry.generation < this.generation) {
        entry.reject(new StaleResult());
        this.pending.delete(id);
      }
    }
    return this.generation;
  }

  matte(id: string, file: File): Promise<MatteResult> {
    if (this.disposed) return Promise.reject(new Error("MatteClient has been disposed"));

    const worker = this.ensureWorker();
    const generation = this.generation;

    return new Promise<MatteResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, generation });
      worker.postMessage({ type: "matte", id, generation, file });
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const [id, entry] of this.pending) {
      entry.reject(new StaleResult());
      this.pending.delete(id);
    }
    this.worker?.terminate();
    this.worker = null;
  }
}
