import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { Queue } from "./Queue";
import type { OutputFormat, QueueItem } from "@/lib/engine/types";

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
        onCutOut={() => {}}
        onRestore={() => {}}
        format="image/webp"
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
        onCutOut={() => {}}
        onRestore={() => {}}
        format="image/webp"
      />,
    );

    expect(screen.getByText(/−75\.0%/)).toBeTruthy();
  });
});

// The row's "output as WEBP" footnote is not a fact about the SETTING, it
// is a fact about what resolveOutputFormat did to THIS row. Deriving it
// from `format === "image/jpeg"` missed the KEEP-on-a-.jpg case entirely —
// the resolver substitutes WebP there too — and, being a fact about the
// whole queue, could not distinguish rows in a mixed one.
describe("Queue cut-out format footnote", () => {
  function cutRow(id: string, type: string): QueueItem {
    return {
      id,
      file: new File([], `${id}`, { type }),
      source: { name: id, type, size: 1000, width: 10, height: 10 },
      previewUrl: `blob:${id}`,
      status: "done",
      cutout: { blob: new Blob([]), width: 10, height: 10 },
    };
  }

  function renderWith(items: QueueItem[], format: OutputFormat) {
    render(
      <Queue
        items={items}
        pending={0}
        totals={zeroTotals}
        onDownloadOne={() => {}}
        onRemove={() => {}}
        onCutOut={() => {}}
        onRestore={() => {}}
        format={format}
      />,
    );
  }

  it("says so when FORMAT is KEEP and the source is a JPEG", () => {
    renderWith([cutRow("beach.jpg", "image/jpeg")], "keep");
    expect(screen.getByText(/output as WEBP/i)).toBeTruthy();
  });

  it("says so when JPG was asked for explicitly", () => {
    renderWith([cutRow("beach.jpg", "image/jpeg")], "image/jpeg");
    expect(screen.getByText(/output as WEBP/i)).toBeTruthy();
  });

  it("stays quiet on a row whose format was never substituted", () => {
    renderWith([cutRow("logo.png", "image/png")], "keep");
    expect(screen.queryByText(/output as WEBP/i)).toBeNull();
  });

  it("marks only the rows the resolver actually moved, in a mixed queue", () => {
    // One setting, two answers: under KEEP the .jpg is pushed to WebP and
    // the .png is not. A queue-wide boolean can only be wrong about one of
    // them.
    renderWith([cutRow("beach.jpg", "image/jpeg"), cutRow("logo.png", "image/png")], "keep");
    expect(screen.getAllByText(/output as WEBP/i)).toHaveLength(1);
  });
});
