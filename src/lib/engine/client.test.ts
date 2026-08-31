import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EncodeClient, StaleResult, trackUrl, releaseUrl, releaseAll } from "./client";
import { canUseOffscreen, encodeOne } from "./encode";
import type { EncodeResult, EncodeSettings, SourceInfo } from "./types";

vi.mock("./encode", () => ({
  canUseOffscreen: vi.fn(() => false),
  encodeOne: vi.fn(),
}));

describe("blob-URL registry", () => {
  beforeEach(() => {
    // jsdom's URL.revokeObjectURL is a no-op stub; spy on it so we can
    // assert it is called the right number of times without depending
    // on real object-URL semantics. Also drain the module-level registry
    // so tests are not order-dependent on leftovers from a prior test.
    vi.restoreAllMocks();
    releaseAll();
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  it("trackUrl returns the url unchanged and registers it", () => {
    expect(trackUrl("blob:a")).toBe("blob:a");
  });

  it("releaseUrl revokes a tracked url exactly once, even if called twice", () => {
    trackUrl("blob:b");
    releaseUrl("blob:b");
    releaseUrl("blob:b");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:b");
  });

  it("releaseUrl on an untracked url does nothing", () => {
    releaseUrl("blob:never-tracked");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("releaseAll revokes every remaining tracked url and clears the registry", () => {
    trackUrl("blob:c");
    trackUrl("blob:d");
    releaseAll();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:c");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:d");

    // Registry is empty now: a second releaseAll revokes nothing new.
    vi.mocked(URL.revokeObjectURL).mockClear();
    releaseAll();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A minimal message-passing double standing in for the browser Worker. It
// never touches OffscreenCanvas or produces a real encoded image — it only
// records postMessage calls and lets a test manually fire onmessage/onerror,
// which is exactly the seam client.ts owns (message routing and pending-map
// bookkeeping). This is NOT the kind of worker mock the brief bans (faking
// that real image encoding happened); encodeOne/canUseOffscreen stay mocked
// separately and are never asked to pretend they produced real output here.
// ---------------------------------------------------------------------------
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}

const fakeFile = () => new File(["x"], "a.png", { type: "image/png" });
const fakeSource: SourceInfo = { name: "a.png", type: "image/png", size: 1, width: 10, height: 10 };
const fakeSettings: EncodeSettings = { quality: 80, resize: "none", format: "keep" };
const fakeResult = (n: number): EncodeResult => ({
  blob: new Blob([String(n)]),
  size: n,
  width: 10,
  height: 10,
  mime: "image/png",
  keptOriginal: false,
});

describe("EncodeClient — fallback (main-thread) path", () => {
  beforeEach(() => {
    vi.mocked(canUseOffscreen).mockReturnValue(false);
    vi.mocked(encodeOne).mockReset();
  });

  it("dispose is safe to call with nothing pending and safe to call twice", () => {
    const client = new EncodeClient();
    expect(() => client.dispose()).not.toThrow();
    expect(() => client.dispose()).not.toThrow();
  });

  it("StaleResult is a thrown Error subclass distinguishable from a real failure", () => {
    const err = new StaleResult();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StaleResult");
  });

  it("rejects with StaleResult when bumpGeneration lands while encodeOne is still in flight", async () => {
    let resolveEncode!: (r: EncodeResult) => void;
    vi.mocked(encodeOne).mockReturnValue(
      new Promise<EncodeResult>((resolve) => {
        resolveEncode = resolve;
      }),
    );

    const client = new EncodeClient();
    const promise = client.encode("id1", fakeFile(), fakeSource, fakeSettings);

    // Settings changed mid-encode.
    client.bumpGeneration();
    resolveEncode(fakeResult(1));

    await expect(promise).rejects.toBeInstanceOf(StaleResult);
  });

  it("encode() after dispose() rejects cleanly instead of throwing from a null worker lookup", async () => {
    vi.mocked(encodeOne).mockResolvedValue(fakeResult(1));
    const client = new EncodeClient();
    client.dispose();

    await expect(client.encode("id1", fakeFile(), fakeSource, fakeSettings)).rejects.toThrow(
      /disposed/i,
    );
  });
});

describe("EncodeClient — pooled worker path", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
    vi.mocked(canUseOffscreen).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bumpGeneration settles an in-flight pooled entry with StaleResult without any worker reply", async () => {
    const client = new EncodeClient();
    const promise = client.encode("id1", fakeFile(), fakeSource, fakeSettings);

    // No worker ever posts back — this simulates worker.ts's real behavior
    // of silently dropping a reply for a generation it no longer considers
    // current. The client must not wait for a message that will never come.
    client.bumpGeneration();

    await expect(promise).rejects.toBeInstanceOf(StaleResult);
    client.dispose();
  });

  it("a stale-generation reply for a given id does not settle or delete a NEWER entry for the same id", async () => {
    // Pool size is Math.max(1, Math.min(3, hardwareConcurrency || 2)) — at
    // least 2 workers, so two dispatches for the same id can land on two
    // different workers, reproducing the Critical-1 trace.
    const client = new EncodeClient();
    expect(FakeWorker.instances.length).toBeGreaterThanOrEqual(2);

    // 1) encode("x") at generation 0 -> dispatched to worker 0.
    const stalePromise = client.encode("x", fakeFile(), fakeSource, fakeSettings);
    const workerForStale = FakeWorker.instances[0];

    // 2) Settings change: generation 0 is now stale. The client proactively
    // rejects the entry for the stale dispatch.
    client.bumpGeneration();
    await expect(stalePromise).rejects.toBeInstanceOf(StaleResult);

    // 3) A fresh encode("x") at generation 1 -> dispatched to worker 1.
    const freshPromise = client.encode("x", fakeFile(), fakeSource, fakeSettings);
    const workerForFresh = FakeWorker.instances[1];
    expect(workerForFresh).not.toBe(workerForStale);

    // 4) Worker 0 (the stale one) only now gets around to posting its
    // generation-0 result for id "x" — late, out of band, after the fresh
    // dispatch for the same id is already in flight.
    workerForStale.onmessage?.({
      data: { type: "done", id: "x", generation: 0, result: fakeResult(0) },
    });

    // 5) Worker 1 posts the real, current result for the fresh dispatch.
    workerForFresh.onmessage?.({
      data: { type: "done", id: "x", generation: 1, result: fakeResult(1) },
    });

    // The fresh promise must resolve with the fresh result — the late,
    // stale-generation reply from worker 0 must not have touched it.
    await expect(freshPromise).resolves.toEqual(fakeResult(1));
    client.dispose();
  });

  it("a native worker error rejects only that worker's own pending entries", async () => {
    const client = new EncodeClient();
    expect(FakeWorker.instances.length).toBeGreaterThanOrEqual(2);

    const p0 = client.encode("a", fakeFile(), fakeSource, fakeSettings); // worker 0
    const p1 = client.encode("b", fakeFile(), fakeSource, fakeSettings); // worker 1

    FakeWorker.instances[0].onerror?.({ message: "boom", preventDefault: () => {} });

    await expect(p0).rejects.toThrow(/boom/);

    // The other worker's pending work must be unaffected.
    FakeWorker.instances[1].onmessage?.({
      data: { type: "done", id: "b", generation: 0, result: fakeResult(2) },
    });
    await expect(p1).resolves.toEqual(fakeResult(2));
    client.dispose();
  });

  it("a dead worker is removed from rotation and replaced so subsequent work does not hang", async () => {
    const client = new EncodeClient();
    const initialCount = FakeWorker.instances.length;
    expect(initialCount).toBeGreaterThanOrEqual(2);

    const deadWorker = FakeWorker.instances[0];
    const p0 = client.encode("a", fakeFile(), fakeSource, fakeSettings); // -> worker 0 (about to die)
    deadWorker.onerror?.({ message: "boom", preventDefault: () => {} });
    await expect(p0).rejects.toThrow(/boom/);

    // The pool self-heals: a replacement worker is spawned to keep the
    // pool at full strength, rather than leaving the dead one in rotation.
    expect(FakeWorker.instances.length).toBe(initialCount + 1);
    deadWorker.postMessage.mockClear();

    // The next dispatch must never be routed back to the dead worker, and
    // must actually be able to complete — proving the pool did not just
    // silently start black-holing every Nth request.
    const p1 = client.encode("b", fakeFile(), fakeSource, fakeSettings);
    expect(deadWorker.postMessage).not.toHaveBeenCalled();

    const recipient = FakeWorker.instances.find(
      (w) => w !== deadWorker && w.postMessage.mock.calls.length > 0,
    );
    expect(recipient).toBeDefined();
    const [sentMessage] = recipient!.postMessage.mock.calls.at(-1)!;
    recipient!.onmessage?.({
      data: { type: "done", id: sentMessage.id, generation: sentMessage.generation, result: fakeResult(9) },
    });

    await expect(p1).resolves.toEqual(fakeResult(9));
    client.dispose();
  });
});
