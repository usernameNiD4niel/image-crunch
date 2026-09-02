import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
        mode="compress"
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
        mode="compress"
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
        mode="compress"
      />,
    );

    expect(screen.getByText("+4.2%")).toBeTruthy();
    expect(screen.queryByText(/−-/)).toBeNull();
  });

  it("names the file in every glyph-only row action", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({ status: "queued" })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        mode="compress"
      />,
    );

    // "⌄ ↓ ×" carry no text; with 30 rows a screen reader would otherwise
    // hear the same three names thirty times over.
    expect(screen.getByLabelText("Compare photo.png")).toBeTruthy();
    expect(screen.getByLabelText("Download photo.png")).toBeTruthy();
    expect(screen.getByLabelText("Remove photo.png")).toBeTruthy();
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
        mode="compress"
      />,
    );

    expect(screen.getByText("encoding…")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    // Row index is 1-based and zero-padded.
    expect(screen.getByText("03")).toBeTruthy();
    // No result yet, so download must be disabled.
    expect((screen.getByLabelText("Download photo.png") as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the previous run's figures and download while the row is re-encoding", () => {
    // The row still HOLDS last run's result (it is kept for the compare
    // panel's continuity), but every current-facing consumer must ignore it:
    // otherwise a re-encoding row reads "⟳ encoding… 1000 B → 400 B  60.0%"
    // with numbers from the settings the user just changed away from, and
    // its ↓ hands out those old bytes.
    render(
      <QueueRow
        index={0}
        item={baseItem({
          status: "working",
          result: { blob: new Blob(), size: 400, width: 800, height: 600, mime: "image/webp", outcome: "encoded" },
        })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        mode="compress"
      />,
    );

    expect(screen.getByText("encoding…")).toBeTruthy();
    expect(screen.queryByText(/400 B/)).toBeNull();
    expect(screen.queryByText(/60\.0%/)).toBeNull();
    expect((screen.getByLabelText("Download photo.png") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers no download and no figures for an errored row", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({ status: "error", error: "Encoding failed" })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        mode="compress"
      />,
    );

    expect(screen.getByText("Encoding failed")).toBeTruthy();
    expect((screen.getByLabelText("Download photo.png") as HTMLButtonElement).disabled).toBe(true);
  });

  it("aligns the passthrough note with the filename column, not the row index", () => {
    const { container } = render(
      <QueueRow
        index={0}
        item={baseItem({
          status: "passthrough",
          source: { name: "icon.svg", type: "image/svg+xml", size: 500, width: 32, height: 32 },
        })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        mode="compress"
      />,
    );
    void container;
    const note = screen.getByText("passthrough — no gain");
    const classes = note.className.split(" ");
    expect(classes).toContain("col-start-2");
    expect(classes).not.toContain("col-span-12");
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
        mode="compress"
      />,
    );

    expect(screen.queryByLabelText("Divider")).toBeNull();
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
        mode="compress"
      />,
    );

    expect(screen.queryByLabelText("Divider")).toBeNull();
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
        mode="compress"
      />,
    );

    // The panel's own contract is Compare.test.tsx's; all this row owes is
    // that both panes are there when expanded with a result to show.
    expect(screen.getByAltText(/^Compressed /)).toBeTruthy();
    expect(screen.getByAltText(/^Original /)).toBeTruthy();
  });
});

describe("QueueRow background removal", () => {
  it("carries no per-row cut-out control — the mode switch decides", () => {
    // Background removal is a mode, not a row action: a row-level scissors
    // would let the queue hold a mixture of cut-out and untouched files under
    // one heading that claims to describe all of them.
    render(
      <QueueRow
        index={0}
        item={baseItem({ status: "done" })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        mode="compress"
      />,
    );

    expect(screen.queryByRole("button", { name: /background from photo\.png/ })).toBeNull();
  });

  it("says what it is doing while the model runs", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({ status: "working", matting: true })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        mode="compress"
      />,
    );

    expect(screen.getByText(/removing background/i)).toBeTruthy();
  });

  it("says so once the row is cut out", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({ status: "done", cutout: { blob: new Blob(), width: 10, height: 10 } })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        mode="compress"
      />,
    );

    expect(screen.getByText(/^cut out/i)).toBeTruthy();
  });

  // JPG cannot hold transparency, so the row must say where its output
  // actually went rather than quietly disagreeing with the FORMAT control.
  it("states the format substitution when the output had to change", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({
          status: "done",
          cutout: { blob: new Blob(), width: 10, height: 10 },
          result: { blob: new Blob(), size: 90, width: 10, height: 10, mime: "image/webp", outcome: "encoded" },
        })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        mode="compress"
        formatSubstituted
      />,
    );

    expect(screen.getByText(/JPG has no transparency/i)).toBeTruthy();
  });

  it("says a passthrough file cannot be cut out, while in cut-out mode", () => {
    // An SVG is never decoded, so the matte has nothing to run on. In cut-out
    // mode the row must say that outright: silence would read as a row the
    // mode simply forgot.
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
        mode="cutout"
      />,
    );

    expect(screen.getByText(/cannot be cut out/i)).toBeTruthy();
  });

  it("says nothing of the sort about a passthrough file while compressing", () => {
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
        mode="compress"
      />,
    );

    expect(screen.queryByText(/cannot be cut out/i)).toBeNull();
    expect(screen.getByText(/no gain/i)).toBeTruthy();
  });

});
