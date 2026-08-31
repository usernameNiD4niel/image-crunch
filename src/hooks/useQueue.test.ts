import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import { queueReducer, initialQueueState, useQueue } from "./useQueue";
import type { QueueItem } from "@/lib/engine/types";

function item(id: string, size = 1000): QueueItem {
  return {
    id,
    file: new File([], `${id}.png`, { type: "image/png" }),
    source: { name: `${id}.png`, type: "image/png", size, width: 100, height: 100 },
    previewUrl: `blob:${id}`,
    status: "queued",
  };
}

describe("queueReducer", () => {
  it("adds items", () => {
    const state = queueReducer(initialQueueState, { type: "add", items: [item("a"), item("b")] });
    expect(state.items).toHaveLength(2);
  });

  it("rejects items beyond the queue cap", () => {
    const many = Array.from({ length: 31 }, (_, i) => item(`f${i}`));
    const state = queueReducer(initialQueueState, { type: "add", items: many });
    expect(state.items).toHaveLength(30);
    expect(state.notice).toMatch(/30/);
  });

  it("removes an item by id", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a"), item("b")] });
    const state = queueReducer(added, { type: "remove", id: "a" });
    expect(state.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("records a result and marks the item done", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a")] });
    const state = queueReducer(added, {
      type: "result",
      id: "a",
      result: {
        blob: new Blob(),
        size: 250,
        width: 100,
        height: 100,
        mime: "image/png",
        outcome: "encoded",
      },
    });
    expect(state.items[0].status).toBe("done");
    expect(state.items[0].result?.size).toBe(250);
  });

  // These two must never collapse into one status: a vector that was never
  // decoded and a raster that was decoded and came back no smaller are
  // different facts, and the row copy for each says something different.
  it("marks a never-decoded passthrough result as passthrough", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a")] });
    const state = queueReducer(added, {
      type: "result",
      id: "a",
      result: {
        blob: new Blob(),
        size: 1000,
        width: 100,
        height: 100,
        mime: "image/svg+xml",
        outcome: "passthrough",
      },
    });
    expect(state.items[0].status).toBe("passthrough");
  });

  it("marks a re-encoded-but-not-smaller result as kept, not passthrough", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a")] });
    const state = queueReducer(added, {
      type: "result",
      id: "a",
      result: {
        blob: new Blob(),
        size: 1000,
        width: 100,
        height: 100,
        mime: "image/png",
        outcome: "kept",
      },
    });
    expect(state.items[0].status).toBe("kept");
    expect(state.items[0].status).not.toBe("passthrough");
  });

  it("defaults the output format to WebP so a first run can actually shrink", () => {
    expect(initialQueueState.settings.format).toBe("image/webp");
  });

  it("computes totals across completed items only", () => {
    let state = queueReducer(initialQueueState, { type: "add", items: [item("a", 1000), item("b", 1000)] });
    state = queueReducer(state, {
      type: "result",
      id: "a",
      result: { blob: new Blob(), size: 250, width: 1, height: 1, mime: "image/png", outcome: "encoded" },
    });
    const totals = state.items
      .filter((i) => i.status === "done")
      .reduce((acc, i) => ({ input: acc.input + i.source.size, output: acc.output + (i.result?.size ?? 0) }), {
        input: 0,
        output: 0,
      });
    expect(totals).toEqual({ input: 1000, output: 250 });
  });

  it("drops a failed row's earlier result so it cannot be counted or downloaded", () => {
    let state = queueReducer(initialQueueState, { type: "add", items: [item("a")] });
    state = queueReducer(state, {
      type: "result",
      id: "a",
      result: { blob: new Blob(), size: 250, width: 1, height: 1, mime: "image/png", outcome: "encoded" },
    });
    expect(state.items[0].result).toBeDefined();

    state = queueReducer(state, { type: "error", id: "a", message: "boom" });
    expect(state.items[0].status).toBe("error");
    expect(state.items[0].result).toBeUndefined();
  });

  it("marks an item errored without touching its neighbours", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a"), item("b")] });
    const state = queueReducer(added, { type: "error", id: "a", message: "boom" });
    expect(state.items[0].status).toBe("error");
    expect(state.items[0].error).toBe("boom");
    expect(state.items[1].status).toBe("queued");
  });
});

// --- Infinite-loop regression coverage --------------------------------
//
// The hook's re-encode effect must key off item ids + settings, NOT off
// the `items` array reference. If it (or `runAll`'s memoization) ever
// regresses to depending on `state.items` directly, a completed encode's
// "result" dispatch produces a new items array, which would re-trigger
// the effect and re-encode forever. This test drives the real hook with
// a mocked EncodeClient and asserts encode is called exactly once per
// queued item, even after settling and letting extra time pass.

const { encodeMock, bundleZipMock, MockEncodeClient, MockStaleResult } = vi.hoisted(() => {
  const bundleZipMock = vi.fn(async () => new Blob(["zip"]));
  const encodeMock = vi.fn(async () => ({
    blob: new Blob(["x"]),
    size: 10,
    width: 1,
    height: 1,
    mime: "image/png",
    outcome: "encoded",
  }));

  class MockEncodeClient {
    bumpGeneration = vi.fn();
    encode = encodeMock;
    dispose = vi.fn();
  }

  class MockStaleResult extends Error {}

  return { encodeMock, bundleZipMock, MockEncodeClient, MockStaleResult };
});

vi.mock("@/lib/engine/zip", () => ({ bundleZip: bundleZipMock }));

vi.mock("@/lib/engine/client", () => ({
  EncodeClient: MockEncodeClient,
  releaseAll: vi.fn(),
  releaseUrl: vi.fn(),
  StaleResult: MockStaleResult,
}));

describe("useQueue re-encode scheduling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    cleanup();
  });

  it("encodes each queued item once and does not loop after results settle", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useQueue());

    act(() => {
      result.current.dispatch({ type: "add", items: [item("a"), item("b")] });
    });

    // Fire the debounce timer, then flush the microtask queue so the
    // encode() promises resolve and their "result" dispatches land.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(encodeMock).toHaveBeenCalledTimes(2);

    // Let plenty more time pass with nothing else changing. If the
    // scheduling effect were keyed on `state.items` (or `runAll` closed
    // over it), the "result" dispatches above would have produced a new
    // items array, re-fired the effect, and scheduled another sweep.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(encodeMock).toHaveBeenCalledTimes(2);

    unmount();
  });
});

// --- Superseded-result coverage ---------------------------------------
//
// During the 200ms-debounced sweep that follows ANY settings change every
// row goes to "working" while still holding the previous run's blob. These
// pin that none of that reaches the user as a current figure or a download.

describe("useQueue while a re-encode is in flight", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    cleanup();
  });

  /** Queue two files, settle them, then start a sweep that never finishes. */
  async function queueThenStall() {
    vi.useFakeTimers();
    // vi.clearAllMocks() in afterEach clears calls but NOT implementations,
    // and this suite installs a never-resolving one below — restate the
    // settling implementation so each test starts from a settled queue.
    encodeMock.mockImplementation(async () => ({
      blob: new Blob(["x"]),
      size: 10,
      width: 1,
      height: 1,
      mime: "image/png",
      outcome: "encoded" as const,
    }));
    const hook = renderHook(() => useQueue());

    act(() => {
      hook.result.current.dispatch({ type: "add", items: [item("a"), item("b")] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(hook.result.current.totals.count).toBe(2);

    // Settings change -> every row goes back to "working", and this time the
    // encodes never resolve, so the sweep stays in flight.
    encodeMock.mockImplementation(() => new Promise(() => {}));
    act(() => {
      hook.result.current.dispatch({ type: "settings", settings: { quality: 40 } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(hook.result.current.items.every((i) => i.status === "working")).toBe(true);
    // The previous run's bytes are still on the items — that is the point.
    expect(hook.result.current.items.every((i) => i.result !== undefined)).toBe(true);
    return hook;
  }

  it("excludes rows that are re-encoding from the totals", async () => {
    const hook = await queueThenStall();
    expect(hook.result.current.totals).toMatchObject({ count: 0, input: 0, output: 0 });
    hook.unmount();
  });

  it("downloadAll refuses to build a zip while any item is working", async () => {
    const hook = await queueThenStall();
    await act(async () => {
      await hook.result.current.downloadAll();
    });
    expect(bundleZipMock).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("downloadOne hands out nothing for a row that is re-encoding", async () => {
    const hook = await queueThenStall();
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");

    act(() => {
      hook.result.current.downloadOne(hook.result.current.items[0]);
    });

    // save() is the only thing that mints a URL here; not reaching it proves
    // no bytes were offered.
    expect(createUrl).not.toHaveBeenCalled();
    createUrl.mockRestore();
    hook.unmount();
  });

  it("downloadAll works again once the sweep settles", async () => {
    const hook = await queueThenStall();
    encodeMock.mockImplementation(async () => ({
      blob: new Blob(["y"]),
      size: 20,
      width: 1,
      height: 1,
      mime: "image/png",
      outcome: "encoded" as const,
    }));

    // Re-trigger a sweep that this time completes.
    act(() => {
      hook.result.current.dispatch({ type: "settings", settings: { quality: 41 } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:zip");
    await act(async () => {
      await hook.result.current.downloadAll();
    });
    expect(bundleZipMock).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});
