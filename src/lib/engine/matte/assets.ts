/** Where the weights live, relative to this app's own origin. */
export const MODEL_BASE = "/models/briaai/RMBG-1.4";

/**
 * Where the ONNX Runtime WASM artifacts live, relative to this app's own
 * origin. `scripts/fetch-model.mjs` copies them out of the installed
 * `onnxruntime-web` package, so the bytes always match the version bundled
 * into the worker.
 *
 * This is not a nicety. transformers.js, at import time, points
 * `env.backends.onnx.wasm.wasmPaths` at
 * `https://cdn.jsdelivr.net/npm/onnxruntime-web@<version>/dist/` unless it
 * is already set — so without this override the very first cut-out fetches
 * ~23 MB of runtime from a third-party CDN, handing it the user's IP, UA
 * and referrer. The app's own copy says images never leave the device;
 * that has to be true of the machinery as well as the pixels.
 */
export const ORT_WASM_BASE = "/models/ort/";

/**
 * The same wasmPaths transformers.js chose, re-pointed at this origin.
 *
 * transformers.js picks the FILENAMES itself (a Safari/non-Safari split
 * between the plain and the asyncify build), so this keeps its choice and
 * replaces only the host — rather than hard-coding a filename here that a
 * future version of the library would stop agreeing with. When nothing has
 * been set, the bare prefix is enough: onnxruntime-web then appends the
 * name its own build expects.
 */
export function localWasmPaths(current?: unknown): string | Record<string, string> {
  if (current && typeof current === "object") {
    return Object.fromEntries(
      Object.entries(current as Record<string, string>).map(([key, url]) => [
        key,
        `${ORT_WASM_BASE}${String(url).split("/").pop()}`,
      ]),
    );
  }
  return ORT_WASM_BASE;
}

/**
 * The ONNX file each backend loads.
 *
 * The fp16 build is saved as `model.onnx` deliberately: transformers.js
 * would not resolve `dtype: "fp16"` to `model_fp16.onnx` with this model's
 * bare config, and asked for `model.onnx` instead. Saving the fp16 bytes
 * under the requested name is the verified path — renaming it "honestly"
 * breaks loading.
 */
export const MODEL_FILES = {
  webgpu: "model.onnx",
  wasm: "model_quantized.onnx",
} as const;

/**
 * Whether the weights were actually deployed.
 *
 * Deliberately not a status-code check: a dev server (and many static
 * hosts) answer a missing path with index.html and a 200, which the ONNX
 * runtime then fails to parse as protobuf with an error that says nothing
 * useful. Sniffing the content type turns that into a message we can show.
 */
export type MatteDevice = keyof typeof MODEL_FILES;

/**
 * Which dtype name loads each device's weights. "fp32" is the name that
 * resolves to `model.onnx` — which holds the fp16 weights, per the comment
 * above. Measured on a 1280x1709 photo: 0.57s on WebGPU with these weights
 * against 5.9-7.9s for q8, because int8 gets no acceleration there.
 */
export const DTYPE_FOR_DEVICE = {
  webgpu: "fp32",
  wasm: "q8",
} as const;

export function pickDevice(): MatteDevice {
  return typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm";
}

export async function isModelPresent(
  device: MatteDevice,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    // The weights, not the config: a deployment can carry the small JSON
    // files and still be missing the file that actually matters.
    // A GET, because HEAD is what a dev server is least likely to answer
    // the way it answers the real request — but a GET for ONE byte, and
    // with the body dropped either way. Without both, a presence check
    // would pull the whole 88 MB file it is only asking about.
    const response = await fetchImpl(`${MODEL_BASE}/onnx/${MODEL_FILES[device]}`, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });
    await response.body?.cancel().catch(() => {});
    if (!response.ok) return false;
    const type = response.headers.get("content-type") ?? "";
    return !type.includes("text/html");
  } catch {
    return false;
  }
}
