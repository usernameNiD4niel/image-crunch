import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
