import { describe, it, expect } from "vitest";
import {
  isPassthrough,
  resolveOutputFormat,
  targetDimensions,
  savingsPercent,
  shouldKeepOriginal,
  outputFilename,
  formatBytes,
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
  });

  it("normalises the legacy image/jpg source type to image/jpeg", () => {
    expect(resolveOutputFormat("image/jpg", "keep")).toBe("image/jpeg");
  });

  it("maps a GIF source to PNG under keep, since canvas cannot encode GIF", () => {
    expect(resolveOutputFormat("image/gif", "keep")).toBe("image/png");
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

  it("rounds to whole pixels and never returns zero", () => {
    expect(targetDimensions(1000, 3, 1280)).toEqual({ width: 1000, height: 3 });
    const r = targetDimensions(4000, 5, 1280);
    expect(Number.isInteger(r.width)).toBe(true);
    expect(r.height).toBeGreaterThanOrEqual(1);
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
});

describe("formatBytes", () => {
  it("formats zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats kilobytes without decimals", () => {
    expect(formatBytes(310 * 1024)).toBe("310 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
  });
});
