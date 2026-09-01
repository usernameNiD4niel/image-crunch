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

    worker.onmessage!({ data: { type: "done", id: "a", generation: sent.generation, result: result() } });

    await expect(promise).resolves.toMatchObject({ width: 10, height: 10 });
  });

  it("rejects with the worker's message on failure", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    const worker = FakeWorker.instances[0];
    const sent = worker.postMessage.mock.calls[0][0];

    worker.onmessage!({ data: { type: "error", id: "a", generation: sent.generation, message: "out of memory" } });

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
    client.bumpGeneration();
    await expect(promise).rejects.toBeInstanceOf(StaleResult);

    const worker = FakeWorker.instances[0];
    expect(() =>
      worker.onmessage!({ data: { type: "done", id: "a", generation: 0, result: result() } }),
    ).not.toThrow();
  });

  it("rejects everything pending when the worker dies", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    FakeWorker.instances[0].onerror!({ message: "worker exploded" });
    await expect(promise).rejects.toThrow(/worker/i);
  });

  it("refuses work after disposal and terminates the worker", async () => {
    const client = new MatteClient();
    client.matte("a", file()).catch(() => {});
    client.dispose();
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    await expect(client.matte("b", file())).rejects.toThrow(/disposed/i);
  });
});
