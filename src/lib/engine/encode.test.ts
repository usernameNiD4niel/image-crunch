import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encodeOne } from "./encode";
import type { EncodeSettings, SourceInfo } from "./types";

// How many bytes the fake encoder "produces". Set per test so the
// keep-the-original branch can be driven either way.
let encodedBytes = 10;

class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}

  getContext() {
    return {
      fillStyle: "",
      imageSmoothingQuality: "",
      fillRect: () => {},
      drawImage: () => {},
    };
  }

  async convertToBlob({ type }: { type: string }) {
    return new Blob([new Uint8Array(encodedBytes)], { type });
  }
}

const saved: Record<string, unknown> = {};

beforeEach(() => {
  saved.OffscreenCanvas = (globalThis as Record<string, unknown>).OffscreenCanvas;
  saved.createImageBitmap = (globalThis as Record<string, unknown>).createImageBitmap;
  (globalThis as Record<string, unknown>).OffscreenCanvas = FakeCanvas;
  (globalThis as Record<string, unknown>).createImageBitmap = async () => ({
    width: 100,
    height: 80,
    close: () => {},
  });
});

afterEach(() => {
  (globalThis as Record<string, unknown>).OffscreenCanvas = saved.OffscreenCanvas;
  (globalThis as Record<string, unknown>).createImageBitmap = saved.createImageBitmap;
});

const settings: EncodeSettings = {
  quality: 85,
  resize: "none",
  format: "image/webp",
  icon: 64,
};

function source(type: string): SourceInfo {
  return { name: `photo.${type.split("/")[1]}`, type, size: 4000, width: 100, height: 80 };
}

describe("encodeOne", () => {
  it("keeps the original when re-encoding it to its own format made it bigger", () => {
    encodedBytes = 9000;
    const original = new Blob([new Uint8Array(4000)], { type: "image/webp" });

    return expect(encodeOne(original, source("image/webp"), settings)).resolves.toMatchObject({
      outcome: "kept",
      size: 4000,
      mime: "image/webp",
    });
  });

  // The bug this pins: for a cut-out row the encode's INPUT is the matte
  // worker's lossless PNG, not the user's file. With a WebP source and the
  // WebP default, `mime === source.type` holds and the PNG very often wins
  // on size (large uniform transparent regions) — so the old code returned
  // PNG bytes labelled image/webp, named the download .webp, and told the
  // user it had "kept the original". It was neither.
  it("never reports 'kept' for a cut-out, however the sizes fall", async () => {
    encodedBytes = 9_000_000; // the cut-out's PNG is far smaller
    const cutoutPng = new Blob([new Uint8Array(50)], { type: "image/png" });

    const result = await encodeOne(cutoutPng, source("image/webp"), settings, true);

    expect(result.outcome).toBe("encoded");
    expect(result.mime).toBe("image/webp");
    expect(result.size).toBe(9_000_000);
    expect(result.blob.type).toBe("image/webp");
  });

  it("substitutes WebP for JPEG on a cut-out rather than flattening the alpha", async () => {
    encodedBytes = 500;
    const cutoutPng = new Blob([new Uint8Array(50)], { type: "image/png" });

    const result = await encodeOne(
      cutoutPng,
      source("image/jpeg"),
      { ...settings, format: "image/jpeg" },
      true,
    );

    expect(result.mime).toBe("image/webp");
    expect(result.outcome).toBe("encoded");
  });

  it("hands an SVG straight back without decoding it", async () => {
    const svg = new Blob(["<svg/>"], { type: "image/svg+xml" });
    const result = await encodeOne(svg, source("image/svg+xml"), settings);

    expect(result.outcome).toBe("passthrough");
    expect(result.blob).toBe(svg);
  });
});
