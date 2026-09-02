import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Controls } from "./Controls";
import type { EncodeSettings } from "@/lib/engine/types";

afterEach(cleanup);

function baseSettings(overrides: Partial<EncodeSettings> = {}): EncodeSettings {
  return { quality: 85, resize: "none", format: "keep", icon: 64, ...overrides };
}

describe("Controls", () => {
  it("calls onChange with a resize patch when a resize option is clicked", () => {
    const onChange = vi.fn();
    render(
      <Controls settings={baseSettings()} mode="compress" onChange={onChange} onDownloadAll={() => {}} onReset={() => {}} disabled={false} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "2048" }));
    expect(onChange).toHaveBeenCalledWith({ resize: 2048 });
  });

  it("calls onChange with a format patch when a format option is clicked", () => {
    const onChange = vi.fn();
    render(
      <Controls settings={baseSettings()} mode="compress" onChange={onChange} onDownloadAll={() => {}} onReset={() => {}} disabled={false} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "PNG" }));
    expect(onChange).toHaveBeenCalledWith({ format: "image/png" });
  });

  it("marks the current resize and format selections as checked", () => {
    render(
      <Controls
        settings={baseSettings({ resize: 1280, format: "image/webp" })}
        mode="compress"
        onChange={() => {}}
        onDownloadAll={() => {}}
        onReset={() => {}}
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
        mode="compress"
        onChange={() => {}}
        onDownloadAll={() => {}}
        onReset={() => {}}
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
      <Controls settings={baseSettings({ resize: "none" })} mode="compress" onChange={onChange} onDownloadAll={() => {}} onReset={() => {}} disabled={false} />,
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
      <Controls settings={baseSettings({ format: "keep" })} mode="compress" onChange={onChange} onDownloadAll={() => {}} onReset={() => {}} disabled={false} />,
    );

    const keep = screen.getByRole("radio", { name: "Keep" });
    keep.focus();
    fireEvent.keyDown(keep, { key: "ArrowLeft" });

    // ICO is last in the group now, so wrapping backwards from Keep lands there.
    expect(onChange).toHaveBeenCalledWith({ format: "image/x-icon" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "ICO" }));
  });

  it("jumps to the first and last option on Home and End", () => {
    const onChange = vi.fn();
    render(
      <Controls settings={baseSettings({ resize: 2048 })} mode="compress" onChange={onChange} onDownloadAll={() => {}} onReset={() => {}} disabled={false} />,
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
      <Controls settings={baseSettings({ resize: "none" })} mode="compress" onChange={onChange} onDownloadAll={() => {}} onReset={() => {}} disabled={false} />,
    );

    fireEvent.keyDown(screen.getByRole("radio", { name: "None" }), { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange with a quality patch when the slider value changes via keyboard", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Controls settings={baseSettings({ quality: 50 })} mode="compress" onChange={onChange} onDownloadAll={() => {}} onReset={() => {}} disabled={false} />,
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
      <Controls settings={baseSettings({ quality: 72 })} mode="compress" onChange={() => {}} onDownloadAll={() => {}} onReset={() => {}} disabled={false} />,
    );
    const value = screen.getByText("72");
    expect(value.className.split(" ")).toContain("data");
  });

  it("disables the download-all button when the queue is empty", () => {
    render(
      <Controls settings={baseSettings()} mode="compress" onChange={() => {}} onDownloadAll={() => {}} onReset={() => {}} disabled={true} />,
    );
    const button = screen.getByRole("button", { name: /Zip/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("enables and triggers the download-all button when the queue has files", () => {
    const onDownloadAll = vi.fn();
    render(
      <Controls settings={baseSettings()} mode="compress" onChange={() => {}} onDownloadAll={onDownloadAll} onReset={() => {}} disabled={false} />,
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
        mode="compress"
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

// ICO is not a lossy raster format: it carries lossless PNGs at fixed square
// sizes, so what makes an icon small is the size, not the quality. The panel
// has to say that — an enabled Quality slider that changes nothing would be
// a lie the user can drag.
describe("Controls with ICO selected", () => {
  function renderControls(settings = baseSettings({ format: "image/x-icon" }), onChange = vi.fn()) {
    render(
      <Controls
        settings={settings}
        mode="compress"
        onChange={onChange}
        onDownloadAll={() => {}}
        onReset={() => {}}
        disabled={false}
      />,
    );
    return onChange;
  }

  it("offers ICO as a format", () => {
    const onChange = renderControls(baseSettings());
    fireEvent.click(screen.getByRole("radio", { name: "ICO" }));
    expect(onChange).toHaveBeenCalledWith({ format: "image/x-icon" });
  });

  it("reveals the icon sizes only when ICO is the format", () => {
    renderControls(baseSettings({ format: "image/webp" }));
    expect(screen.queryByRole("radio", { name: "64" })).toBeNull();

    cleanup();
    renderControls();
    expect(screen.getByRole("radio", { name: "64" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "16" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "256" })).toBeTruthy();
  });

  it("marks the current icon size and reports a change", () => {
    const onChange = renderControls(baseSettings({ format: "image/x-icon", icon: 128 }));

    expect(screen.getByRole("radio", { name: "128" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "32" }));
    expect(onChange).toHaveBeenCalledWith({ icon: 32 });
  });

  it("disables the quality slider, which an .ico does not use", () => {
    const { container } = render(
      <Controls
        settings={baseSettings({ format: "image/x-icon" })}
        mode="compress"
        onChange={() => {}}
        onDownloadAll={() => {}}
        onReset={() => {}}
        disabled={false}
      />,
    );

    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.disabled).toBe(true);
  });

  it("disables the resize presets, since an icon's size comes from the bundle", () => {
    renderControls();

    for (const label of ["None", "2048", "1280"]) {
      expect((screen.getByRole("radio", { name: label }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("leaves quality and resize live for every other format", () => {
    const { container } = render(
      <Controls
        settings={baseSettings({ format: "image/jpeg" })}
        mode="compress"
        onChange={() => {}}
        onDownloadAll={() => {}}
        onReset={() => {}}
        disabled={false}
      />,
    );

    expect((container.querySelector('input[type="range"]') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("radio", { name: "None" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Controls in cut-out mode", () => {
  function renderCutout() {
    return render(
      <Controls
        settings={baseSettings()}
        mode="cutout"
        onChange={() => {}}
        onDownloadAll={() => {}}
        onReset={() => {}}
        disabled={false}
      />,
    );
  }

  // Cut-out mode ignores all three (see effectiveSettings): leaving them on
  // screen would let the user move a control that provably does nothing to
  // the file they get back.
  it("takes the quality slider away", () => {
    // Queried by tag, not role: Base UI keeps the range input hidden in
    // jsdom, so getByRole("slider") finds nothing either way — see the
    // "adjusts quality" test above.
    const { container } = renderCutout();
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });

  it("takes the resize and format groups away", () => {
    renderCutout();
    expect(screen.queryByRole("radiogroup", { name: "Resize" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Format" })).toBeNull();
  });

  it("keeps the download and reset actions, which still apply", () => {
    renderCutout();
    expect(screen.getByRole("button", { name: /Zip/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });

  it("still shows the settings in compress mode", () => {
    render(
      <Controls
        settings={baseSettings()}
        mode="compress"
        onChange={() => {}}
        onDownloadAll={() => {}}
        onReset={() => {}}
        disabled={false}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Format" })).toBeTruthy();
  });
});
