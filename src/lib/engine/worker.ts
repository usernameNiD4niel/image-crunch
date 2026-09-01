/// <reference lib="webworker" />
import type { EncodeSettings, SourceInfo } from "./types";
import { encodeOne } from "./encode";

export interface EncodeRequest {
  type: "encode";
  id: string;
  generation: number;
  file: Blob;
  source: SourceInfo;
  settings: EncodeSettings;
  needsAlpha?: boolean;
}

let currentGeneration = 0;

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { id, generation, file, source, settings, needsAlpha } = event.data;
  currentGeneration = Math.max(currentGeneration, generation);

  try {
    const result = await encodeOne(file, source, settings, needsAlpha);

    // Settings moved on while we were encoding — drop it.
    if (generation < currentGeneration) return;

    self.postMessage({ type: "done", id, generation, result });
  } catch (error) {
    if (generation < currentGeneration) return;
    self.postMessage({
      type: "error",
      id,
      generation,
      message: error instanceof Error ? error.message : "Encoding failed",
    });
  }
};
