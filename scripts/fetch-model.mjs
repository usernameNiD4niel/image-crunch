// Downloads the RMBG-1.4 weights into public/models/, which is gitignored,
// and copies the ONNX Runtime WASM artifacts in beside them.
// Run by `npm run fetch-model`, and by `prebuild` so a deployment can never
// silently ship a build whose cut-out button cannot work.
import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Pinned to a commit, not to `main`: `resolve/main` is a moving target, so
// two machines running this a month apart could ship different weights
// under identical filenames — and nothing downstream would notice.
// briaai/RMBG-1.4 @ 2025-07-06.
const REVISION = "2ceba5a5efaec153162aedea169f76caf9b46cf8";
const REPO = `https://huggingface.co/briaai/RMBG-1.4/resolve/${REVISION}`;
const OUT = "public/models/briaai/RMBG-1.4";

// [remote path, local path, minimum plausible bytes]
const FILES = [
  ["config.json", "config.json", 200],
  ["preprocessor_config.json", "preprocessor_config.json", 100],
  // fp16 weights under the name the loader asks for — see assets.ts.
  ["onnx/model_fp16.onnx", "onnx/model.onnx", 80_000_000],
  ["onnx/model_quantized.onnx", "onnx/model_quantized.onnx", 40_000_000],
];

// The ONNX Runtime binaries, copied out of node_modules rather than
// downloaded, so the bytes always match the onnxruntime-web version that
// @huggingface/transformers actually bundles. Without these served from
// this origin, transformers.js points the runtime at
// cdn.jsdelivr.net on first use — see ORT_WASM_BASE in
// src/lib/engine/matte/assets.ts for why that is not acceptable here.
//
// transformers.js names the asyncify pair on every browser but Safari, and
// the plain pair on Safari. The jsep pair is the name ort.bundle.min.mjs
// would ask for; the webgpu entry point transformers imports never does,
// but it is cheap insurance against a 404'd runtime if that ever changes.
const ORT_OUT = "public/models/ort";
const ORT_FILES = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

for (const [remote, local, minBytes] of FILES) {
  const target = join(OUT, local);
  if ((await sizeOf(target)) >= minBytes) {
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
  // Write to `.part` and rename only once the size check has passed. A
  // truncated download written straight to the target would be picked up
  // as complete by the next run — the size floor is BELOW the real size,
  // so anything landing between the two would never be re-fetched.
  const part = `${target}.part`;
  await writeFile(part, bytes);
  await rm(target, { force: true });
  await rename(part, target);
}

const require = createRequire(import.meta.url);
// Resolved through a subpath the package actually exports — its
// package.json is not in the exports map, so resolving that would throw.
const ortDist = dirname(require.resolve("onnxruntime-web/ort-wasm-simd-threaded.wasm"));
await mkdir(ORT_OUT, { recursive: true });

for (const name of ORT_FILES) {
  const from = join(ortDist, name);
  const to = join(ORT_OUT, name);
  const expected = await sizeOf(from);
  if (expected < 0) {
    throw new Error(`${name}: not found in ${ortDist} — is onnxruntime-web installed?`);
  }
  // Size, not mere existence: an onnxruntime-web upgrade must replace what
  // a previous run left behind, or the app serves a runtime that no longer
  // matches the bundled loader.
  if ((await sizeOf(to)) === expected) {
    console.log(`have  ort/${name}`);
    continue;
  }
  console.log(`copy  ort/${name}`);
  await copyFile(from, `${to}.part`);
  await rm(to, { force: true });
  await rename(`${to}.part`, to);
}

// The licence travels with the weights. RMBG-1.4 is free for
// non-commercial use only; commercial use needs an agreement with BRIA.
await writeFile(
  join(OUT, "LICENSE.txt"),
  [
    "RMBG-1.4 model weights (c) BRIA AI.",
    `Revision: ${REVISION}`,
    "Licence: bria-rmbg-1.4 — free for NON-COMMERCIAL use.",
    "Commercial use requires an agreement with BRIA.",
    "https://huggingface.co/briaai/RMBG-1.4",
    "",
  ].join("\n"),
);

console.log("model ready");
