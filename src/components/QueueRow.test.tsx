import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueueRow } from "./QueueRow";
import type { QueueItem } from "@/lib/engine/types";

afterEach(cleanup);

function baseItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "a",
    file: new File([], "photo.png", { type: "image/png" }),
    source: { name: "photo.png", type: "image/png", size: 1000, width: 800, height: 600 },
    previewUrl: "blob:a",
    status: "queued",
    ...overrides,
  };
}

const noop = () => {};

describe("QueueRow", () => {
  it("shows the passthrough note and a dash instead of a percentage for a passthrough file", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({
          status: "passthrough",
          source: { name: "icon.svg", type: "image/svg+xml", size: 500, width: 32, height: 32 },
          result: { blob: new Blob(), size: 500, width: 32, height: 32, mime: "image/svg+xml", outcome: "passthrough" },
        })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
      />,
    );

    expect(screen.getByText("passthrough — no gain")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText(/kept original/)).toBeNull();
  });

  it("does not call a re-encoded-but-not-smaller file a passthrough", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({
          status: "kept",
          source: { name: "photo.png", type: "image/png", size: 1000, width: 800, height: 600 },
          result: { blob: new Blob(), size: 1000, width: 800, height: 600, mime: "image/png", outcome: "kept" },
        })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
      />,
    );

    expect(screen.getByText("kept original — re-encoding did not make this file smaller")).toBeTruthy();
    expect(screen.queryByText("passthrough — no gain")).toBeNull();
    // Unlike a passthrough, this file WAS measured, so it reports a figure
    // rather than a dash.
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.getByText("0.0%")).toBeTruthy();
  });

  it("shows a plus sign, not a mangled double minus, when the encode grew the file", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({
          status: "done",
          source: { name: "photo.png", type: "image/png", size: 1000, width: 800, height: 600 },
          result: { blob: new Blob(), size: 1042, width: 800, height: 600, mime: "image/png", outcome: "encoded" },
        })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
      />,
    );

    expect(screen.getByText("+4.2%")).toBeTruthy();
    expect(screen.queryByText(/−-/)).toBeNull();
  });

  it("shows a spinner and encoding label while a row is working, with no result yet", () => {
    render(
      <QueueRow
        index={2}
        item={baseItem({ status: "working" })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
      />,
    );

    expect(screen.getByText("encoding…")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    // Row index is 1-based and zero-padded.
    expect(screen.getByText("03")).toBeTruthy();
    // No result yet, so download must be disabled.
    expect((screen.getByLabelText("Download") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not render the Compare panel when expanded but no result exists yet", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({ status: "working" })}
        expanded={true}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
      />,
    );

    expect(screen.queryByLabelText("Comparison position")).toBeNull();
  });

  it("does not render the Compare panel when a result exists but the row is collapsed", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({
          status: "done",
          result: { blob: new Blob(), size: 900, width: 800, height: 600, mime: "image/png", outcome: "encoded" },
        })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
      />,
    );

    expect(screen.queryByLabelText("Comparison position")).toBeNull();
  });

  it("renders the Compare panel only when expanded AND a result exists", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({
          status: "done",
          result: { blob: new Blob(), size: 900, width: 800, height: 600, mime: "image/png", outcome: "encoded" },
        })}
        expanded={true}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
      />,
    );

    expect(screen.getByLabelText("Comparison position")).toBeTruthy();
  });
});
