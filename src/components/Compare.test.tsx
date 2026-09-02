import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Compare } from "./Compare";
import { releaseAll } from "@/lib/engine/client";
import type { QueueItem, EncodeResult } from "@/lib/engine/types";

afterEach(cleanup);

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "a",
    file: new File([], "photo.png", { type: "image/png" }),
    source: { name: "photo.png", type: "image/png", size: 1000, width: 800, height: 600 },
    previewUrl: "blob:preview-a",
    status: "done",
    ...overrides,
  };
}

function result(overrides: Partial<EncodeResult> = {}): EncodeResult {
  return {
    blob: new Blob(["x"], { type: "image/jpeg" }),
    size: 500,
    width: 800,
    height: 600,
    mime: "image/jpeg",
    outcome: "encoded",
    ...overrides,
  };
}

describe("Compare", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    releaseAll();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:output-a");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  it("creates the output blob URL exactly once and revokes it on unmount", () => {
    const { unmount } = render(<Compare item={item()} result={result()} />);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:output-a");
  });

  it("does not re-create the output URL on a re-render with the same blob", () => {
    const same = result();
    const { rerender } = render(<Compare item={item()} result={same} />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    rerender(<Compare item={item()} result={same} />);
    rerender(<Compare item={item()} result={same} />);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("revokes the old URL and mints a new one when the result blob changes", () => {
    vi.mocked(URL.createObjectURL)
      .mockImplementationOnce(() => "blob:output-a")
      .mockImplementationOnce(() => "blob:output-b");

    const { rerender } = render(<Compare item={item()} result={result()} />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    rerender(<Compare item={item()} result={result({ blob: new Blob(["y"]) })} />);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:output-a");
  });

  it("renders meaningful alt text naming the file for both images", () => {
    render(
      <Compare
        item={item({ source: { name: "vacation.png", type: "image/png", size: 1000, width: 800, height: 600 } })}
        result={result()}
      />,
    );

    expect(screen.getByAltText("Original vacation.png")).toBeTruthy();
    expect(screen.getByAltText("Compressed vacation.png")).toBeTruthy();
  });

  // The panel used to overlay the two images and reveal one with a draggable
  // divider. Both are now laid out side by side, in one row, at every width:
  // nothing is stacked on top of anything and there is nothing to drag.
  it("lays the two images out in one two-column row, not one on top of the other", () => {
    render(<Compare item={item()} result={result()} />);

    const compressed = screen.getByAltText("Compressed photo.png");
    const original = screen.getByAltText("Original photo.png");

    const row = compressed.closest("[data-compare-row]");
    expect(row).toBeTruthy();
    expect(row).toBe(original.closest("[data-compare-row]"));
    expect(row?.className).toContain("grid-cols-2");
    expect(compressed.closest("figure")).not.toBe(original.closest("figure"));
  });

  it("puts the compressed pane first, so the result reads before the source", () => {
    render(<Compare item={item()} result={result()} />);

    const figures = document.querySelectorAll("figure");
    expect(figures[0].querySelector("img")?.getAttribute("alt")).toBe("Compressed photo.png");
    expect(figures[1].querySelector("img")?.getAttribute("alt")).toBe("Original photo.png");
  });

  it("captions each pane with its own size and format", () => {
    render(<Compare item={item()} result={result({ size: 500, mime: "image/jpeg" })} />);

    // The captions are typed in sentence case and uppercased by the .label
    // rule, so match the DOM text, not the rendered casing.
    const caption = (alt: string) =>
      screen.getByAltText(alt).closest("figure")?.querySelector("figcaption")?.textContent ?? "";

    expect(caption("Compressed photo.png")).toContain("Compressed");
    expect(caption("Compressed photo.png")).toContain("500 B");
    expect(caption("Compressed photo.png")).toContain("JPG");
    expect(caption("Original photo.png")).toContain("Original");
    expect(caption("Original photo.png")).toContain("1000 B");
    expect(caption("Original photo.png")).toContain("PNG");
  });

  it("no longer renders a divider control", () => {
    const { container } = render(<Compare item={item()} result={result()} />);

    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(screen.queryByLabelText("Divider")).toBeNull();
  });

  // A cut-out on a white pane is indistinguishable from a white background.
  it("puts a checkerboard behind the compressed pane so transparency reads as transparency", () => {
    render(<Compare item={item()} result={result()} />);

    const pane = screen.getByAltText("Compressed photo.png").parentElement;
    expect(pane?.getAttribute("data-checkerboard")).toBe("true");
  });
});
