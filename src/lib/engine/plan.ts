import type { OutputFormat, ResizePreset } from "./types";

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

export function isPassthrough(type: string): boolean {
  return PASSTHROUGH_TYPES.includes(type);
}

export function resolveOutputFormat(sourceType: string, format: OutputFormat): string {
  const source = sourceType === "image/jpg" ? "image/jpeg" : sourceType;
  if (isPassthrough(source)) return source;
  if (format === "keep") return source === "image/gif" ? "image/png" : source;
  return format;
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

export function shouldKeepOriginal(originalBytes: number, outputBytes: number): boolean {
  return outputBytes >= originalBytes;
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

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
