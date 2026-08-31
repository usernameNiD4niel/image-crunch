export type OutputFormat = "keep" | "image/jpeg" | "image/png" | "image/webp";
export type ResizePreset = "none" | 2048 | 1280;

export interface EncodeSettings {
  quality: number; // 10–100
  resize: ResizePreset;
  format: OutputFormat;
}

export interface SourceInfo {
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
}

export type ItemStatus = "queued" | "working" | "done" | "passthrough" | "error";

export interface EncodeResult {
  blob: Blob;
  size: number;
  width: number;
  height: number;
  mime: string;
  keptOriginal: boolean;
}

export interface QueueItem {
  id: string;
  source: SourceInfo;
  file: File;
  previewUrl: string;
  status: ItemStatus;
  result?: EncodeResult;
  error?: string;
}
