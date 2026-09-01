import type { EncodeSettings, EncodeResult, SourceInfo } from "./types";
import {
  iconBundleSizes,
  isPassthrough,
  resolveOutputFormat,
  shouldKeepOriginal,
  targetDimensions,
} from "./plan";
import { buildIco } from "./ico";

export function canUseOffscreen(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas.prototype.convertToBlob === "function"
  );
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(width: number, height: number, offscreen: boolean): AnyCanvas {
  return offscreen
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
}

function contextOf(canvas: AnyCanvas) {
  const ctx = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Could not acquire a 2D context");
  return ctx;
}

function toBlob(canvas: AnyCanvas, offscreen: boolean, mime: string, quality: number): Promise<Blob> {
  return offscreen
    ? (canvas as OffscreenCanvas).convertToBlob({ type: mime, quality })
    : new Promise<Blob>((resolve, reject) =>
        (canvas as HTMLCanvasElement).toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Encoding produced no data"))),
          mime,
          quality,
        ),
      );
}

/**
 * One .ico holding the standard icon sizes up to the one picked.
 *
 * Each image is drawn square and *contained*: a 900×600 source becomes a
 * 64×64 icon with transparent bands top and bottom rather than a squashed
 * or cropped one. Nothing here consults `quality` — the images inside an
 * .ico are PNGs, and PNG is lossless.
 */
async function encodeIco(
  bitmap: ImageBitmap,
  settings: EncodeSettings,
  offscreen: boolean,
): Promise<{ blob: Blob; size: number }> {
  const sizes = iconBundleSizes(settings.icon);
  const images: { size: number; png: Uint8Array }[] = [];

  for (const size of sizes) {
    const canvas = makeCanvas(size, size, offscreen);
    const ctx = contextOf(canvas);
    ctx.imageSmoothingQuality = "high";

    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);

    const png = await toBlob(canvas, offscreen, "image/png", 1);
    images.push({ size, png: new Uint8Array(await png.arrayBuffer()) });
  }

  const blob = buildIco(images);
  return { blob, size: blob.size };
}

/** decode -> resize -> encode, in ONE pass. */
export async function encodeOne(
  file: File,
  source: SourceInfo,
  settings: EncodeSettings,
  needsAlpha = false,
): Promise<EncodeResult> {
  const mime = resolveOutputFormat(source.type, settings.format, needsAlpha);

  if (isPassthrough(source.type)) {
    return {
      blob: file,
      size: file.size,
      width: source.width,
      height: source.height,
      mime: source.type,
      outcome: "passthrough",
    };
  }

  const { width, height } = targetDimensions(source.width, source.height, settings.resize);
  const bitmap = await createImageBitmap(file);

  try {
    // Decided ONCE and reused for the encode branch below. Re-testing with
    // `canvas instanceof OffscreenCanvas` would throw ReferenceError in
    // exactly the runtime the fallback exists for — one without the global.
    const offscreen = canUseOffscreen();

    // ICO leaves the single-canvas path entirely: it is a container of
    // several images, at sizes of its own, none of them decided by `resize`.
    if (mime === "image/x-icon") {
      const { blob, size } = await encodeIco(bitmap, settings, offscreen);
      const edge = settings.icon;
      return { blob, size, width: edge, height: edge, mime, outcome: "encoded" };
    }

    const canvas = makeCanvas(width, height, offscreen);
    const ctx = contextOf(canvas);

    // JPEG has no alpha: composite onto white rather than letting it go black.
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
    }

    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await toBlob(canvas, offscreen, mime, settings.quality / 100);

    // A "compressed" file that grew is not a saving. Ship the original.
    if (shouldKeepOriginal(file.size, blob.size) && settings.resize === "none" && mime === source.type) {
      return {
        blob: file,
        size: file.size,
        width: source.width,
        height: source.height,
        mime: source.type,
        outcome: "kept",
      };
    }

    return { blob, size: blob.size, width, height, mime, outcome: "encoded" };
  } finally {
    bitmap.close();
  }
}
