import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MatteClient } from "./client";
import { StaleResult } from "@/lib/engine/client";

// The same shape of double used in engine/client.test.ts: it records
// postMessage and lets the test fire onmessage by hand. It never pretends
// to have produced a real cut-out — the seam under test is message routing
// and pending-map bookkeeping, nothing else.
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}

const file = () => new File(["x"], "a.png", { type: "image/png" });
const result = () => ({ blob: new Blob(["cut"]), width: 10, height: 10 });

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MatteClient", () => {
  it("spawns no worker until the first request, so nobody pays for a model they never use", () => {
    const client = new MatteClient();
    expect(FakeWorker.instances).toHaveLength(0);
    client.matte("a", file());
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("reuses the one worker across requests rather than reloading the model", () => {
    const client = new MatteClient();
    client.matte("a", file());
    client.matte("b", file());
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("resolves with the cut-out the worker reports", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    const worker = FakeWorker.instances[0];
    const sent = worker.postMessage.mock.calls[0][0];

    worker.onmessage!({ data: { type: "done", id: "a", generation: sent.generation, seq: sent.seq, result: result() } });

    await expect(promise).resolves.toMatchObject({ width: 10, height: 10 });
  });

  it("rejects with the worker's message on failure", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    const worker = FakeWorker.instances[0];
    const sent = worker.postMessage.mock.calls[0][0];

    worker.onmessage!({
      data: { type: "error", id: "a", generation: sent.generation, seq: sent.seq, message: "out of memory" },
    });

    await expect(promise).rejects.toThrow("out of memory");
  });

  // A cut-out the user cancelled (by removing the row, or resetting) must
  // not land later and resurrect state that has moved on.
  it("rejects an in-flight request with StaleResult when the generation is bumped", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    client.bumpGeneration();
    await expect(promise).rejects.toBeInstanceOf(StaleResult);
  });

  it("ignores a late reply for a superseded generation", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    const worker = FakeWorker.instances[0];
    const sent = worker.postMessage.mock.calls[0][0];
    client.bumpGeneration();
    await expect(promise).rejects.toBeInstanceOf(StaleResult);

    expect(() =>
      worker.onmessage!({
        data: { type: "done", id: "a", generation: sent.generation, seq: sent.seq, result: result() },
      }),
    ).not.toThrow();
  });

  it("rejects everything pending when the worker dies", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    FakeWorker.instances[0].onerror!({ message: "worker exploded" });
    await expect(promise).rejects.toThrow(/worker/i);
  });

  // Two dispatches for the same row id, in flight at once, with no
  // generation bump between them (e.g. the user re-triggers the same row
  // before its first request has settled). Keying `pending` by id alone
  // would let the second dispatch's entry overwrite the first's, leaving
  // the first caller's promise hanging forever.
  it("settles both requests independently when the same id is dispatched twice before either settles", async () => {
    const client = new MatteClient();
    const firstPromise = client.matte("row-1", file());
    const secondPromise = client.matte("row-1", file());
    const worker = FakeWorker.instances[0];

    expect(worker.postMessage.mock.calls).toHaveLength(2);
    const firstSent = worker.postMessage.mock.calls[0][0];
    const secondSent = worker.postMessage.mock.calls[1][0];
    expect(firstSent.generation).toBe(secondSent.generation);
    expect(firstSent.seq).not.toBe(secondSent.seq);

    const firstResult = { blob: new Blob(["first"]), width: 1, height: 1 };
    const secondResult = { blob: new Blob(["second"]), width: 2, height: 2 };

    worker.onmessage!({
      data: { type: "done", id: "row-1", generation: firstSent.generation, seq: firstSent.seq, result: firstResult },
    });
    worker.onmessage!({
      data: { type: "done", id: "row-1", generation: secondSent.generation, seq: secondSent.seq, result: secondResult },
    });

    await expect(firstPromise).resolves.toMatchObject({ width: 1, height: 1 });
    await expect(secondPromise).resolves.toMatchObject({ width: 2, height: 2 });
  });

  // worker.ts's self.onmessage is async with no serialization: two
  // overlapping requests interleave at every await (RawImage.fromBlob,
  // processor(), model(), createImageBitmap), so the SECOND dispatch can
  // finish and reply before the first — e.g. a smaller file decodes
  // faster. A correlation scheme that assumes in-order replies (a FIFO
  // queue keyed by id+generation, say) would hand the wrong result to the
  // wrong caller here with no error. seq must make each reply resolve
  // its own request regardless of delivery order.
  it("resolves the correct promise even when replies for the same id arrive in reverse dispatch order", async () => {
    const client = new MatteClient();
    const firstPromise = client.matte("row-1", file());
    const secondPromise = client.matte("row-1", file());
    const worker = FakeWorker.instances[0];

    const firstSent = worker.postMessage.mock.calls[0][0];
    const secondSent = worker.postMessage.mock.calls[1][0];

    const firstResult = { blob: new Blob(["first"]), width: 1, height: 1 };
    const secondResult = { blob: new Blob(["second"]), width: 2, height: 2 };

    // Reverse order: the second request's reply arrives first.
    worker.onmessage!({
      data: { type: "done", id: "row-1", generation: secondSent.generation, seq: secondSent.seq, result: secondResult },
    });
    worker.onmessage!({
      data: { type: "done", id: "row-1", generation: firstSent.generation, seq: firstSent.seq, result: firstResult },
    });

    await expect(firstPromise).resolves.toMatchObject({ width: 1, height: 1 });
    await expect(secondPromise).resolves.toMatchObject({ width: 2, height: 2 });
  });

  it("refuses work after disposal and terminates the worker", async () => {
    const client = new MatteClient();
    client.matte("a", file()).catch(() => {});
    client.dispose();
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    await expect(client.matte("b", file())).rejects.toThrow(/disposed/i);
  });
});
