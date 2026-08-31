import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

  it("does not re-create the output URL on unrelated re-renders (e.g. dragging the divider)", () => {
    render(<Compare item={item()} result={result()} />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    const divider = screen.getByLabelText("Divider");
    fireEvent.change(divider, { target: { value: "30" } });
    fireEvent.change(divider, { target: { value: "70" } });

    // The blob didn't change, so no new object URL should have been minted.
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

  // jsdom cannot exercise real arrow-key handling on a range input, so this
  // asserts the divider IS a native range input with a name and bounds — the
  // thing that makes it keyboard-operable in a browser — rather than claiming
  // to have driven it from the keyboard.
  it("renders the divider as a native range input with an accessible name and 0-100 bounds", () => {
    render(<Compare item={item()} result={result()} />);

    const divider = screen.getByLabelText("Divider") as HTMLInputElement;
    expect(divider.type).toBe("range");
    expect(divider.min).toBe("0");
    expect(divider.max).toBe("100");
    expect(divider.value).toBe("50");

    fireEvent.change(divider, { target: { value: "25" } });
    expect(divider.value).toBe("25");
  });

  it("renders meaningful alt text naming the file for both images", () => {
    render(<Compare item={item({ source: { name: "vacation.png", type: "image/png", size: 1000, width: 800, height: 600 } })} result={result()} />);

    expect(screen.getByAltText("Original vacation.png")).toBeTruthy();
    expect(screen.getByAltText("Compressed vacation.png")).toBeTruthy();
  });

  it("does not render the compressed image layer at split=0, avoiding a divide-by-zero width", () => {
    render(<Compare item={item()} result={result()} />);

    const divider = screen.getByLabelText("Divider");
    fireEvent.change(divider, { target: { value: "0" } });

    expect(screen.queryByAltText(/Compressed/)).toBeNull();
  });
});
