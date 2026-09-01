import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { QueueItem } from "@/lib/engine/types";

const isModelPresent = vi.fn(async () => true);
const cutOut = vi.fn();
const dispatch = vi.fn();

vi.mock("@/lib/engine/matte/assets", () => ({
  pickDevice: () => "webgpu",
  isModelPresent: (...args: unknown[]) => isModelPresent(...(args as [])),
}));

const item: QueueItem = {
  id: "a",
  file: new File([], "photo.png", { type: "image/png" }),
  source: { name: "photo.png", type: "image/png", size: 1000, width: 10, height: 10 },
  previewUrl: "blob:a",
  status: "done",
};

vi.mock("@/hooks/useQueue", () => ({
  useQueue: () => ({
    items: [item],
    settings: { quality: 85, resize: "none", format: "image/webp", icon: 64 },
    totals: { count: 1, input: 1000, output: 500, percent: 50 },
    notices: [],
    pending: 0,
    dispatch,
    downloadOne: () => {},
    downloadAll: () => {},
    removeItem: () => {},
    reset: () => {},
    cutOut,
    restoreBackground: () => {},
  }),
}));

const { default: Index } = await import("./Index");

beforeEach(() => {
  isModelPresent.mockReset();
  cutOut.mockReset();
  dispatch.mockReset();
});

afterEach(cleanup);

function pressCutOut() {
  fireEvent.click(screen.getByLabelText(/Cut out background/i));
}

function noticeMessages(): string[] {
  return dispatch.mock.calls
    .map(([action]) => action)
    .filter((a) => a?.type === "notice")
    .map((a) => a.message as string);
}

describe("Index cut-out gate", () => {
  // The bug this pins: the "already warned" flag was set BEFORE the
  // presence check, so on a deployment without weights the second press
  // skipped the check entirely and handed the row to a worker that cannot
  // load — surfacing a raw protobuf error in place of the actionable
  // notice the first press had given.
  it("keeps saying the model is missing, press after press", async () => {
    isModelPresent.mockResolvedValue(false);
    render(<Index />);

    pressCutOut();
    await waitFor(() => expect(noticeMessages()).toHaveLength(1));
    pressCutOut();
    await waitFor(() => expect(noticeMessages()).toHaveLength(2));

    expect(noticeMessages().every((m) => /was not deployed/.test(m))).toBe(true);
    expect(cutOut).not.toHaveBeenCalled();
  });

  // The mirror image of the same flag: a model that appears mid-session
  // (a redeploy while the tab is open) must still get its "about 85 MB"
  // notice, not be silently downloaded because press one already burned
  // the one warning the app allowed itself.
  it("announces the download when the model turns up later", async () => {
    isModelPresent.mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<Index />);

    pressCutOut();
    await waitFor(() => expect(noticeMessages()).toHaveLength(1));
    pressCutOut();
    await waitFor(() => expect(cutOut).toHaveBeenCalledTimes(1));

    expect(noticeMessages()[1]).toMatch(/about 85 MB/);
  });

  it("announces the download once, not on every press", async () => {
    isModelPresent.mockResolvedValue(true);
    render(<Index />);

    pressCutOut();
    await waitFor(() => expect(cutOut).toHaveBeenCalledTimes(1));
    pressCutOut();
    await waitFor(() => expect(cutOut).toHaveBeenCalledTimes(2));

    expect(noticeMessages()).toHaveLength(1);
    expect(isModelPresent).toHaveBeenCalledTimes(1);
  });
});
