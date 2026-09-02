import { describe, it, expect } from "vitest";
import type { EncodeResult, EncodeSettings, ItemStatus, QueueItem } from "./types";
import {
  formatLabel,
  ICON_SIZES,
  iconBundleSizes,
  isPassthrough,
  resolveOutputFormat,
  targetDimensions,
  savingsPercent,
  shouldKeepOriginal,
  outputFilename,
  formatBytes,
  currentResult,
  effectiveSettings,
} from "./plan";

describe("isPassthrough", () => {
  it("treats vector and icon formats as passthrough", () => {
    expect(isPassthrough("image/svg+xml")).toBe(true);
    expect(isPassthrough("image/x-icon")).toBe(true);
  });

  it("treats raster formats as encodable", () => {
    expect(isPassthrough("image/png")).toBe(false);
    expect(isPassthrough("image/jpeg")).toBe(false);
    expect(isPassthrough("image/webp")).toBe(false);
  });
});

describe("resolveOutputFormat", () => {
  it("keeps the source type when format is keep", () => {
    expect(resolveOutputFormat("image/png", "keep")).toBe("image/png");
  });

  it("returns the requested type when converting", () => {
    expect(resolveOutputFormat("image/png", "image/webp")).toBe("image/webp");
  });

  it("never converts a passthrough type, even when asked", () => {
    expect(resolveOutputFormat("image/svg+xml", "image/jpeg")).toBe("image/svg+xml");
    expect(resolveOutputFormat("image/x-icon", "image/webp")).toBe("image/x-icon");
  });

  it("normalises the legacy image/jpg source type to image/jpeg", () => {
    expect(resolveOutputFormat("image/jpg", "keep")).toBe("image/jpeg");
  });

  it("maps a GIF source to PNG under keep, since canvas cannot encode GIF", () => {
    expect(resolveOutputFormat("image/gif", "keep")).toBe("image/png");
  });
});

describe("resolveOutputFormat when the image needs transparency", () => {
  // JPG cannot carry an alpha channel, so a cut-out saved as JPG would
  // silently composite onto black — the one outcome worse than refusing.
  it("substitutes WebP for JPG", () => {
    expect(resolveOutputFormat("image/png", "image/jpeg", true)).toBe("image/webp");
  });

  it("substitutes WebP when 'keep' would have resolved to JPG", () => {
    expect(resolveOutputFormat("image/jpeg", "keep", true)).toBe("image/webp");
  });

  it("leaves the alpha-capable formats alone", () => {
    expect(resolveOutputFormat("image/png", "image/png", true)).toBe("image/png");
    expect(resolveOutputFormat("image/png", "image/webp", true)).toBe("image/webp");
    expect(resolveOutputFormat("image/png", "image/x-icon", true)).toBe("image/x-icon");
  });

  it("changes nothing when transparency is not needed", () => {
    expect(resolveOutputFormat("image/png", "image/jpeg", false)).toBe("image/jpeg");
  });
});

describe("targetDimensions", () => {
  it("returns the source size when resize is none", () => {
    expect(targetDimensions(3840, 2160, "none")).toEqual({ width: 3840, height: 2160 });
  });

  it("clamps the long edge and preserves aspect ratio", () => {
    expect(targetDimensions(3840, 2160, 2048)).toEqual({ width: 2048, height: 1152 });
  });

  it("clamps by height when the image is portrait", () => {
    expect(targetDimensions(2160, 3840, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it("never upscales a smaller image", () => {
    expect(targetDimensions(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });

  it("rounds to whole pixels when scaling", () => {
    expect(targetDimensions(10000, 7000, 2048)).toEqual({ width: 2048, height: 1434 });
  });

  it("never returns zero height due to rounding", () => {
    expect(targetDimensions(100000, 1, 1280)).toEqual({ width: 1280, height: 1 });
  });
});

describe("savingsPercent", () => {
  it("reports a positive percentage when the file shrinks", () => {
    expect(savingsPercent(1000, 250)).toBeCloseTo(75, 5);
  });

  it("reports a negative percentage when the file grows", () => {
    expect(savingsPercent(1000, 1042)).toBeCloseTo(-4.2, 5);
  });

  it("reports zero for an identical size", () => {
    expect(savingsPercent(1000, 1000)).toBe(0);
  });

  it("reports zero rather than dividing by zero", () => {
    expect(savingsPercent(0, 0)).toBe(0);
  });
});

describe("shouldKeepOriginal", () => {
  it("keeps the original when the encode is larger", () => {
    expect(shouldKeepOriginal(1000, 1042)).toBe(true);
  });

  it("keeps the original when the encode is identical", () => {
    expect(shouldKeepOriginal(1000, 1000)).toBe(true);
  });

  it("uses the encode when it is smaller", () => {
    expect(shouldKeepOriginal(1000, 999)).toBe(false);
  });
});

describe("outputFilename", () => {
  it("swaps the extension to match the output mime", () => {
    expect(outputFilename("hero.png", "image/webp", new Set())).toBe("hero.webp");
  });

  it("preserves a name that has no extension", () => {
    expect(outputFilename("hero", "image/jpeg", new Set())).toBe("hero.jpg");
  });

  it("preserves dots inside the base name", () => {
    expect(outputFilename("logo.v2.png", "image/png", new Set())).toBe("logo.v2.png");
  });

  it("disambiguates collisions with a numeric suffix", () => {
    const taken = new Set(["logo.png"]);
    expect(outputFilename("logo.png", "image/png", taken)).toBe("logo-2.png");
  });

  it("keeps incrementing past a second collision", () => {
    const taken = new Set(["logo.png", "logo-2.png"]);
    expect(outputFilename("logo.png", "image/png", taken)).toBe("logo-3.png");
  });

  it("handles dot-only filenames", () => {
    expect(outputFilename(".gitignore", "image/png", new Set())).toBe(".gitignore.png");
  });

  it("uses bin extension for unmapped mime types", () => {
    expect(outputFilename("file.unknown", "application/octet-stream", new Set())).toBe("file.bin");
  });
});

describe("formatBytes", () => {
  it("formats zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes below 1KB", () => {
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats at the 1KB boundary", () => {
    expect(formatBytes(1024)).toBe("1 KB");
  });

  it("formats kilobytes without decimals", () => {
    expect(formatBytes(310 * 1024)).toBe("310 KB");
  });

  it("formats at the 1MB boundary", () => {
    expect(formatBytes(1048575)).toBe("1024 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
  });
});

describe("currentResult", () => {
  const result: EncodeResult = {
    blob: new Blob(["x"]),
    size: 250,
    width: 10,
    height: 10,
    mime: "image/webp",
    outcome: "encoded",
  };

  const row = (status: ItemStatus): QueueItem => ({
    id: "a",
    file: new File([], "a.png", { type: "image/png" }),
    source: { name: "a.png", type: "image/png", size: 1000, width: 10, height: 10 },
    previewUrl: "blob:a",
    status,
    result,
  });

  it("withholds the stored result while the row is re-encoding", () => {
    // The bytes are still on the item — deliberately, for display
    // continuity — but they describe the PREVIOUS settings, so nothing may
    // treat them as current.
    expect(row("working").result).toBe(result);
    expect(currentResult(row("working"))).toBeUndefined();
  });

  it("withholds the stored result for an errored row", () => {
    expect(currentResult(row("error"))).toBeUndefined();
  });

  it("returns the result for a settled row, whatever the outcome", () => {
    expect(currentResult(row("done"))).toBe(result);
    expect(currentResult(row("passthrough"))).toBe(result);
    expect(currentResult(row("kept"))).toBe(result);
  });

  it("returns undefined for a queued row that has never run", () => {
    expect(currentResult({ ...row("queued"), result: undefined })).toBeUndefined();
  });
});

// The compare panel captions each pane with its own format, so the two are
// self-describing rather than leaning on a shared legend.
describe("formatLabel", () => {
  it("names each supported mime type in the short form the UI shows", () => {
    expect(formatLabel("image/jpeg")).toBe("JPG");
    expect(formatLabel("image/png")).toBe("PNG");
    expect(formatLabel("image/webp")).toBe("WEBP");
    expect(formatLabel("image/svg+xml")).toBe("SVG");
  });

  it("falls back to the mime subtype for anything unmapped", () => {
    expect(formatLabel("image/avif")).toBe("AVIF");
  });
});

// An .ico is a bundle: the picked size is the LARGEST image in it, and the
// standard smaller sizes ride along so Windows and browsers can choose.
describe("icon bundle sizes", () => {
  it("offers the six standard icon sizes", () => {
    expect(ICON_SIZES).toEqual([16, 32, 48, 64, 128, 256]);
  });

  it("includes every standard size up to and including the one picked", () => {
    expect(iconBundleSizes(64)).toEqual([16, 32, 48, 64]);
    expect(iconBundleSizes(256)).toEqual([16, 32, 48, 64, 128, 256]);
  });

  it("is just the one image at the smallest size", () => {
    expect(iconBundleSizes(16)).toEqual([16]);
  });
});

describe("resolveOutputFormat for ICO", () => {
  it("converts a raster source to ICO", () => {
    expect(resolveOutputFormat("image/png", "image/x-icon")).toBe("image/x-icon");
    expect(resolveOutputFormat("image/jpeg", "image/x-icon")).toBe("image/x-icon");
  });

  // Passthrough still wins: canvas cannot reliably decode an SVG, and
  // re-wrapping an .ico that is already an .ico buys nothing.
  it("leaves passthrough sources alone", () => {
    expect(resolveOutputFormat("image/svg+xml", "image/x-icon")).toBe("image/svg+xml");
    expect(resolveOutputFormat("image/x-icon", "image/x-icon")).toBe("image/x-icon");
  });
});

describe("effectiveSettings", () => {
  const chosen: EncodeSettings = { quality: 42, resize: 1280, format: "image/jpeg", icon: 32 };

  it("hands back the user's own settings in compress mode", () => {
    expect(effectiveSettings(chosen, "compress")).toEqual(chosen);
  });

  it("overrides quality, resize and format in cut-out mode", () => {
    // Cut-out mode's job is the alpha channel, not the byte count: a lossy
    // re-encode at 42% would put JPEG artefacts along the very edge the
    // matte exists to make clean, and a resize would throw away detail the
    // user never asked to lose.
    expect(effectiveSettings(chosen, "cutout")).toEqual({
      quality: 100,
      resize: "none",
      format: "image/png",
      icon: 32,
    });
  });

  it("does not mutate the settings it was given", () => {
    const before = { ...chosen };
    effectiveSettings(chosen, "cutout");
    expect(chosen).toEqual(before);
  });
});
