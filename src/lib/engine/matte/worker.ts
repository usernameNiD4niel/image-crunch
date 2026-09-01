/// <reference lib="webworker" />
import { env, AutoModel, AutoProcessor, RawImage } from "@huggingface/transformers";
import { MODEL_BASE } from "./assets";
import { DTYPE_FOR_DEVICE, pickDevice } from "./assets";
import { applyMaskAsAlpha, decontaminateEdges, normalizeMask } from "./refine";
import type { MatteRequest } from "./types";

// The whole privacy claim in one pair of lines: the model is only ever
// loaded from this app's own origin, never from a hub or CDN.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${MODEL_BASE.replace(/\/briaai\/RMBG-1\.4$/, "")}/`;

const MODEL_ID = "briaai/RMBG-1.4";

let model: Awaited<ReturnType<typeof AutoModel.from_pretrained>> | null = null;
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;
let currentGeneration = 0;

async function ensureLoaded() {
  if (model && processor) return;
  const device = pickDevice();
  model = await AutoModel.from_pretrained(MODEL_ID, {
    // This model's config announces SegformerForSemanticSegmentation, which
    // it is not; "custom" stops AutoModel dispatching on that and failing.
    config: { model_type: "custom" } as never,
    dtype: DTYPE_FOR_DEVICE[device],
    device,
  });
  processor = await AutoProcessor.from_pretrained(MODEL_ID, {
    config: {
      do_normalize: true,
      do_pad: false,
      do_rescale: true,
      do_resize: true,
      image_mean: [0.5, 0.5, 0.5],
      image_std: [1, 1, 1],
      resample: 2,
      size: { width: 1024, height: 1024 },
    },
  } as never);
}

self.onmessage = async (event: MessageEvent<MatteRequest>) => {
  const { id, generation, file } = event.data;
  currentGeneration = Math.max(currentGeneration, generation);

  try {
    await ensureLoaded();

    const image = await RawImage.fromBlob(file);
    const { pixel_values } = await processor!(image);
    const { output } = await model!({ input: pixel_values });

    // The model works at 1024x1024. Scale its MASK back to the source's
    // real dimensions — never the other way round, which would mean
    // shipping a downscaled image.
    const mask = await RawImage.fromTensor(output[0].mul(255).to("uint8")).resize(
      image.width,
      image.height,
    );

    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D context");

    const bitmap = await createImageBitmap(file);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    applyMaskAsAlpha(pixels.data, normalizeMask(new Uint8Array(mask.data)));
    decontaminateEdges(pixels.data, image.width, image.height);
    ctx.putImageData(pixels, 0, 0);

    // PNG, always: this blob is an intermediate that the encode pass then
    // compresses to whatever the user actually asked for, so it must not
    // lose anything here.
    const blob = await canvas.convertToBlob({ type: "image/png" });

    if (generation < currentGeneration) return;
    self.postMessage({
      type: "done",
      id,
      generation,
      result: { blob, width: image.width, height: image.height },
    });
  } catch (error) {
    if (generation < currentGeneration) return;
    self.postMessage({
      type: "error",
      id,
      generation,
      message: error instanceof Error ? error.message : "Background removal failed",
    });
  }
};
