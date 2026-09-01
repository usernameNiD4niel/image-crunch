import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Controls } from "./Controls";
import type { EncodeSettings } from "@/lib/engine/types";

afterEach(cleanup);

function baseSettings(overrides: Partial<EncodeSettings> = {}): EncodeSettings {
  return { quality: 85, resize: "none", format: "keep", ...overrides };
}

describe("Controls", () => {
  it("calls onChange with a resize patch when a resize option is clicked", () => {
    const onChange = vi.fn();
    render(
      <Controls settings={baseSettings()} onChange={onChange} onDownloadAll={() => {}} disabled={false} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "2048" }));
    expect(onChange).toHaveBeenCalledWith({ resize: 2048 });
  });

  it("calls onChange with a format patch when a format option is clicked", () => {
    const onChange = vi.fn();
    render(
      <Controls settings={baseSettings()} onChange={onChange} onDownloadAll={() => {}} disabled={false} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "PNG" }));
    expect(onChange).toHaveBeenCalledWith({ format: "image/png" });
  });

  it("marks the current resize and format selections as checked", () => {
    render(
      <Controls
        settings={baseSettings({ resize: 1280, format: "image/webp" })}
        onChange={() => {}}
        onDownloadAll={() => {}}
        disabled={false}
      />,
    );

    expect(screen.getByRole("radio", { name: "1280" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "WebP" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "None" }).getAttribute("aria-checked")).toBe("false");
  });

  // A radiogroup is ONE tab stop: Tab reaches the checked option and the
  // arrow keys move within the group. Seven separate tab stops across Resize
  // and Format is the wrong shape for the role we claim.
  it("puts only the checked option of each group in the tab order", () => {
    render(
      <Controls
        settings={baseSettings({ resize: 2048, format: "image/png" })}
        onChange={() => {}}
        onDownloadAll={() => {}}
        disabled={false}
      />,
    );

    expect(screen.getByRole("radio", { name: "2048" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: "None" }).getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("radio", { name: "PNG" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: "Keep" }).getAttribute("tabindex")).toBe("-1");
  });

  it("selects and focuses the next option on ArrowRight", () => {
    const onChange = vi.fn();
    render(
      <Controls settings={baseSettings({ resize: "none" })} onChange={onChange} onDownloadAll={() => {}} disabled={false} />,
    );

    const none = screen.getByRole("radio", { name: "None" });
    none.focus();
    fireEvent.keyDown(none, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith({ resize: 2048 });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "2048" }));
  });

  it("wraps from the first option to the last on ArrowLeft", () => {
    const onChange = vi.fn();
    render(
      <Controls settings={baseSettings({ format: "keep" })} onChange={onChange} onDownloadAll={() => {}} disabled={false} />,
    );

    const keep = screen.getByRole("radio", { name: "Keep" });
    keep.focus();
    fireEvent.keyDown(keep, { key: "ArrowLeft" });

    expect(onChange).toHaveBeenCalledWith({ format: "image/webp" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "WebP" }));
  });

  it("jumps to the first and last option on Home and End", () => {
    const onChange = vi.fn();
    render(
      <Controls settings={baseSettings({ resize: 2048 })} onChange={onChange} onDownloadAll={() => {}} disabled={false} />,
    );

    const selected = screen.getByRole("radio", { name: "2048" });
    selected.focus();
    fireEvent.keyDown(selected, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith({ resize: 1280 });

    fireEvent.keyDown(selected, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith({ resize: "none" });
  });

  it("leaves keys it does not own to the browser", () => {
    const onChange = vi.fn();
    render(
      <Controls settings={baseSettings({ resize: "none" })} onChange={onChange} onDownloadAll={() => {}} disabled={false} />,
    );

    fireEvent.keyDown(screen.getByRole("radio", { name: "None" }), { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange with a quality patch when the slider value changes via keyboard", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Controls settings={baseSettings({ quality: 50 })} onChange={onChange} onDownloadAll={() => {}} disabled={false} />,
    );

    // Base UI's Slider.Thumb keeps its nested <input type="range"> hidden
    // (visibility: hidden, inherited from an ancestor) until it can measure
    // real layout, which jsdom never provides — so it's invisible to
    // getByRole here even though it's perfectly usable in a real browser.
    // Query by tag/attribute instead of role.
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).toBeTruthy();
    expect(slider.getAttribute("aria-label")).toBe("Quality");
    fireEvent.focus(slider);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ quality: 55 });
  });

  it("shows the current quality value in the .data style", () => {
    render(
      <Controls settings={baseSettings({ quality: 72 })} onChange={() => {}} onDownloadAll={() => {}} disabled={false} />,
    );
    const value = screen.getByText("72");
    expect(value.className.split(" ")).toContain("data");
  });

  it("disables the download-all button when the queue is empty", () => {
    render(
      <Controls settings={baseSettings()} onChange={() => {}} onDownloadAll={() => {}} disabled={true} />,
    );
    const button = screen.getByRole("button", { name: /Zip/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("enables and triggers the download-all button when the queue has files", () => {
    const onDownloadAll = vi.fn();
    render(
      <Controls settings={baseSettings()} onChange={() => {}} onDownloadAll={onDownloadAll} disabled={false} />,
    );
    const button = screen.getByRole("button", { name: /Zip/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onDownloadAll).toHaveBeenCalledTimes(1);
  });
});

// Clearing a 30-file queue is not undoable, so the button arms before it
// fires: one click to ask, a second to mean it. No modal — the confirmation
// is the button itself.
describe("Controls reset", () => {
  function renderControls(onReset = vi.fn()) {
    render(
      <Controls
        settings={baseSettings()}
        onChange={() => {}}
        onDownloadAll={() => {}}
        onReset={onReset}
        disabled={false}
      />,
    );
    return onReset;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not clear the queue on the first click", () => {
    const onReset = renderControls();
    fireEvent.click(screen.getByRole("button", { name: /^Reset/ }));
    expect(onReset).not.toHaveBeenCalled();
  });

  it("asks for confirmation on the armed button itself", () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /^Reset/ }));
    expect(screen.getByRole("button", { name: /Sure/i })).toBeTruthy();
  });

  it("clears the queue on the second click", () => {
    const onReset = renderControls();
    const button = screen.getByRole("button", { name: /^Reset/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("disarms when the button loses focus", () => {
    const onReset = renderControls();
    const button = screen.getByRole("button", { name: /^Reset/ });
    fireEvent.click(button);
    fireEvent.blur(button);

    expect(screen.getByRole("button", { name: /^Reset/ })).toBeTruthy();
    fireEvent.click(button);
    expect(onReset).not.toHaveBeenCalled();
  });

  it("disarms itself after a few seconds rather than staying hot", () => {
    vi.useFakeTimers();
    const onReset = renderControls();
    const button = screen.getByRole("button", { name: /^Reset/ });
    fireEvent.click(button);

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.getByRole("button", { name: /^Reset/ })).toBeTruthy();
    fireEvent.click(button);
    expect(onReset).not.toHaveBeenCalled();
  });
});
