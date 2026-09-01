import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { Queue } from "./Queue";
import type { QueueItem } from "@/lib/engine/types";

afterEach(cleanup);

function item(id: string, status: QueueItem["status"]): QueueItem {
  return {
    id,
    file: new File([], `${id}.png`, { type: "image/png" }),
    source: { name: `${id}.png`, type: "image/png", size: 1000, width: 10, height: 10 },
    previewUrl: `blob:${id}`,
    status,
  };
}

const zeroTotals = { count: 0, input: 0, output: 0, percent: 0 };

describe("Queue total", () => {
  // The gap between a settings change and the 200ms-debounced sweep is not
  // "nothing is happening": every row is superseded and waiting. Reading out
  // "0 B → 0 B 0.0%" there would state an aggregate that is not merely stale
  // but false.
  it("states that a re-encode is underway instead of a zero aggregate", () => {
    render(
      <Queue
        items={[item("a", "queued"), item("b", "queued")]}
        pending={2}
        totals={zeroTotals}
        onDownloadOne={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText(/re-encoding 2 file/i)).toBeTruthy();
    expect(screen.queryByText(/0\.0%/)).toBeNull();
  });

  it("states the aggregate once nothing is pending", () => {
    render(
      <Queue
        items={[item("a", "done")]}
        pending={0}
        totals={{ count: 1, input: 1000, output: 250, percent: 75 }}
        onDownloadOne={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText(/−75\.0%/)).toBeTruthy();
  });
});
