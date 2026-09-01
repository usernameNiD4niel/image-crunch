export type OutputFormat = "keep" | "image/jpeg" | "image/png" | "image/webp" | "image/x-icon";
export type ResizePreset = "none" | 2048 | 1280;
/** The largest image in an .ico bundle; the standard smaller sizes ride along. */
export type IconSize = 16 | 32 | 48 | 64 | 128 | 256;

export interface EncodeSettings {
  quality: number; // 10–100
  resize: ResizePreset;
  format: OutputFormat;
  // Only consulted when format is "image/x-icon". An .ico carries lossless
  // PNGs at fixed square sizes, so neither `quality` nor `resize` applies to
  // it — the icon size is what makes an icon small.
  icon: IconSize;
}

export interface SourceInfo {
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
}

export type ItemStatus = "queued" | "working" | "done" | "passthrough" | "kept" | "error";

/**
 * Which of the three things the engine actually did. These are NOT
 * interchangeable and the app must never collapse them:
 *
 * - "encoded"     — decoded, resized and re-encoded; the new bytes shipped.
 * - "passthrough" — a vector/icon returned untouched, never decoded at all.
 * - "kept"        — fully decoded and re-encoded, but the output came out no
 *                   smaller, so the ORIGINAL bytes are shipped instead.
 *
 * "passthrough" and "kept" both ship the source file, but only one of them
 * means "we didn't touch it". Reporting a re-encoded PNG as a passthrough is
 * exactly the kind of inaccuracy this redesign exists to remove.
 */
export type EncodeOutcome = "encoded" | "passthrough" | "kept";

export interface EncodeResult {
  blob: Blob;
  size: number;
  width: number;
  height: number;
  mime: string;
  outcome: EncodeOutcome;
}

export interface QueueItem {
  id: string;
  source: SourceInfo;
  file: File;
  previewUrl: string;
  status: ItemStatus;
  result?: EncodeResult;
  error?: string;
  /** The background-removed version of `file`, once one exists. */
  cutout?: { blob: Blob; width: number; height: number };
  /**
   * Whether background removal is running for this row. Deliberately not a
   * `status`: a row can be re-encoding AND having its background removed,
   * and one field cannot say both.
   */
  matting?: boolean;
}
