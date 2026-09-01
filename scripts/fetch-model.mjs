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
