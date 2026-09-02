import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import { queueReducer, initialQueueState, useQueue } from "./useQueue";
import { currentResult } from "@/lib/engine/plan";
import { releaseUrl } from "@/lib/engine/client";
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
    expect(state.notices.map((n) => n.message).join(" ")).toMatch(/30/);
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

const { matteMock, matteBumpGenerationMock, MockMatteClient } = vi.hoisted(() => {
  const matteMock = vi.fn(async () => ({ blob: new Blob(["cut"]), width: 100, height: 100 }));
  // Shared across instances, like encodeMock/MockEncodeClient above: useQueue
  // constructs exactly one MatteClient per mount, and the test needs to
  // assert on the SAME mock the hook actually calls — a fresh per-instance
  // vi.fn() (the field-initializer default) would be unreachable from here.
  const matteBumpGenerationMock = vi.fn();
  class MockMatteClient {
    matte = matteMock;
    bumpGeneration = matteBumpGenerationMock;
    dispose = vi.fn();
  }
  return { matteMock, matteBumpGenerationMock, MockMatteClient };
});

vi.mock("@/lib/engine/matte/client", () => ({ MatteClient: MockMatteClient }));

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

// A drop's report used to be a single string, so two drops landing within a
// tick of each other — or one drop's screening message and the queue-cap
// rejection from the same drop — silently overwrote one another, and the
// message that lost the race was never seen at all.
describe("queueReducer notices", () => {
  it("keeps both messages when a second notice arrives before the first is dismissed", () => {
    const one = queueReducer(initialQueueState, { type: "notice", message: "3 unsupported file(s) skipped." });
    const two = queueReducer(one, { type: "notice", message: "1 file(s) could not be read." });
    expect(two.notices.map((n) => n.message)).toEqual([
      "3 unsupported file(s) skipped.",
      "1 file(s) could not be read.",
    ]);
  });

  it("gives each notice its own id", () => {
    const one = queueReducer(initialQueueState, { type: "notice", message: "a" });
    const two = queueReducer(one, { type: "notice", message: "a" });
    expect(two.notices[0].id).not.toBe(two.notices[1].id);
  });

  it("dismisses one notice by id and leaves the rest standing", () => {
    const one = queueReducer(initialQueueState, { type: "notice", message: "a" });
    const two = queueReducer(one, { type: "notice", message: "b" });
    const state = queueReducer(two, { type: "dismiss-notice", id: two.notices[0].id });
    expect(state.notices.map((n) => n.message)).toEqual(["b"]);
  });

  it("clears every notice at once", () => {
    const one = queueReducer(initialQueueState, { type: "notice", message: "a" });
    const two = queueReducer(one, { type: "notice", message: "b" });
    expect(queueReducer(two, { type: "clear-notices" }).notices).toEqual([]);
  });

  it("keeps only the three most recent notices", () => {
    const state = ["a", "b", "c", "d"].reduce(
      (acc, message) => queueReducer(acc, { type: "notice", message }),
      initialQueueState,
    );
    expect(state.notices.map((n) => n.message)).toEqual(["b", "c", "d"]);
  });

  it("carries the queue-cap rejection alongside a message already standing", () => {
    const dropped = queueReducer(initialQueueState, { type: "notice", message: "1 file(s) could not be read." });
    const state = queueReducer(dropped, {
      type: "add",
      items: Array.from({ length: 31 }, (_, i) => item(`f${i}`)),
    });
    expect(state.notices).toHaveLength(2);
    expect(state.notices[0].message).toMatch(/could not be read/);
    expect(state.notices[1].message).toMatch(/30/);
  });
});

describe("queueReducer reset", () => {
  it("empties the queue", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a"), item("b")] });
    expect(queueReducer(added, { type: "reset" }).items).toEqual([]);
  });

  it("clears standing notices, which only ever reported on the files being cleared", () => {
    const noticed = queueReducer(initialQueueState, { type: "notice", message: "3 unsupported file(s) skipped." });
    expect(queueReducer(noticed, { type: "reset" }).notices).toEqual([]);
  });

  it("keeps the settings — reset clears files, not preferences", () => {
    const tuned = queueReducer(initialQueueState, { type: "settings", settings: { quality: 40, format: "image/png" } });
    const state = queueReducer(tuned, { type: "reset" });
    expect(state.settings).toEqual({ quality: 40, resize: "none", format: "image/png", icon: 64 });
  });
});

describe("queueReducer settings changes", () => {
  const encoded = {
    blob: new Blob(),
    size: 250,
    width: 100,
    height: 100,
    mime: "image/png",
    outcome: "encoded" as const,
  };

  function settled() {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a")] });
    return queueReducer(added, { type: "result", id: "a", result: encoded });
  }

  it("returns settled rows to queued when a setting actually changes", () => {
    const state = queueReducer(settled(), { type: "settings", settings: { quality: 40 } });
    expect(state.items[0].status).toBe("queued");
    expect(currentResult(state.items[0])).toBeUndefined();
  });

  it("keeps the previous bytes on the item so the compare panel does not tear down", () => {
    const state = queueReducer(settled(), { type: "settings", settings: { quality: 40 } });
    expect(state.items[0].result).toEqual(encoded);
  });

  it("leaves rows alone when the dispatched settings match the current ones", () => {
    const before = settled();
    const state = queueReducer(before, { type: "settings", settings: { quality: before.settings.quality } });
    expect(state.items[0].status).toBe("done");
    expect(state.items).toBe(before.items);
  });
});

describe("queueReducer cut-outs", () => {
  const cutout = { blob: new Blob(["cut"]), width: 100, height: 100 };

  function queued() {
    return queueReducer(initialQueueState, { type: "add", items: [item("a"), item("b")] });
  }

  it("marks only the requested row as matting", () => {
    const state = queueReducer(queued(), { type: "matte-start", id: "a" });
    expect(state.items[0].matting).toBe(true);
    expect(state.items[1].matting).toBeFalsy();
  });

  it("stores the cut-out, clears the flag and returns the row to queued for re-encoding", () => {
    const started = queueReducer(queued(), { type: "matte-start", id: "a" });
    const state = queueReducer(started, { type: "matte-done", id: "a", cutout });

    expect(state.items[0].cutout).toBe(cutout);
    expect(state.items[0].matting).toBe(false);
    expect(state.items[0].status).toBe("queued");
  });

  it("reports a failure on the row without leaving it stuck busy", () => {
    const started = queueReducer(queued(), { type: "matte-start", id: "a" });
    const state = queueReducer(started, { type: "matte-error", id: "a", message: "out of memory" });

    expect(state.items[0].matting).toBe(false);
    expect(state.items[0].status).toBe("error");
    expect(state.items[0].error).toBe("out of memory");
  });

  // The action is reversible: restoring puts the original back and sends
  // the row to be encoded again from it.
  it("drops the cut-out and requeues the row on matte-clear", () => {
    const started = queueReducer(queued(), { type: "matte-start", id: "a" });
    const done = queueReducer(started, { type: "matte-done", id: "a", cutout });
    const state = queueReducer(done, { type: "matte-clear", id: "a" });

    expect(state.items[0].cutout).toBeUndefined();
    expect(state.items[0].status).toBe("queued");
  });

  it("leaves other rows untouched throughout", () => {
    const started = queueReducer(queued(), { type: "matte-start", id: "a" });
    const done = queueReducer(started, { type: "matte-done", id: "a", cutout });
    expect(done.items[1]).toEqual(queued().items[1]);
  });
});

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

  // The 200ms debounce used to leave a window where the settings on screen
  // had already changed but every row still read "done" and still handed out
  // the PREVIOUS run's bytes. Superseding is now the settings change itself,
  // not the sweep that follows it.
  it("supersedes settled results the instant settings change, before the sweep starts", async () => {
    vi.useFakeTimers();
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
      hook.result.current.dispatch({ type: "add", items: [item("a")] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(hook.result.current.totals.count).toBe(1);

    // No timer advance: the debounced sweep has NOT run yet.
    act(() => {
      hook.result.current.dispatch({ type: "settings", settings: { quality: 40 } });
    });

    expect(hook.result.current.totals.count).toBe(0);

    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
    act(() => {
      hook.result.current.downloadOne(hook.result.current.items[0]);
    });
    expect(createUrl).not.toHaveBeenCalled();
    createUrl.mockRestore();
    hook.unmount();
  });

  // The queue's aria-live total and the masthead both need to distinguish
  // "there is no aggregate yet" from "the aggregate is zero". `pending`
  // covers the whole superseded window: the debounce gap AND the sweep.
  it("counts rows awaiting a re-encode as pending before the sweep starts", async () => {
    vi.useFakeTimers();
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
    expect(hook.result.current.pending).toBe(0);

    act(() => {
      hook.result.current.dispatch({ type: "settings", settings: { quality: 40 } });
    });
    expect(hook.result.current.items.every((i) => i.status === "queued")).toBe(true);
    expect(hook.result.current.pending).toBe(2);
    hook.unmount();
  });

  // Icon size is a setting like any other: it changes the bytes that come
  // out, so it must trigger the debounced sweep. Leaving it out of the
  // effect's key would leave every row showing the previous size's figures.
  it("re-encodes when the icon size changes", async () => {
    vi.useFakeTimers();
    encodeMock.mockImplementation(async () => ({
      blob: new Blob(["x"]),
      size: 10,
      width: 1,
      height: 1,
      mime: "image/x-icon",
      outcome: "encoded" as const,
    }));
    const hook = renderHook(() => useQueue());
    act(() => {
      hook.result.current.dispatch({ type: "add", items: [item("a")] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(encodeMock).toHaveBeenCalledTimes(1);

    act(() => {
      hook.result.current.dispatch({ type: "settings", settings: { icon: 128 } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(encodeMock).toHaveBeenCalledTimes(2);
    // The mock is declared with no parameters, so reach the settings
    // argument through the untyped call record.
    const settingsArg = (encodeMock.mock.calls[1] as unknown[])[3];
    expect(settingsArg).toMatchObject({ icon: 128 });
    hook.unmount();
  });

  it("revokes every preview URL it drops when the queue is reset", async () => {
    const hook = await queueThenStall();
    vi.mocked(releaseUrl).mockClear();

    act(() => {
      hook.result.current.reset();
    });

    expect(hook.result.current.items).toEqual([]);
    expect(vi.mocked(releaseUrl).mock.calls.map(([url]) => url).sort()).toEqual(["blob:a", "blob:b"]);
    hook.unmount();
  });

  // The sweep stalled by queueThenStall is still in flight when the reset
  // lands. Its results must not resurrect rows the user just cleared.
  it("stays empty when an in-flight encode lands after the reset", async () => {
    const hook = await queueThenStall();
    let settle: ((r: unknown) => void) | undefined;
    encodeMock.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));

    act(() => {
      hook.result.current.reset();
    });
    await act(async () => {
      settle?.({ blob: new Blob(["x"]), size: 10, width: 1, height: 1, mime: "image/png", outcome: "encoded" });
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(hook.result.current.items).toEqual([]);
    expect(hook.result.current.totals.count).toBe(0);
    hook.unmount();
  });

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

describe("useQueue cut-outs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    cleanup();
  });

  async function settledQueue() {
    vi.useFakeTimers();
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
      hook.result.current.dispatch({ type: "add", items: [item("a")] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    return hook;
  }

  it("re-encodes the row from the cut-out, not from the original file", async () => {
    const hook = await settledQueue();
    encodeMock.mockClear();

    await act(async () => {
      hook.result.current.cutOut(hook.result.current.items[0]);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(matteMock).toHaveBeenCalledTimes(1);
    const [, encodedFrom] = encodeMock.mock.calls[0] as unknown[];
    expect(encodedFrom).toBe(hook.result.current.items[0].cutout?.blob);
  });

  it("tells the encoder the output needs an alpha channel", async () => {
    const hook = await settledQueue();
    encodeMock.mockClear();

    await act(async () => {
      hook.result.current.cutOut(hook.result.current.items[0]);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect((encodeMock.mock.calls[0] as unknown[])[4]).toBe(true);
  });

  it("puts the failure on the row when matting fails", async () => {
    const hook = await settledQueue();
    matteMock.mockRejectedValueOnce(new Error("out of memory"));

    await act(async () => {
      hook.result.current.cutOut(hook.result.current.items[0]);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(hook.result.current.items[0].status).toBe("error");
    expect(hook.result.current.items[0].error).toBe("out of memory");
  });

  it("restores the original and encodes from it again", async () => {
    const hook = await settledQueue();
    await act(async () => {
      hook.result.current.cutOut(hook.result.current.items[0]);
      await vi.advanceTimersByTimeAsync(300);
    });
    encodeMock.mockClear();

    await act(async () => {
      hook.result.current.restoreBackground(hook.result.current.items[0]);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(hook.result.current.items[0].cutout).toBeUndefined();
    const [, encodedFrom] = encodeMock.mock.calls[0] as unknown[];
    expect(encodedFrom).toBe(hook.result.current.items[0].file);
  });

  it("cancels in-flight matting when the queue is reset", async () => {
    const hook = await settledQueue();
    matteBumpGenerationMock.mockClear();

    act(() => {
      hook.result.current.cutOut(hook.result.current.items[0]);
      hook.result.current.reset();
    });

    // This is the constraint reset() is supposed to implement: a reset
    // bumps the matte generation, same as it already does for the encode
    // client, so a real MatteClient rejects any pending matte() as
    // StaleResult instead of letting it land later. The mock doesn't
    // implement generation-based rejection itself, so pin the call the
    // real client depends on directly, rather than only re-checking
    // `items === []` — the reducer already emptied `items` on "reset"
    // before this task existed, so that alone does not prove cancellation
    // happened. (Verified: removing the `matteRef.current?.bumpGeneration()`
    // line from reset() makes this assertion fail while the rest of the
    // suite still passes.)
    expect(matteBumpGenerationMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.items).toEqual([]);
  });

  it("does not resurrect a row removed while its matte was in flight", async () => {
    const hook = await settledQueue();
    let resolveMatte: ((r: { blob: Blob; width: number; height: number }) => void) | undefined;
    matteMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveMatte = resolve; }),
    );

    act(() => {
      hook.result.current.cutOut(hook.result.current.items[0]);
    });
    act(() => {
      hook.result.current.removeItem(hook.result.current.items[0]);
    });
    expect(hook.result.current.items).toEqual([]);

    encodeMock.mockClear();
    await act(async () => {
      resolveMatte?.({ blob: new Blob(["cut"]), width: 100, height: 100 });
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(hook.result.current.items).toEqual([]);
    expect(encodeMock).not.toHaveBeenCalled();
  });
});

describe("queueReducer mode", () => {
  it("starts in compress mode", () => {
    expect(initialQueueState.mode).toBe("compress");
  });

  it("switches to cut-out mode", () => {
    const state = queueReducer(initialQueueState, { type: "set-mode", mode: "cutout" });
    expect(state.mode).toBe("cutout");
  });

  it("ignores a switch to the mode already on screen", () => {
    // Same reasoning as the settings no-op: re-selecting the current mode
    // must not strip every row's figures and start a sweep nobody asked for.
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a")] });
    const done = queueReducer(added, {
      type: "result",
      id: "a",
      result: { blob: new Blob(), size: 250, width: 100, height: 100, mime: "image/png", outcome: "encoded" },
    });
    expect(queueReducer(done, { type: "set-mode", mode: "compress" })).toBe(done);
  });

  it("supersedes every settled row, because the effective settings changed", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a")] });
    const done = queueReducer(added, {
      type: "result",
      id: "a",
      result: { blob: new Blob(), size: 250, width: 100, height: 100, mime: "image/png", outcome: "encoded" },
    });
    const state = queueReducer(done, { type: "set-mode", mode: "cutout" });
    expect(state.items[0].status).toBe("queued");
  });

  it("drops every cut-out on the way back to compress", () => {
    // Leaving cut-out mode is the only restore there is now that the row's
    // scissors button is gone: if the cut-outs survived, compress mode would
    // go on shipping transparent PNGs from a mode whose whole claim is that
    // it leaves the picture alone.
    const added = queueReducer({ ...initialQueueState, mode: "cutout" }, { type: "add", items: [item("a")] });
    const cut = queueReducer(added, {
      type: "matte-done",
      id: "a",
      cutout: { blob: new Blob(), width: 100, height: 100 },
    });
    expect(cut.items[0].cutout).toBeDefined();

    const state = queueReducer(cut, { type: "set-mode", mode: "compress" });
    expect(state.items[0].cutout).toBeUndefined();
  });

  it("keeps the cut-outs it already has when entering cut-out mode", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a")] });
    const cut = queueReducer(added, {
      type: "matte-done",
      id: "a",
      cutout: { blob: new Blob(), width: 100, height: 100 },
    });
    const state = queueReducer(cut, { type: "set-mode", mode: "cutout" });
    expect(state.items[0].cutout).toBeDefined();
  });
});

describe("useQueue mode switching", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    cleanup();
  });

  function svgItem(id: string): QueueItem {
    return {
      id,
      file: new File([], `${id}.svg`, { type: "image/svg+xml" }),
      source: { name: `${id}.svg`, type: "image/svg+xml", size: 500, width: 10, height: 10 },
      previewUrl: `blob:${id}`,
      status: "queued",
    };
  }

  async function settled(items: QueueItem[]) {
    vi.useFakeTimers();
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
      hook.result.current.dispatch({ type: "add", items });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    return hook;
  }

  it("cuts out every queued row when cut-out mode is switched on", async () => {
    const hook = await settled([item("a"), item("b")]);
    matteMock.mockClear();

    await act(async () => {
      hook.result.current.setMode("cutout");
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(matteMock).toHaveBeenCalledTimes(2);
    expect(hook.result.current.items.every((i) => i.cutout !== undefined)).toBe(true);
  });

  it("cuts out a file dropped while already in cut-out mode", async () => {
    const hook = await settled([item("a")]);
    await act(async () => {
      hook.result.current.setMode("cutout");
      await vi.advanceTimersByTimeAsync(300);
    });
    matteMock.mockClear();

    await act(async () => {
      hook.result.current.dispatch({ type: "add", items: [item("b")] });
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(matteMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.items[1].cutout).toBeDefined();
  });

  it("never asks for the same row's matte twice", async () => {
    // The sweep re-renders the hook on every encode result, and inference
    // costs seconds of GPU time — a matte request that re-fires on render
    // would be invisible except as a queue that never settles.
    const hook = await settled([item("a")]);
    matteMock.mockClear();

    await act(async () => {
      hook.result.current.setMode("cutout");
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(matteMock).toHaveBeenCalledTimes(1);
  });

  it("does not try to matte a file the engine never decodes", async () => {
    const hook = await settled([svgItem("v")]);
    matteMock.mockClear();

    await act(async () => {
      hook.result.current.setMode("cutout");
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(matteMock).not.toHaveBeenCalled();
  });

  it("encodes as lossless PNG in cut-out mode, whatever the controls say", async () => {
    const hook = await settled([item("a")]);
    act(() => {
      hook.result.current.dispatch({ type: "settings", settings: { format: "image/jpeg", quality: 40, resize: 1280 } });
    });
    encodeMock.mockClear();

    await act(async () => {
      hook.result.current.setMode("cutout");
      await vi.advanceTimersByTimeAsync(300);
    });

    const settings = (encodeMock.mock.calls.at(-1) as unknown[])[3];
    expect(settings).toMatchObject({ format: "image/png", quality: 100, resize: "none" });
  });

  it("goes back to encoding the original file when cut-out mode is switched off", async () => {
    const hook = await settled([item("a")]);
    await act(async () => {
      hook.result.current.setMode("cutout");
      await vi.advanceTimersByTimeAsync(300);
    });
    encodeMock.mockClear();

    await act(async () => {
      hook.result.current.setMode("compress");
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(hook.result.current.items[0].cutout).toBeUndefined();
    const [, encodedFrom] = encodeMock.mock.calls.at(-1) as unknown[];
    expect(encodedFrom).toBe(hook.result.current.items[0].file);
  });

  it("cuts out again if cut-out mode is switched back on", async () => {
    const hook = await settled([item("a")]);
    for (const mode of ["cutout", "compress"] as const) {
      await act(async () => {
        hook.result.current.setMode(mode);
        await vi.advanceTimersByTimeAsync(300);
      });
    }
    matteMock.mockClear();

    await act(async () => {
      hook.result.current.setMode("cutout");
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(matteMock).toHaveBeenCalledTimes(1);
  });
});
