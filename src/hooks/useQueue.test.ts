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

const { encodeMock, MockEncodeClient, MockStaleResult } = vi.hoisted(() => {
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

  return { encodeMock, MockEncodeClient, MockStaleResult };
});

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
