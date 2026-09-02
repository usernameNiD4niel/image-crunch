# Background Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone remove an image's background in the browser, per row, without the image or anything about it leaving the device, and without degrading the pixels that survive.

**Architecture:** A dedicated matte worker loads RMBG-1.4 through transformers.js from this app's own origin, returns a full-resolution alpha mask, and composes a cut-out from the *original* untouched pixels. The cut-out becomes that row's encode input; the format resolver forces an alpha-capable output. Nothing in the existing encode pool changes shape.

**Tech Stack:** React 18, TypeScript, Vite 5, Vitest, `@huggingface/transformers` (ONNX Runtime Web), Web Workers, OffscreenCanvas.

**Spec:** `docs/superpowers/specs/2026-09-01-background-removal-design.md`

## Global Constraints

- **Model files.** fp16 weights are saved as `public/models/briaai/RMBG-1.4/onnx/model.onnx` and loaded with `dtype: "fp32"`; q8 weights are saved as `onnx/model_quantized.onnx` and loaded with `dtype: "q8"`. This naming is not cosmetic — it is the only combination verified to load (see spec, finding 3).
- **Weights are never committed.** `public/models/` is gitignored. Any task that stages files must not stage weights.
- **Measured budgets.** WebGPU + fp16: ~0.6 s per image. WASM + q8: ~5 s. Preprocessing and composition scale with source size; inference does not.
- **The mask must be normalised to a true 255 maximum** before use. The q8 build tops out at 254.
- **RGB is never resampled.** The cut-out is the source's own pixels plus an alpha channel.
- **Colour.** `--signal` (red) stays reserved for the download action. Cut-out UI uses ink.
- **Existing test commands:** `npx vitest run`, `npm run typecheck` (which is `tsc -b`, not `tsc --noEmit`), `npx eslint src`.
- **Every commit must leave `npx vitest run` and `npm run typecheck` green.**

---

### Task 1: Model assets — fetch script and presence check

**Files:**
- Create: `scripts/fetch-model.mjs`
- Create: `src/lib/engine/matte/assets.ts`
- Create: `src/lib/engine/matte/assets.test.ts`
- Modify: `package.json` (scripts)
- Modify: `.gitignore` (verify `public/models/` is present; add if not)

**Interfaces:**
- Consumes: nothing.
- Produces: `MODEL_BASE = "/models/briaai/RMBG-1.4"`, `MatteDevice = "webgpu" | "wasm"`, `MODEL_FILES` (device → filename), `DTYPE_FOR_DEVICE` (device → dtype), `pickDevice(): MatteDevice`, `isModelPresent(device: MatteDevice, fetchImpl?: typeof fetch): Promise<boolean>`. Backend selection lives here rather than in its own module because the device, the dtype and the filename are one decision — splitting them invites a mismatched pair.

- [ ] **Step 1: Write the failing test**

`src/lib/engine/matte/assets.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { MODEL_BASE, MODEL_FILES, DTYPE_FOR_DEVICE, pickDevice, isModelPresent } from "./assets";

const gpuDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, "gpu");

afterEach(() => {
  if (gpuDescriptor) Object.defineProperty(globalThis.navigator, "gpu", gpuDescriptor);
  else delete (globalThis.navigator as unknown as Record<string, unknown>).gpu;
});

describe("model assets", () => {
  it("names the file each backend loads", () => {
    // fp16 weights are saved as model.onnx because that is the name the
    // loader asks for; see the plan's Global Constraints.
    expect(MODEL_FILES.webgpu).toBe("model.onnx");
    expect(MODEL_FILES.wasm).toBe("model_quantized.onnx");
    expect(MODEL_BASE).toBe("/models/briaai/RMBG-1.4");
  });

  // Measured in the spike: q8 is ~10x slower than fp16 on WebGPU and no
  // faster than WASM, so the pairing is not arbitrary.
  it("pairs each device with the dtype measured fastest for it", () => {
    expect(DTYPE_FOR_DEVICE.webgpu).toBe("fp32");
    expect(DTYPE_FOR_DEVICE.wasm).toBe("q8");
  });

  it("chooses webgpu when the browser exposes it, wasm otherwise", () => {
    Object.defineProperty(globalThis.navigator, "gpu", { value: {}, configurable: true });
    expect(pickDevice()).toBe("webgpu");
    delete (globalThis.navigator as unknown as Record<string, unknown>).gpu;
    expect(pickDevice()).toBe("wasm");
  });

  it("checks the weights file for the device that will actually load it", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([8, 6]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }));
    await isModelPresent("webgpu", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe("/models/briaai/RMBG-1.4/onnx/model.onnx");
  });

  it("reports the model present when the server returns real bytes", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([8, 6, 18, 7]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }));
    await expect(isModelPresent("wasm", fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
  });

  // A dev server answers a missing file with index.html and a 200, which is
  // how the spike's protobuf parse failure happened. A status check alone
  // would call that "present".
  it("reports the model missing when the server answers with HTML", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!doctype html><html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    await expect(isModelPresent("wasm", fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("reports the model missing when the request fails outright", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network");
    });
    await expect(isModelPresent("wasm", fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/lib/engine/matte/assets.test.ts`
Expected: FAIL — `Failed to resolve import "./assets"`.

- [ ] **Step 3: Write the implementation**

`src/lib/engine/matte/assets.ts`:

```ts
/** Where the weights live, relative to this app's own origin. */
export const MODEL_BASE = "/models/briaai/RMBG-1.4";

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
    const response = await fetchImpl(`${MODEL_BASE}/onnx/${MODEL_FILES[device]}`, { method: "GET" });
    if (!response.ok) return false;
    const type = response.headers.get("content-type") ?? "";
    return !type.includes("text/html");
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/engine/matte/assets.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the fetch script**

`scripts/fetch-model.mjs`:

```js
// Downloads the RMBG-1.4 weights into public/models/, which is gitignored.
// Run by `npm run fetch-model`, and by `prebuild` so a deployment can never
// silently ship a build whose cut-out button cannot work.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const REPO = "https://huggingface.co/briaai/RMBG-1.4/resolve/main";
const OUT = "public/models/briaai/RMBG-1.4";

// [remote path, local path, minimum plausible bytes]
const FILES = [
  ["config.json", "config.json", 200],
  ["preprocessor_config.json", "preprocessor_config.json", 100],
  // fp16 weights under the name the loader asks for — see assets.ts.
  ["onnx/model_fp16.onnx", "onnx/model.onnx", 80_000_000],
  ["onnx/model_quantized.onnx", "onnx/model_quantized.onnx", 40_000_000],
];

async function alreadyThere(path, minBytes) {
  try {
    return (await stat(path)).size >= minBytes;
  } catch {
    return false;
  }
}

for (const [remote, local, minBytes] of FILES) {
  const target = join(OUT, local);
  if (await alreadyThere(target, minBytes)) {
    console.log(`have  ${local}`);
    continue;
  }
  console.log(`fetch ${remote} -> ${local}`);
  const response = await fetch(`${REPO}/${remote}`);
  if (!response.ok) {
    throw new Error(`${remote}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < minBytes) {
    throw new Error(`${remote}: got ${bytes.byteLength} bytes, expected at least ${minBytes}`);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

// The licence travels with the weights. RMBG-1.4 is free for
// non-commercial use only; commercial use needs an agreement with BRIA.
await writeFile(
  join(OUT, "LICENSE.txt"),
  [
    "RMBG-1.4 model weights (c) BRIA AI.",
    "Licence: bria-rmbg-1.4 — free for NON-COMMERCIAL use.",
    "Commercial use requires an agreement with BRIA.",
    "https://huggingface.co/briaai/RMBG-1.4",
    "",
  ].join("\n"),
);

console.log("model ready");
```

- [ ] **Step 6: Wire the npm scripts**

In `package.json`, add to `"scripts"`:

```json
"fetch-model": "node scripts/fetch-model.mjs",
"prebuild": "node scripts/fetch-model.mjs"
```

- [ ] **Step 7: Verify the script is idempotent and the guards hold**

Run: `npm run fetch-model`
Expected: on a machine that already has the files, four `have …` lines and `model ready`, with no download. On a clean machine, four `fetch …` lines. Then run it a second time and confirm it only prints `have …`.

Run: `git status --short`
Expected: **no** `public/models/` entries. If any appear, `.gitignore` is wrong — fix it before committing.

- [ ] **Step 8: Commit**

```bash
git add scripts/fetch-model.mjs src/lib/engine/matte/assets.ts src/lib/engine/matte/assets.test.ts package.json .gitignore
git commit -m "feat(matte): fetch and locate the RMBG-1.4 weights"
```

---

### Task 2: `refine.ts` — the pixel maths

This is where "maintain the quality" is actually implemented, and it is pure array work with no canvas, so it is fully unit-testable.

**Files:**
- Create: `src/lib/engine/matte/refine.ts`
- Create: `src/lib/engine/matte/refine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SOLID_ALPHA = 250`, `normalizeMask(mask: Uint8Array): Uint8Array`, `applyMaskAsAlpha(rgba: Uint8ClampedArray, mask: Uint8Array): void`, `decontaminateEdges(rgba: Uint8ClampedArray, width: number, height: number): void`.

- [ ] **Step 1: Write the failing test**

`src/lib/engine/matte/refine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeMask, applyMaskAsAlpha, decontaminateEdges, SOLID_ALPHA } from "./refine";

describe("normalizeMask", () => {
  // The q8 build tops out at 254, so "opaque" pixels would come out
  // fractionally transparent and composite wrong on every background.
  it("rescales a mask whose maximum is 254 so the maximum becomes 255", () => {
    const mask = normalizeMask(new Uint8Array([0, 127, 254]));
    expect(mask[2]).toBe(255);
    expect(mask[0]).toBe(0);
    expect(mask[1]).toBe(128);
  });

  it("leaves a mask that already reaches 255 untouched", () => {
    const mask = normalizeMask(new Uint8Array([0, 128, 255]));
    expect([...mask]).toEqual([0, 128, 255]);
  });

  it("leaves an all-zero mask alone rather than dividing by zero", () => {
    const mask = normalizeMask(new Uint8Array([0, 0, 0]));
    expect([...mask]).toEqual([0, 0, 0]);
  });
});

describe("applyMaskAsAlpha", () => {
  it("writes the mask into the alpha channel and leaves RGB untouched", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    applyMaskAsAlpha(rgba, new Uint8Array([255, 0]));

    expect([...rgba]).toEqual([10, 20, 30, 255, 40, 50, 60, 0]);
  });

  it("throws when the mask does not describe every pixel", () => {
    const rgba = new Uint8ClampedArray(8);
    expect(() => applyMaskAsAlpha(rgba, new Uint8Array([255]))).toThrow(/pixel/i);
  });
});

describe("decontaminateEdges", () => {
  // A half-transparent edge pixel holds a blend of subject and the
  // background that was just removed. Left as-is it shows up as a halo.
  it("replaces a partially transparent pixel's colour with its solid neighbour's", () => {
    // 2x1: [solid red][half-transparent green-contaminated]
    const rgba = new Uint8ClampedArray([200, 0, 0, 255, 0, 200, 0, 128]);
    decontaminateEdges(rgba, 2, 1);

    expect([...rgba.slice(4, 7)]).toEqual([200, 0, 0]);
    expect(rgba[7]).toBe(128); // alpha is not touched
  });

  it("leaves fully opaque pixels alone", () => {
    const rgba = new Uint8ClampedArray([200, 0, 0, 255, 0, 200, 0, 255]);
    decontaminateEdges(rgba, 2, 1);
    expect([...rgba]).toEqual([200, 0, 0, 255, 0, 200, 0, 255]);
  });

  it("leaves fully transparent pixels alone", () => {
    const rgba = new Uint8ClampedArray([200, 0, 0, 255, 9, 9, 9, 0]);
    decontaminateEdges(rgba, 2, 1);
    expect([...rgba.slice(4)]).toEqual([9, 9, 9, 0]);
  });

  it("leaves an edge pixel with no solid neighbour alone rather than inventing a colour", () => {
    const rgba = new Uint8ClampedArray([5, 6, 7, 128, 9, 9, 9, 0]);
    decontaminateEdges(rgba, 2, 1);
    expect([...rgba.slice(0, 3)]).toEqual([5, 6, 7]);
  });

  it("treats SOLID_ALPHA and above as solid", () => {
    expect(SOLID_ALPHA).toBe(250);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/lib/engine/matte/refine.test.ts`
Expected: FAIL — `Failed to resolve import "./refine"`.

- [ ] **Step 3: Write the implementation**

`src/lib/engine/matte/refine.ts`:

```ts
/** At or above this alpha a pixel counts as fully part of the subject. */
export const SOLID_ALPHA = 250;

/** Below this, a pixel is background and holds no subject colour worth keeping. */
const EMPTY_ALPHA = 4;

/**
 * Rescale a mask so its brightest value is a true 255.
 *
 * The q8 build of RMBG-1.4 caps at 254, which would leave every "fully
 * opaque" pixel one step transparent — invisible on white, visible as a
 * grey wash the moment the cut-out is composited on anything dark.
 */
export function normalizeMask(mask: Uint8Array): Uint8Array {
  let max = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] > max) max = mask[i];
  }
  if (max === 0 || max === 255) return mask;

  const scale = 255 / max;
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    out[i] = Math.round(mask[i] * scale);
  }
  return out;
}

/**
 * Write the mask into the alpha channel, in place, leaving RGB exactly as
 * it was. This is the whole of "the quality is maintained": the output is
 * the source's own pixels with an alpha channel, not a re-render.
 */
export function applyMaskAsAlpha(rgba: Uint8ClampedArray, mask: Uint8Array): void {
  if (mask.length * 4 !== rgba.length) {
    throw new Error(
      `mask describes ${mask.length} pixels but the image has ${rgba.length / 4}`,
    );
  }
  for (let i = 0; i < mask.length; i += 1) {
    rgba[i * 4 + 3] = mask[i];
  }
}

/**
 * Remove the halo.
 *
 * A partially transparent pixel on the boundary is a blend of the subject
 * and the background that was just deleted. Composited onto a new
 * background it shows the old one's colour as a fringe. Replacing its RGB
 * with the average of its solid neighbours keeps the soft edge (alpha is
 * untouched) while removing the borrowed colour.
 *
 * A pixel with no solid neighbour is left exactly as it was: with nothing
 * to sample, any "correction" would be invention.
 */
export function decontaminateEdges(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  // Read from a copy: a corrected pixel must not become the source for the
  // next pixel's correction, or the fix smears along the edge.
  const source = new Uint8ClampedArray(rgba);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const alpha = source[at + 3];
      if (alpha >= SOLID_ALPHA || alpha < EMPTY_ALPHA) continue;

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const near = (ny * width + nx) * 4;
          if (source[near + 3] < SOLID_ALPHA) continue;
          r += source[near];
          g += source[near + 1];
          b += source[near + 2];
          n += 1;
        }
      }

      if (n === 0) continue;
      rgba[at] = Math.round(r / n);
      rgba[at + 1] = Math.round(g / n);
      rgba[at + 2] = Math.round(b / n);
    }
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/engine/matte/refine.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/matte/refine.ts src/lib/engine/matte/refine.test.ts
git commit -m "feat(matte): mask normalisation, alpha application and edge decontamination"
```

---

### Task 3: The matte worker and `MatteClient`

**Files:**
- Create: `src/lib/engine/matte/types.ts`
- Create: `src/lib/engine/matte/worker.ts`
- Create: `src/lib/engine/matte/client.ts`
- Create: `src/lib/engine/matte/client.test.ts`
- Modify: `package.json` (add `@huggingface/transformers`)

**Interfaces:**
- Consumes: `refine.ts` exports (Task 2); `MODEL_BASE`, `DTYPE_FOR_DEVICE`, `pickDevice` (Task 1); `StaleResult` from `src/lib/engine/client.ts`.
- Produces: `MatteResult { blob: Blob; width: number; height: number }`, `class MatteClient { matte(id: string, file: File): Promise<MatteResult>; bumpGeneration(): number; dispose(): void }`.

- [ ] **Step 1: Install the dependency**

```bash
npm install @huggingface/transformers
```

- [ ] **Step 2: Write `types.ts`**

`src/lib/engine/matte/types.ts`:

```ts
/** A finished cut-out: the source's own pixels, plus an alpha channel. */
export interface MatteResult {
  blob: Blob;
  width: number;
  height: number;
}

export interface MatteRequest {
  type: "matte";
  id: string;
  generation: number;
  file: File;
}

export type MatteResponse =
  | { type: "done"; id: string; generation: number; result: MatteResult }
  | { type: "error"; id: string; generation: number; message: string };
```

- [ ] **Step 3: Write the worker**

`src/lib/engine/matte/worker.ts`:

```ts
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
```

- [ ] **Step 4: Write the failing client test**

`src/lib/engine/matte/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MatteClient } from "./client";
import { StaleResult } from "@/lib/engine/client";

// The same shape of double used in engine/client.test.ts: it records
// postMessage and lets the test fire onmessage by hand. It never pretends
// to have produced a real cut-out — the seam under test is message routing
// and pending-map bookkeeping, nothing else.
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}

const file = () => new File(["x"], "a.png", { type: "image/png" });
const result = () => ({ blob: new Blob(["cut"]), width: 10, height: 10 });

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MatteClient", () => {
  it("spawns no worker until the first request, so nobody pays for a model they never use", () => {
    const client = new MatteClient();
    expect(FakeWorker.instances).toHaveLength(0);
    client.matte("a", file());
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("reuses the one worker across requests rather than reloading the model", () => {
    const client = new MatteClient();
    client.matte("a", file());
    client.matte("b", file());
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("resolves with the cut-out the worker reports", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    const worker = FakeWorker.instances[0];
    const sent = worker.postMessage.mock.calls[0][0];

    worker.onmessage!({ data: { type: "done", id: "a", generation: sent.generation, result: result() } });

    await expect(promise).resolves.toMatchObject({ width: 10, height: 10 });
  });

  it("rejects with the worker's message on failure", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    const worker = FakeWorker.instances[0];
    const sent = worker.postMessage.mock.calls[0][0];

    worker.onmessage!({ data: { type: "error", id: "a", generation: sent.generation, message: "out of memory" } });

    await expect(promise).rejects.toThrow("out of memory");
  });

  // A cut-out the user cancelled (by removing the row, or resetting) must
  // not land later and resurrect state that has moved on.
  it("rejects an in-flight request with StaleResult when the generation is bumped", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    client.bumpGeneration();
    await expect(promise).rejects.toBeInstanceOf(StaleResult);
  });

  it("ignores a late reply for a superseded generation", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    client.bumpGeneration();
    await expect(promise).rejects.toBeInstanceOf(StaleResult);

    const worker = FakeWorker.instances[0];
    expect(() =>
      worker.onmessage!({ data: { type: "done", id: "a", generation: 0, result: result() } }),
    ).not.toThrow();
  });

  it("rejects everything pending when the worker dies", async () => {
    const client = new MatteClient();
    const promise = client.matte("a", file());
    FakeWorker.instances[0].onerror!({ message: "worker exploded" });
    await expect(promise).rejects.toThrow(/worker/i);
  });

  it("refuses work after disposal and terminates the worker", async () => {
    const client = new MatteClient();
    client.matte("a", file()).catch(() => {});
    client.dispose();
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    await expect(client.matte("b", file())).rejects.toThrow(/disposed/i);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npx vitest run src/lib/engine/matte/client.test.ts`
Expected: FAIL — `Failed to resolve import "./client"`.

- [ ] **Step 6: Write the client**

`src/lib/engine/matte/client.ts`:

```ts
import { StaleResult } from "@/lib/engine/client";
import type { MatteResponse, MatteResult } from "./types";

interface Pending {
  resolve: (result: MatteResult) => void;
  reject: (error: Error) => void;
  generation: number;
}

/**
 * One worker, one model, loaded on demand.
 *
 * Deliberately NOT the encode pool: four pooled workers would mean four
 * copies of an 85 MB model, and a single inference would starve three
 * encodes for as long as it ran. The generation/staleness contract is the
 * same as EncodeClient's, so both subsystems cancel work the same way.
 */
export class MatteClient {
  private worker: Worker | null = null;
  private generation = 0;
  private pending = new Map<string, Pending>();
  private disposed = false;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<MatteResponse>) => this.handle(event.data);
      this.worker.onerror = (event) => this.handleWorkerError(event);
    }
    return this.worker;
  }

  private handle(message: MatteResponse): void {
    const entry = this.pending.get(message.id);
    // Not just "unknown id": a late reply for a generation we have already
    // superseded must be dropped, never delivered.
    if (!entry || entry.generation !== message.generation) return;
    this.pending.delete(message.id);

    if (message.type === "done") entry.resolve(message.result);
    else entry.reject(new Error(message.message));
  }

  private handleWorkerError(event: { message?: string }): void {
    const message = event.message ?? "the background-removal worker failed";
    for (const [id, entry] of this.pending) {
      entry.reject(new Error(message));
      this.pending.delete(id);
    }
    // The model's state is unknowable after a hard failure; drop the worker
    // so the next request starts clean rather than talking to a corpse.
    this.worker?.terminate();
    this.worker = null;
  }

  bumpGeneration(): number {
    this.generation += 1;
    for (const [id, entry] of this.pending) {
      if (entry.generation < this.generation) {
        entry.reject(new StaleResult());
        this.pending.delete(id);
      }
    }
    return this.generation;
  }

  matte(id: string, file: File): Promise<MatteResult> {
    if (this.disposed) return Promise.reject(new Error("MatteClient has been disposed"));

    const worker = this.ensureWorker();
    const generation = this.generation;

    return new Promise<MatteResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, generation });
      worker.postMessage({ type: "matte", id, generation, file });
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const [id, entry] of this.pending) {
      entry.reject(new StaleResult());
      this.pending.delete(id);
    }
    this.worker?.terminate();
    this.worker = null;
  }
}
```

- [ ] **Step 7: Run the client test and watch it pass**

Run: `npx vitest run src/lib/engine/matte/client.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 8: Full verification and commit**

```bash
npx vitest run
npm run typecheck
npx eslint src
git add src/lib/engine/matte package.json package-lock.json
git commit -m "feat(matte): dedicated worker and client for in-browser matting"
```

Expected: all tests pass, zero type errors, zero lint errors.

---

### Task 4: Alpha-aware format resolution

**Files:**
- Modify: `src/lib/engine/plan.ts` (`resolveOutputFormat`)
- Modify: `src/lib/engine/plan.test.ts`
- Modify: `src/lib/engine/encode.ts`
- Modify: `src/lib/engine/worker.ts` (`EncodeRequest`)
- Modify: `src/lib/engine/client.ts` (`encode` signature)
- Modify: `src/lib/engine/client.test.ts` (call sites)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveOutputFormat(sourceType: string, format: OutputFormat, needsAlpha?: boolean): string`; `encodeOne(file, source, settings, needsAlpha?: boolean)`; `EncodeClient.encode(id, file, source, settings, needsAlpha?: boolean)`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/engine/plan.test.ts`:

```ts
describe("resolveOutputFormat when the image needs transparency", () => {
  // JPG cannot carry an alpha channel, so a cut-out saved as JPG would
  // silently composite onto black — the one outcome worse than refusing.
  it("substitutes WebP for JPG", () => {
    expect(resolveOutputFormat("image/png", "image/jpeg", true)).toBe("image/webp");
  });

  it("substitutes WebP when 'keep' would have resolved to JPG", () => {
    expect(resolveOutputFormat("image/jpeg", "keep", true)).toBe("image/webp");
  });

  it("leaves the alpha-capable formats alone", () => {
    expect(resolveOutputFormat("image/png", "image/png", true)).toBe("image/png");
    expect(resolveOutputFormat("image/png", "image/webp", true)).toBe("image/webp");
    expect(resolveOutputFormat("image/png", "image/x-icon", true)).toBe("image/x-icon");
  });

  it("changes nothing when transparency is not needed", () => {
    expect(resolveOutputFormat("image/png", "image/jpeg", false)).toBe("image/jpeg");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/engine/plan.test.ts`
Expected: FAIL — the first two expect `image/webp` but receive `image/jpeg`.

- [ ] **Step 3: Implement in `plan.ts`**

Replace `resolveOutputFormat` with:

```ts
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/engine/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread `needsAlpha` through the encode path**

In `src/lib/engine/encode.ts`, change the signature and the one call:

```ts
export async function encodeOne(
  file: File,
  source: SourceInfo,
  settings: EncodeSettings,
  needsAlpha = false,
): Promise<EncodeResult> {
  const mime = resolveOutputFormat(source.type, settings.format, needsAlpha);
```

In `src/lib/engine/worker.ts`, add the field and pass it:

```ts
export interface EncodeRequest {
  type: "encode";
  id: string;
  generation: number;
  file: File;
  source: SourceInfo;
  settings: EncodeSettings;
  needsAlpha?: boolean;
}
```

```ts
  const { id, generation, file, source, settings, needsAlpha } = event.data;
  // ...
    const result = await encodeOne(file, source, settings, needsAlpha);
```

In `src/lib/engine/client.ts`, add the parameter to `encode` and include it in both the worker `postMessage` payload and the main-thread `encodeOne` fallback call:

```ts
  async encode(
    id: string,
    file: File,
    source: SourceInfo,
    settings: EncodeSettings,
    needsAlpha = false,
  ): Promise<EncodeResult> {
```

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run` then `npm run typecheck`
Expected: everything passes; `needsAlpha` is optional so no existing call site breaks.

- [ ] **Step 7: Commit**

```bash
git add src/lib/engine
git commit -m "feat(engine): resolve to an alpha-capable format when the image needs one"
```

---

### Task 5: Queue state for cut-outs

**Files:**
- Modify: `src/lib/engine/types.ts` (`QueueItem`)
- Modify: `src/hooks/useQueue.ts` (actions + reducer)
- Modify: `src/hooks/useQueue.test.ts`

**Interfaces:**
- Consumes: `MatteResult` (Task 3).
- Produces: `QueueItem.cutout?: MatteResult`, `QueueItem.matting?: boolean`, and the actions `{type:"matte-start"; id}`, `{type:"matte-done"; id; cutout: MatteResult}`, `{type:"matte-error"; id; message}`, `{type:"matte-clear"; id}`.

- [ ] **Step 1: Write the failing test**

Add to `src/hooks/useQueue.test.ts`:

```ts
describe("queueReducer cut-outs", () => {
  const cutout = { blob: new Blob(["cut"]), width: 100, height: 100 };

  function queued() {
    return queueReducer(initialQueueState, { type: "add", items: [item("a"), item("b")] });
  }

  it("marks only the requested row as matting", () => {
    const state = queueReducer(queued(), { type: "matte-start", id: "a" });
    expect(state.items[0].matting).toBe(true);
    expect(state.items[1].matting).toBeFalsy();
  });

  it("stores the cut-out, clears the flag and returns the row to queued for re-encoding", () => {
    const started = queueReducer(queued(), { type: "matte-start", id: "a" });
    const state = queueReducer(started, { type: "matte-done", id: "a", cutout });

    expect(state.items[0].cutout).toBe(cutout);
    expect(state.items[0].matting).toBe(false);
    expect(state.items[0].status).toBe("queued");
  });

  it("reports a failure on the row without leaving it stuck busy", () => {
    const started = queueReducer(queued(), { type: "matte-start", id: "a" });
    const state = queueReducer(started, { type: "matte-error", id: "a", message: "out of memory" });

    expect(state.items[0].matting).toBe(false);
    expect(state.items[0].status).toBe("error");
    expect(state.items[0].error).toBe("out of memory");
  });

  // The action is reversible: restoring puts the original back and sends
  // the row to be encoded again from it.
  it("drops the cut-out and requeues the row on matte-clear", () => {
    const started = queueReducer(queued(), { type: "matte-start", id: "a" });
    const done = queueReducer(started, { type: "matte-done", id: "a", cutout });
    const state = queueReducer(done, { type: "matte-clear", id: "a" });

    expect(state.items[0].cutout).toBeUndefined();
    expect(state.items[0].status).toBe("queued");
  });

  it("leaves other rows untouched throughout", () => {
    const started = queueReducer(queued(), { type: "matte-start", id: "a" });
    const done = queueReducer(started, { type: "matte-done", id: "a", cutout });
    expect(done.items[1]).toEqual(queued().items[1]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/hooks/useQueue.test.ts`
Expected: FAIL — the reducer's `default` branch returns state unchanged, so `matting` is `undefined`.

- [ ] **Step 3: Extend `QueueItem`**

In `src/lib/engine/types.ts`:

```ts
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
```

- [ ] **Step 4: Add the actions to the reducer**

In `src/hooks/useQueue.ts`, extend `QueueAction`:

```ts
  | { type: "matte-start"; id: string }
  | { type: "matte-done"; id: string; cutout: { blob: Blob; width: number; height: number } }
  | { type: "matte-error"; id: string; message: string }
  | { type: "matte-clear"; id: string }
```

And add the cases before `default`:

```ts
    case "matte-start":
      return {
        ...state,
        items: state.items.map((i) => (i.id === action.id ? { ...i, matting: true } : i)),
      };
    case "matte-done":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id
            ? // Back to "queued", not "done": the row's stored result was
              // encoded from the ORIGINAL and no longer describes what this
              // row is. currentResult withholds it until the re-encode lands.
              { ...i, matting: false, cutout: action.cutout, status: "queued", error: undefined }
            : i,
        ),
      };
    case "matte-error":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id
            ? { ...i, matting: false, status: "error", error: action.message, result: undefined }
            : i,
        ),
      };
    case "matte-clear":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id
            ? { ...i, cutout: undefined, matting: false, status: "queued", error: undefined }
            : i,
        ),
      };
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/hooks/useQueue.test.ts` then `npm run typecheck`
Expected: PASS; zero type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/types.ts src/hooks/useQueue.ts src/hooks/useQueue.test.ts
git commit -m "feat(queue): cut-out state and its four transitions"
```

---

### Task 6: Hook wiring — run the matte, re-encode from the cut-out

**Files:**
- Modify: `src/hooks/useQueue.ts`
- Modify: `src/hooks/useQueue.test.ts`

**Interfaces:**
- Consumes: `MatteClient` (Task 3), reducer actions (Task 5), `EncodeClient.encode(..., needsAlpha)` (Task 4).
- Produces: `useQueue()` additionally returns `cutOut(item: QueueItem): void` and `restoreBackground(item: QueueItem): void`.

- [ ] **Step 1: Write the failing test**

Add to `src/hooks/useQueue.test.ts`. Note the mock at the top of the file must gain the matte client — add this alongside the existing `vi.mock` calls:

```ts
const { matteMock, MockMatteClient } = vi.hoisted(() => {
  const matteMock = vi.fn(async () => ({ blob: new Blob(["cut"]), width: 100, height: 100 }));
  class MockMatteClient {
    matte = matteMock;
    bumpGeneration = vi.fn();
    dispose = vi.fn();
  }
  return { matteMock, MockMatteClient };
});

vi.mock("@/lib/engine/matte/client", () => ({ MatteClient: MockMatteClient }));
```

Then the tests:

```ts
describe("useQueue cut-outs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    cleanup();
  });

  async function settledQueue() {
    vi.useFakeTimers();
    encodeMock.mockImplementation(async () => ({
      blob: new Blob(["x"]),
      size: 10,
      width: 1,
      height: 1,
      mime: "image/png",
      outcome: "encoded" as const,
    }));
    const hook = renderHook(() => useQueue());
    act(() => {
      hook.result.current.dispatch({ type: "add", items: [item("a")] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    return hook;
  }

  it("re-encodes the row from the cut-out, not from the original file", async () => {
    const hook = await settledQueue();
    encodeMock.mockClear();

    await act(async () => {
      hook.result.current.cutOut(hook.result.current.items[0]);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(matteMock).toHaveBeenCalledTimes(1);
    const [, encodedFrom] = encodeMock.mock.calls[0] as unknown[];
    expect(encodedFrom).toBe(hook.result.current.items[0].cutout?.blob);
  });

  it("tells the encoder the output needs an alpha channel", async () => {
    const hook = await settledQueue();
    encodeMock.mockClear();

    await act(async () => {
      hook.result.current.cutOut(hook.result.current.items[0]);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect((encodeMock.mock.calls[0] as unknown[])[4]).toBe(true);
  });

  it("puts the failure on the row when matting fails", async () => {
    const hook = await settledQueue();
    matteMock.mockRejectedValueOnce(new Error("out of memory"));

    await act(async () => {
      hook.result.current.cutOut(hook.result.current.items[0]);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(hook.result.current.items[0].status).toBe("error");
    expect(hook.result.current.items[0].error).toBe("out of memory");
  });

  it("restores the original and encodes from it again", async () => {
    const hook = await settledQueue();
    await act(async () => {
      hook.result.current.cutOut(hook.result.current.items[0]);
      await vi.advanceTimersByTimeAsync(300);
    });
    encodeMock.mockClear();

    await act(async () => {
      hook.result.current.restoreBackground(hook.result.current.items[0]);
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(hook.result.current.items[0].cutout).toBeUndefined();
    const [, encodedFrom] = encodeMock.mock.calls[0] as unknown[];
    expect(encodedFrom).toBe(hook.result.current.items[0].file);
  });

  it("cancels in-flight matting when the queue is reset", async () => {
    const hook = await settledQueue();
    act(() => {
      hook.result.current.cutOut(hook.result.current.items[0]);
      hook.result.current.reset();
    });
    expect(hook.result.current.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/hooks/useQueue.test.ts`
Expected: FAIL — `hook.result.current.cutOut is not a function`.

- [ ] **Step 3: Implement in `useQueue.ts`**

Add the import and the client, beside the existing `clientRef`:

```ts
import { MatteClient } from "@/lib/engine/matte/client";
```

```ts
  const matteRef = useRef<MatteClient | null>(null);
  if (matteRef.current === null) matteRef.current = new MatteClient();
```

Extend the unmount effect to dispose it too:

```ts
  useEffect(() => {
    return () => {
      clientRef.current?.dispose();
      matteRef.current?.dispose();
      releaseAll();
    };
  }, []);
```

Teach the sweep to encode from the cut-out. In `runAll`, replace the encode call with:

```ts
      client
        .encode(item.id, item.cutout?.blob ?? item.file, item.source, settingsRef.current, !!item.cutout)
```

Note `item.cutout.blob` is a `Blob`, and `encode` takes a `File`; widen the parameter type in `client.ts` and `worker.ts` from `File` to `Blob` (a `File` is a `Blob`, so no call site changes).

Add the two callbacks before the `return`:

```ts
  // Background removal is per row and explicit: it costs seconds and a
  // model download, so it never happens because a setting moved.
  const cutOut = useCallback((item: QueueItem) => {
    const matte = matteRef.current;
    if (!matte) return;

    dispatch({ type: "matte-start", id: item.id });
    matte
      .matte(item.id, item.file)
      .then((cutout) => dispatch({ type: "matte-done", id: item.id, cutout }))
      .catch((error) => {
        if (error instanceof StaleResult) return; // superseded, not a failure
        dispatch({ type: "matte-error", id: item.id, message: error.message });
      });
  }, []);

  const restoreBackground = useCallback((item: QueueItem) => {
    dispatch({ type: "matte-clear", id: item.id });
  }, []);
```

Cancel matting in `reset`, alongside the encode generation bump:

```ts
    clientRef.current?.bumpGeneration();
    matteRef.current?.bumpGeneration();
```

And return them:

```ts
  return { ...state, totals, pending, dispatch, downloadOne, downloadAll, removeItem, reset, cutOut, restoreBackground };
```

- [ ] **Step 4: Make the sweep notice a new cut-out**

The debounced effect keys on item ids and settings, so a `matte-done` would not trigger it. Add a key that changes when a cut-out appears or disappears:

```ts
  const cutoutKey = state.items.map((i) => (i.cutout ? `${i.id}+` : `${i.id}-`)).join(",");
```

and add `cutoutKey` to the effect's dependency array, beside `itemIdsKey`.

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/hooks/useQueue.test.ts` then `npx vitest run` then `npm run typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useQueue.ts src/hooks/useQueue.test.ts src/lib/engine/client.ts src/lib/engine/worker.ts
git commit -m "feat(queue): run background removal per row and re-encode from the cut-out"
```

---

### Task 7: The row control and the transparent-preview panel

**Files:**
- Modify: `src/components/QueueRow.tsx`
- Modify: `src/components/QueueRow.test.tsx`
- Modify: `src/components/Queue.tsx` (pass the callbacks through)
- Modify: `src/components/Queue.test.tsx` — every existing `<Queue …/>` render must gain `onCutOut={() => {}} onRestore={() => {}} jpgRequested={false}`, and every existing `<QueueRow …/>` render in `QueueRow.test.tsx` must gain `onCutOut={noop} onRestore={noop}`, or `npm run typecheck` fails even though the suite passes
- Modify: `src/components/Compare.tsx` (checkerboard)
- Modify: `src/components/Compare.test.tsx`
- Modify: `src/pages/Index.tsx` (wire the callbacks)

**Interfaces:**
- Consumes: `cutOut`, `restoreBackground` (Task 6); `QueueItem.cutout`/`matting` (Task 5).
- Produces: `QueueRowProps` gains `onCutOut: () => void`, `onRestore: () => void`; `QueueProps` gains `onCutOut: (item: QueueItem) => void`, `onRestore: (item: QueueItem) => void`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/QueueRow.test.tsx`:

```ts
describe("QueueRow background removal", () => {
  it("offers to cut out the background, naming the file", () => {
    const onCutOut = vi.fn();
    render(
      <QueueRow
        index={0}
        item={baseItem({ status: "done" })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        onCutOut={onCutOut}
        onRestore={noop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cut out background from photo.png" }));
    expect(onCutOut).toHaveBeenCalledTimes(1);
  });

  it("says what it is doing while the model runs, and disables the control", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({ status: "working", matting: true })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        onCutOut={noop}
        onRestore={noop}
      />,
    );

    expect(screen.getByText(/removing background/i)).toBeTruthy();
    const button = screen.getByRole("button", { name: /background from photo\.png/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("offers to restore once the row is cut out, and says so", () => {
    const onRestore = vi.fn();
    render(
      <QueueRow
        index={0}
        item={baseItem({ status: "done", cutout: { blob: new Blob(), width: 10, height: 10 } })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        onCutOut={noop}
        onRestore={onRestore}
      />,
    );

    expect(screen.getByText(/^cut out/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore background from photo.png" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  // JPG cannot hold transparency, so the row must say where its output
  // actually went rather than quietly disagreeing with the FORMAT control.
  it("states the format substitution when the output had to change", () => {
    render(
      <QueueRow
        index={0}
        item={baseItem({
          status: "done",
          cutout: { blob: new Blob(), width: 10, height: 10 },
          result: { blob: new Blob(), size: 90, width: 10, height: 10, mime: "image/webp", outcome: "encoded" },
        })}
        expanded={false}
        onToggle={noop}
        onDownload={noop}
        onRemove={noop}
        onCutOut={noop}
        onRestore={noop}
        formatSubstituted
      />,
    );

    expect(screen.getByText(/JPG has no transparency/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/QueueRow.test.tsx`
Expected: FAIL — no button with that accessible name.

- [ ] **Step 3: Implement the row control**

In `src/components/QueueRow.tsx`, extend the props:

```ts
interface QueueRowProps {
  index: number;
  item: QueueItem;
  expanded: boolean;
  onToggle: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onCutOut: () => void;
  onRestore: () => void;
  /** True when the queue's format is JPG and this row had to go elsewhere. */
  formatSubstituted?: boolean;
}
```

Add to the `ItemActions` block, before the download button:

```tsx
        <button
          type="button"
          onClick={item.cutout ? onRestore : onCutOut}
          disabled={item.matting}
          aria-label={
            item.cutout
              ? `Restore background from ${item.source.name}`
              : `Cut out background from ${item.source.name}`
          }
          className="focus-visible:ring-0 disabled:text-ink-58"
        >
          ✂
        </button>
```

Add the row lines, beside the existing `passthrough`/`kept` lines:

```tsx
      {item.matting && (
        <p className="data col-span-11 col-start-2 text-[0.8125rem] text-ink-72">
          removing background…
        </p>
      )}

      {item.cutout && !item.matting && (
        <p className="data col-span-11 col-start-2 text-[0.8125rem] text-ink-72">
          cut out
          {formatSubstituted && " · output as WEBP (JPG has no transparency)"}
        </p>
      )}
```

- [ ] **Step 4: Run the row test and watch it pass**

Run: `npx vitest run src/components/QueueRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Pass the callbacks through `Queue` and `Index`**

In `src/components/Queue.tsx`, add `onCutOut` and `onRestore` to `QueueProps` and hand them to each row along with the substitution flag:

```tsx
          <QueueRow
            key={item.id}
            index={index}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onDownload={() => onDownloadOne(item)}
            onRemove={() => onRemove(item)}
            onCutOut={() => onCutOut(item)}
            onRestore={() => onRestore(item)}
            formatSubstituted={!!item.cutout && jpgRequested}
          />
```

with `jpgRequested: boolean` added to `QueueProps`, supplied by `Index` as `settings.format === "image/jpeg"`.

In `src/pages/Index.tsx`, destructure `cutOut` and `restoreBackground` from `useQueue()` and pass them plus `jpgRequested={settings.format === "image/jpeg"}` to `<Queue />`.

- [ ] **Step 6: Write the failing checkerboard test**

Add to `src/components/Compare.test.tsx`:

```ts
  // A cut-out on a white pane is indistinguishable from a white background.
  it("puts a checkerboard behind the compressed pane so transparency reads as transparency", () => {
    render(<Compare item={item()} result={result()} />);

    const pane = screen.getByAltText("Compressed photo.png").parentElement;
    expect(pane?.getAttribute("data-checkerboard")).toBe("true");
  });
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run src/components/Compare.test.tsx`
Expected: FAIL — `expected null to be "true"`.

- [ ] **Step 8: Implement the checkerboard**

In `src/components/Compare.tsx`, give `Pane` a `checkerboard` prop, pass `checkerboard` on the compressed pane only, and render:

```tsx
      <div
        data-checkerboard={checkerboard ? "true" : undefined}
        className="aspect-video overflow-hidden border border-rule bg-paper"
        style={
          checkerboard
            ? {
                backgroundImage:
                  "linear-gradient(45deg,var(--paper-2) 25%,transparent 25%),linear-gradient(-45deg,var(--paper-2) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,var(--paper-2) 75%),linear-gradient(-45deg,transparent 75%,var(--paper-2) 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
              }
            : undefined
        }
      >
```

- [ ] **Step 9: Full verification and commit**

```bash
npx vitest run
npm run typecheck
npx eslint src
git add src/components src/pages/Index.tsx
git commit -m "feat(ui): cut-out control on each row and a transparent-aware preview"
```

---

### Task 8: Telling the truth about the download, the device and the licence

**Files:**
- Modify: `src/pages/Index.tsx`
- Modify: `src/components/Editorial.tsx`
- Create: `src/components/Editorial.test.tsx`

**Interfaces:**
- Consumes: `isModelPresent`, `pickDevice` (both Task 1), `cutOut` (Task 6).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test**

`src/components/Editorial.test.tsx`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Editorial } from "./Editorial";

afterEach(cleanup);

describe("Editorial", () => {
  // Entry 01 claims nothing leaves the browser. Background removal
  // downloads a model, which is the opposite direction — but it is a
  // network request, and the copy has to account for it or it is a lie by
  // omission.
  it("says the background model is downloaded from this site and runs locally", () => {
    render(<Editorial />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/background/i);
    expect(text).toMatch(/downloaded once/i);
    expect(text).toMatch(/never leave|never travel/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/Editorial.test.tsx`
Expected: FAIL — no matching copy.

- [ ] **Step 3: Add the copy**

In `src/components/Editorial.tsx`, extend entry 01's body with:

```
 Removing a background runs a model that is downloaded once from this site
 and then cached; it runs on your device like everything else, and your
 images never leave it.
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/components/Editorial.test.tsx`
Expected: PASS.

- [ ] **Step 5: Raise the first-run and missing-model notices**

In `src/pages/Index.tsx`, wrap the cut-out callback so the first invocation explains the download, and a missing deployment says so plainly:

```tsx
  const [modelWarned, setModelWarned] = useState(false);

  const onCutOut = useCallback(
    async (item: QueueItem) => {
      if (!modelWarned) {
        setModelWarned(true);
        const device = pickDevice();
        if (!(await isModelPresent(device))) {
          dispatch({
            type: "notice",
            message:
              "Background removal is unavailable: the model was not deployed. Run `npm run fetch-model` and redeploy.",
          });
          return;
        }
        dispatch({
          type: "notice",
          message:
            device === "webgpu"
              ? "Downloading the background model — about 85 MB, once. It stays on your device."
              : "This browser has no WebGPU, so background removal uses the slower fallback: about 43 MB to download, and a few seconds per image.",
        });
      }
      cutOut(item);
    },
    [cutOut, dispatch, modelWarned],
  );
```

Pass `onCutOut` to `<Queue />` in place of `cutOut`.

- [ ] **Step 6: Full verification and commit**

```bash
npx vitest run
npm run typecheck
npx eslint src
git add src/components/Editorial.tsx src/components/Editorial.test.tsx src/pages/Index.tsx
git commit -m "feat(ui): say what the model download costs, and when it is missing"
```

---

### Task 9: Browser verification

jsdom has no canvas, no WebGPU and no WASM threads, so none of the above proves the feature works. This task is manual and its findings are the deliverable.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-01-background-removal-design.md` (record results)

- [ ] **Step 1: Start the app with the weights present**

```bash
npm run fetch-model
npm run dev
```

- [ ] **Step 2: Cut out a photograph with fine edges**

Drop a photo of a person or animal with visible hair or fur. Press `✂`.

Expected: the row reads `removing background…`, then `cut out`; the row's dimensions are **unchanged**; the compare panel shows the subject on a checkerboard.

- [ ] **Step 3: Check for a halo**

Expand the compare panel and look at the boundary against the checkerboard, then download the file and open it on a dark background.

Expected: no bright or dark fringe tracing the subject. If there is one, `decontaminateEdges` is the place to look, not the model.

- [ ] **Step 4: Verify the pixels are genuinely untouched**

In DevTools:

```js
// Paste in the app's tab with a cut-out row expanded.
async function pixelAt(blob, x, y) {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d");
  g.drawImage(bmp, 0, 0);
  return [...g.getImageData(x, y, 1, 1).data];
}
const original = document.querySelector('input[type=file]').files[0];
const cut = await fetch(document.querySelector('img[alt^="Compressed"]').src).then((r) => r.blob());
console.log(await pixelAt(original, 400, 400), await pixelAt(cut, 400, 400));
```

Expected: identical RGB, differing only in alpha.

- [ ] **Step 5: Check the format substitution**

Set FORMAT to JPG, then cut out a row.

Expected: the row reads `cut out · output as WEBP (JPG has no transparency)` and the downloaded file is a `.webp` with transparency intact.

- [ ] **Step 6: Time both backends**

Record warm inference on WebGPU, then disable WebGPU (`chrome://flags`) and repeat.

Expected: roughly 0.6 s and roughly 5 s respectively, matching the spec's table. Record the actual numbers.

- [ ] **Step 7: Check a large source**

Cut out an image of at least 20 megapixels and watch memory in the Chrome task manager.

Expected: it completes, or it fails with a message. It must not hang or crash the tab silently. If it crashes, add the megapixel cap the spec's risk section anticipates.

- [ ] **Step 8: Record the findings and commit**

Update the spec's "Measured, not estimated" section with the observed numbers and anything that differed, then:

```bash
git add docs/superpowers/specs/2026-09-01-background-removal-design.md
git commit -m "docs: record the browser verification of background removal"
```

---

## Notes for whoever executes this

- **Task 3 is the risky one.** If `@huggingface/transformers` fights Vite's worker bundling, the fallback is `optimizeDeps.exclude: ["@huggingface/transformers"]` in `vite.config.ts`. The spike proved the import works in a module worker under this exact setup, so treat a failure here as configuration, not impossibility.
- **Never commit `public/models/`.** Check `git status --short` before every `git add` in this plan. A 128 MB blob in the history cannot be removed by a later commit.
- **The spike lives on `spike/background-removal`** if you want a working reference for the transformers.js calls. It is throwaway code — read it, don't import it.
