import type { EncodeResult, IconSize, OutputFormat, QueueItem, ResizePreset } from "./types";

export const MAX_FILE_BYTES = 35 * 1024 * 1024;
export const MAX_QUEUE = 30;

export const PASSTHROUGH_TYPES = ["image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"];

export const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  ...PASSTHROUGH_TYPES,
];

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

// The sizes Windows and browsers actually look for in an .ico, smallest
// first. 256 is the format's ceiling (see ico.ts).
export const ICON_SIZES: IconSize[] = [16, 32, 48, 64, 128, 256];

/**
 * The images one .ico should contain given the size the user picked. The
 * pick is the LARGEST image in the bundle and the standard sizes below it
 * ride along, so a 64px icon is four images and still a small file, while a
 * 256px one is the full favicon.ico set.
 */
export function iconBundleSizes(largest: IconSize): IconSize[] {
  return ICON_SIZES.filter((size) => size <= largest);
}

export function isPassthrough(type: string): boolean {
  return PASSTHROUGH_TYPES.includes(type);
}

export function resolveOutputFormat(
  sourceType: string,
  format: OutputFormat,
  needsAlpha = false,
): string {
  const source = sourceType === "image/jpg" ? "image/jpeg" : sourceType;
  if (isPassthrough(source)) return source;

  const resolved = format === "keep" ? (source === "image/gif" ? "image/png" : source) : format;

  // A cut-out has transparency to lose. WebP rather than PNG because it
  // carries alpha at a fraction of the size, and this app exists to make
  // files smaller.
  if (needsAlpha && resolved === "image/jpeg") return "image/webp";
  return resolved;
}

export function targetDimensions(
  width: number,
  height: number,
  resize: ResizePreset,
): { width: number; height: number } {
  if (resize === "none") return { width, height };

  const longEdge = Math.max(width, height);
  if (longEdge <= resize) return { width, height };

  const scale = resize / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function savingsPercent(originalBytes: number, outputBytes: number): number {
  if (originalBytes <= 0) return 0;
  return ((originalBytes - outputBytes) / originalBytes) * 100;
}

/**
 * Whether re-encoding was pointless — the output is no smaller than what
 * went in.
 *
 * `inputBytes`, not "original": on a cut-out row the encode's input is the
 * matte's PNG intermediate, not the dropped file. This function only ever
 * compares two sizes; deciding whether the input is something the app may
 * hand back as "kept" is encodeOne's job, and it refuses to for a cut row.
 */
export function shouldKeepOriginal(inputBytes: number, outputBytes: number): boolean {
  return outputBytes >= inputBytes;
}

export function outputFilename(sourceName: string, mime: string, taken: Set<string>): string {
  const ext = EXTENSIONS[mime] ?? "bin";
  const lastDot = sourceName.lastIndexOf(".");
  const base = lastDot > 0 ? sourceName.slice(0, lastDot) : sourceName;

  let candidate = `${base}.${ext}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}.${ext}`;
    n += 1;
  }
  return candidate;
}

// Formats a signed savings percentage honestly: growth reads as growth
// ("+n%"), never as a mangled saving ("−-n%"). savingsPercent is negative
// when output grew past input. At (or rounding to) exactly zero, no sign
// is shown — "0.0%" implies neither a saving nor a loss. Shared by
// Masthead (the aggregate figure) and QueueRow (the per-row figure) so
// the sign logic lives in exactly one place.
export function formatPercent(percent: number): string {
  const magnitude = Math.abs(percent).toFixed(1);
  if (magnitude === "0.0") return "0.0%";
  return percent >= 0 ? `−${magnitude}%` : `+${magnitude}%`;
}

// The short, uppercase name for a mime type, as the compare panel captions
// its two panes. Derived from the same EXTENSIONS table the output filenames
// use, so a file saved as .webp is never captioned anything else; anything
// unmapped falls back to its own subtype rather than a lie or a blank.
export function formatLabel(mime: string): string {
  const ext = EXTENSIONS[mime === "image/jpg" ? "image/jpeg" : mime];
  return (ext ?? mime.split("/")[1] ?? mime).toUpperCase();
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The result a row may currently show or hand out, or `undefined` if there
 * isn't one.
 *
 * `item.result` alone is NOT that answer. The moment a re-encode starts
 * (status "working", which every 200ms-debounced settings sweep sets on
 * every row) the stored result describes the PREVIOUS quality/format — it
 * is superseded, even though it is still perfectly good bytes for the old
 * settings. An errored row's stored result is likewise no longer a
 * description of anything the app is offering.
 *
 * The bytes are deliberately NOT deleted from the item on "working": the
 * expanded Compare panel would tear down and rebuild on every slider step,
 * and rows would blank out and refill on every settings change, which is a
 * worse experience than the bug. Instead every CONSUMER — download-one,
 * download-all, the size and percentage columns, the totals — asks this
 * function, so nothing stale is ever shown as current or handed to the
 * user as a download.
 */
export function currentResult(item: QueueItem): EncodeResult | undefined {
  // A whitelist, not a blacklist: only the three settled statuses describe a
  // result the app is currently offering. "queued" is on this list's wrong
  // side deliberately — a settings change returns every row to it, so the
  // superseded bytes stop counting the instant the setting moves rather than
  // when the debounced sweep finally starts.
  if (item.status !== "done" && item.status !== "passthrough" && item.status !== "kept") {
    return undefined;
  }
  return item.result;
}
