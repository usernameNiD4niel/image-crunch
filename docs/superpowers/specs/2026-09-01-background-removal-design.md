# Background removal — design

Date: 2026-09-01
Status: approved for planning

## What this is

A per-row action that removes an image's background in the browser, leaving
the subject on transparency. The cut-out becomes that row's input, so the
existing quality, resize and format controls still act on it and the row
still reports a real saving against the file the user dropped.

It is a portfolio-grade feature that has to actually work: shown to peers,
used personally, no account, no server, no cost to run.

## Decisions taken before this document

| Question | Decision |
|---|---|
| Shape | Per-row action, not a queue-wide setting. The model loads on first use, so anyone who never cuts out an image never pays for it. |
| Model | RMBG-1.4, quantized ONNX. |
| Weights | Self-hosted from this app's own origin. No third-party fetch at runtime. |
| Output | The cut-out replaces the row's source; format is forced to something alpha-capable. |
| Inference site | A dedicated matte worker, separate from the encode pool. |
| Licensing | Non-commercial use, which is what this app is. |

## Verified facts

- **Model size.** `model_quantized.onnx` is **44.4 MB** (`model_fp16.onnx`
  88.2 MB, `model.onnx` 176 MB). The quantized build is what ships.
- **Native input.** 1024×1024.
- **Licence.** `bria-rmbg-1.4` — free for non-commercial use under a
  Creative Commons licence; "Commercial use is subject to a commercial
  agreement with BRIA." Ship the licence text next to the weights.
- **Hosting.** Cloudflare Pages does not meter bandwidth on static assets at
  any tier. GitHub Pages has a 100 GB/month soft bandwidth limit and a 1 GB
  site limit — at 44.4 MB, roughly 2,250 first-time visitors a month.

Sources are listed at the end.

## Architecture

### The matte subsystem

New directory `src/lib/engine/matte/`, deliberately shaped like the existing
encode subsystem so there is one mental model for both:

- **`client.ts` — `MatteClient`.** Lazily spawns ONE worker on the first
  request and keeps it, because the model costs seconds to load and hundreds
  of megabytes to hold. Carries a generation counter and rejects superseded
  requests with `StaleResult`, exactly as `EncodeClient` does. Exposes
  `matte(id, file, source)`, `bumpGeneration()`, `dispose()`.
- **`worker.ts`.** Loads `transformers.js` with `env.allowRemoteModels =
  false` and `env.localModelPath = "/models/"`, so the only fetch is from
  this origin. Prefers the WebGPU backend, falls back to WASM. It also runs
  the refinement and returns the finished cut-out blob, because the pixel
  work below is full-resolution — twelve million pixels for a 4000×3000
  source — and doing it on the main thread would jank the UI the way
  inference itself would.
- **`refine.ts`.** A pure module, imported by the worker and unit-tested
  directly: upscale the mask to the source's dimensions, feather the edge by
  one pixel, decontaminate edge colour, and write the result as the alpha
  channel of the ORIGINAL pixels.

Why its own worker and not the encode pool: the pool has four workers, and
four copies of a 44 MB model is not a trade anyone would make. Special-casing
worker zero would break the pool's symmetry and let one inference starve
three encodes for seconds.

### Why quality is preserved

The model sees a 1024×1024 version of the image. The **mask** it returns is
upscaled back to the source's real dimensions and applied to the source's
own untouched pixels. The RGB data is never resampled by this feature — a
4000×3000 photo comes out 4000×3000, pixel-identical except for its new
alpha channel. Dimensions never shrink, and the compression that follows is
the same compression the app already does.

Edge treatment is the difference between a demo and something usable:

- **Feather.** One pixel of alpha falloff so the cut edge is not a staircase.
- **Decontamination.** Pixels on the boundary are a blend of subject and old
  background. Left alone they show as a dark or coloured halo once composited
  on a new background. Un-blending them toward the subject colour is what
  removes it.

## State and data flow

`QueueItem` gains:

```ts
cutout?: { blob: Blob; width: number; height: number };
matting?: boolean;   // orthogonal to `status`: a row can be re-encoding
                     // and having its background removed at the same time
```

New reducer actions: `matte-start`, `matte-done`, `matte-error`,
`matte-clear`. `matte-clear` restores the original source and re-encodes,
so the action is reversible.

Flow for one row:

1. User presses `✂`. `matte-start` sets `matting`.
2. `MatteClient.matte()` runs inference off the main thread.
3. The worker refines the mask and composes the cut-out blob at full
   resolution.
4. `matte-done` stores `cutout` and returns the row to `queued`.
5. That row alone re-encodes, from `item.cutout.blob` rather than `item.file`.

**The savings baseline does not move.** A row's percentage is always output
against the file the user dropped. A cut-out is a different image, but the
question the queue answers — "how much smaller is what I get than what I
gave you" — is unchanged.

A cut row can never report `kept`, because the original bytes are no longer
what the row is offering.

## Alpha-aware format

`resolveOutputFormat(sourceType, format, needsAlpha)`:

- `needsAlpha` and the resolution lands on JPG → **WebP** instead.
- PNG, WebP and ICO already carry alpha and pass through untouched.
- The row states the substitution in its own line:
  `cut out · output as WEBP (JPG has no transparency)`.

The JPEG white-fill in `encode.ts` stays for uncut rows and is unreachable
for cut ones, since a cut row never resolves to JPEG.

## UI

- **Row action.** A `✂` button in `QueueRow`'s actions, labelled
  `Cut out background from <name>`. While running the row reads
  `removing background…`; afterwards it reads `cut out` and the button
  offers `Restore background from <name>`.
- **Compare panel.** The compressed pane gets a checkerboard behind it, so
  transparency reads as transparency instead of as white.
- **First run.** A notice: the model is downloading, once, ~44 MB, and
  everything stays on the device. A second notice if the weights are missing
  from the deployment, naming the fetch script rather than failing silently.
- **Capability.** Devices that can run neither WebGPU nor WASM threads get
  the button disabled with a plain explanation, not a broken action.

## Assets and build

- `scripts/fetch-model.mjs` downloads the quantized weights and config into
  `public/models/rmbg-1.4/`, which is **gitignored**. Committing 44 MB of
  binaries would sit in the repository's history permanently.
- The script runs on install/deploy; the build fails loudly if the weights
  are absent, so a deployment can never silently ship a broken button.
- `public/models/rmbg-1.4/LICENSE.txt` ships beside the weights.
- Editorial entry 01 gains one line: the model is downloaded from this site
  once, inference is local, images still never leave the browser.

## Testing

Unit, in this order:

1. `resolveOutputFormat` with `needsAlpha` — JPG becomes WebP, everything
   else is untouched.
2. `refine` as a pure function over pixel data: mask upscaling, the feather,
   decontamination, and that RGB is unmodified away from the edge.
3. The four new reducer actions, including that `matte-clear` restores the
   original source.
4. `MatteClient` staleness against a mocked worker, mirroring
   `client.test.ts`: a superseded request rejects with `StaleResult` and
   never resolves a newer one.

In a real browser, because jsdom has no canvas, no WebGPU and no WASM
threads: an actual cut-out on a photograph with hair and on a hard-edged
logo, the halo check against a dark background, the WebGPU→WASM fallback,
and peak memory on a large source.

## Risks

- **44 MB first-run download.** Mitigated by being per-row and lazy, and by
  the browser cache. Cloudflare Pages removes the bandwidth question.
- **Memory.** Model plus a large decoded image is hundreds of megabytes. Cap
  matte requests by source megapixels and say so plainly above the cap
  rather than crashing the tab.
- **Speed.** One to three seconds per image on a laptop, worse on phones.
  The per-row shape means the user chooses when to pay it.
- **Licence.** Non-commercial only. The model sits behind one `MatteClient`
  interface, so swapping to U²-Net (Apache-2.0) later is a contained change.
- **Safari.** WASM threading support is the weakest here; the capability
  check must degrade honestly.

## Out of scope

Manual mask touch-up, subject selection among several subjects, batch
"cut out everything", and upscaling. None are needed for the feature to be
real, and each is its own project.

## Sources

- [RMBG-1.4 model card and licence](https://huggingface.co/briaai/RMBG-1.4)
- [RMBG-1.4 ONNX file sizes](https://huggingface.co/briaai/RMBG-1.4/tree/main/onnx)
- [Cloudflare Pages free tier limits](https://www.devtoolreviews.com/reviews/cloudflare-pages-pricing-bandwidth-limits-2026)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
