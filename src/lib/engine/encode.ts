import type { EncodeSettings, EncodeResult, SourceInfo } from "./types";
import { isPassthrough, resolveOutputFormat, shouldKeepOriginal, targetDimensions } from "./plan";

export function canUseOffscreen(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas.prototype.convertToBlob === "function"
  );
}

/** decode -> resize -> encode, in ONE pass. */
export async function encodeOne(
  file: File,
  source: SourceInfo,
  settings: EncodeSettings,
): Promise<EncodeResult> {
  const mime = resolveOutputFormat(source.type, settings.format);

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
    const canvas = canUseOffscreen()
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });

    const ctx = canvas.getContext("2d") as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("Could not acquire a 2D context");

    // JPEG has no alpha: composite onto white rather than letting it go black.
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
    }

    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const quality = settings.quality / 100;
    const blob =
      canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: mime, quality })
        : await new Promise<Blob>((resolve, reject) =>
            (canvas as HTMLCanvasElement).toBlob(
              (b) => (b ? resolve(b) : reject(new Error("Encoding produced no data"))),
              mime,
              quality,
            ),
          );

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
