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
| Model | RMBG-1.4. fp16 weights where WebGPU exists, q8 as the fallback — see the measurements below. |
| Weights | Self-hosted from this app's own origin. No third-party fetch at runtime. |
| Output | The cut-out replaces the row's source; format is forced to something alpha-capable. |
| Inference site | A dedicated matte worker, separate from the encode pool. |
| Licensing | Non-commercial use, which is what this app is. |

## Verified facts

- **Model size.** `model_quantized.onnx` is **44.4 MB**, `model_fp16.onnx`
  **88.2 MB**, `model.onnx` 176 MB.
- **Native input.** 1024×1024.
- **Licence.** `bria-rmbg-1.4` — free for non-commercial use under a
  Creative Commons licence; "Commercial use is subject to a commercial
  agreement with BRIA." Ship the licence text next to the weights.
- **Hosting — CORRECTED after implementation.** Cloudflare Pages does not
  meter bandwidth, but it caps a single static asset at **25 MiB**, and that
  limit cannot be raised. The 88 MB and 44 MB weights therefore **cannot be
  served from Pages at all**; an earlier draft of this spec recommended it on
  bandwidth grounds alone, which was wrong. GitHub Pages has a 100 GB/month
  soft bandwidth limit and a 1 GB site limit — at 85 MB per WebGPU visitor
  that is roughly 1,175 first-time visitors a month, and the weights plus the
  vendored runtime occupy a fifth of the site limit.

  The deployment options, for the owner to choose between:

  1. **Cloudflare R2 public bucket, or a `static.` subdomain backed by it**,
     serving `/models/` while Pages serves the app. Bandwidth stays unmetered
     and the files are still the owner's own — but they come from a second
     origin, so CORS must allow it and Editorial entry 01's "downloaded once
     from this site" needs rewording to stay true.
  2. **A host with no per-file cap** (GitHub Pages within its 1 GB site
     limit, or any static host or VPS).
  3. **Chunk the weights** into sub-25 MiB parts the loader reassembles.
     Most work, keeps everything on one origin.

  This is the only remaining decision that blocks a first deploy.

### Measured, not estimated

A throwaway spike (branch `spike/background-removal`) ran the real model in
a worker under this Vite setup, on a 1280×1709 photograph:

| Configuration | Download | Warm inference |
|---|---|---|
| WebGPU + fp16 | 85 MB | **0.57 s** |
| WebGPU + q8 | 43 MB | 5.9–7.9 s |
| WASM + q8 | 43 MB | 5.4 s |

Preprocessing costs 0.1–0.3 s and composition 0.1–0.25 s; both scale with
the source's size, while inference does not — the model always sees 1024².

Three findings that change the design:

1. **q8 is ~10× slower than fp16 on WebGPU, and no faster than WASM.** int8
   is not accelerated there, so the smaller file buys nothing but a wait.
   fp16 is what ships wherever WebGPU exists.
2. **q8 caps the mask at 254, not 255.** Fully opaque pixels come out
   fractionally transparent. The compose step must rescale the mask so its
   maximum is a true 255 — needed only on the fallback path, but cheap and
   unconditional.
3. **`dtype: "fp16"` did not resolve to the fp16 filename** with the bare
   config from the model repo: the loader asked for `model.onnx`, the dev
   server answered with `index.html`, and ONNX failed on protobuf parsing.
   The fetch script sidesteps this by saving each build under the name the
   loader actually requests, and the missing-model check must treat an HTML
   response as missing rather than trusting the status code.

Quality was verified by sampling: interior RGB in the cut-out is
byte-identical to the source, and only alpha differs.

### Verified again after implementation (2026-09-01)

The finished feature was exercised in Chrome against the real app, not the
spike:

- A 1280x1709 photograph with fur edges cut out cleanly; the row reported
  `1280x1709 -> 1280x1709`, so no dimension was lost.
- **Pixel identity holds end to end.** With the format set to PNG (lossless),
  three interior pixels of the downloaded output were byte-identical to the
  source, and their alpha came back a true **255** — the q8 build's 254 cap
  is absent on the fp16 path, as predicted.
- **Format substitution works and says so.** With FORMAT set to JPG the row
  read `cut out - output as WEBP (JPG has no transparency)` and the pane
  captions confirmed `WEBP`; switching to WebP dropped the explanatory
  clause, since nothing was substituted.
- **The transparent preview reads as transparent** — checkerboard behind the
  compressed pane only.
- **20 megapixels is fine.** A 5000x4000 source cut out in ~3.0s wall clock
  including the re-encode, dimensions preserved, no crash and no memory
  spike. The megapixel cap the risk section anticipated is not needed yet.
- **Reversible.** Restoring dropped the cut-out, flipped the control back to
  `Cut out background from ...`, and re-encoded from the original.
- The first-use notice fired once, naming ~85 MB and the WebGPU path.

Not re-measured after implementation: the **WASM fallback timing**. WebGPU
could not be disabled from this session, so the ~5s figure remains the
spike's measurement rather than the shipped code's.

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
  this origin. Detects WebGPU and loads the fp16 build; without it, loads
  the q8 build on WASM and accepts the slower path. It also runs
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

- **Mask normalisation.** Rescale the mask so its maximum is 255. The q8
  build tops out at 254, which would leave every "opaque" pixel very
  slightly transparent.
- **Feather.** Not a separate pass: upscaling the 1024x1024 mask to the
  source's dimensions is a bilinear resize, which already lands a soft
  alpha ramp across the boundary. Adding a blur on top of that would only
  eat detail the model got right.
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
- **First run.** A notice: the model is downloading, once, ~85 MB, and
  everything stays on the device. A second notice if the weights are missing
  from the deployment, naming the fetch script rather than failing silently.
- **Capability.** WebGPU is what varies; WASM is present in every browser
  that can run this app at all, so there is no third "cannot do it" state to
  design. A device without WebGPU is told, once, that it is on the slower
  path and what that costs.

## Assets and build

- `scripts/fetch-model.mjs` downloads BOTH builds — fp16 and q8 — plus the
  configs into `public/models/briaai/RMBG-1.4/`, which is **gitignored**.
  Committing 128 MB of binaries would sit in the repository's history
  permanently. Each visitor downloads exactly one of the two.
- The script saves each build under the filename the loader requests, per
  finding 3 above.
- The script runs on install/deploy; the build fails loudly if the weights
  are absent, so a deployment can never silently ship a broken button.
- `public/models/briaai/RMBG-1.4/LICENSE.txt` ships beside the weights.
- Editorial entry 01 gains one line: the model is downloaded from this site
  once, inference is local, images still never leave the browser.

## Testing

Unit, in this order:

1. `resolveOutputFormat` with `needsAlpha` — JPG becomes WebP, everything
   else is untouched.
2. `refine` as a pure function over pixel data: mask normalisation to a true
   255 maximum, mask upscaling, the feather, decontamination, and that RGB is
   unmodified away from the edge.
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

- **85 MB first-run download** (43 MB on the fallback path). Mitigated by
  being per-row and lazy, and by the browser cache. Cloudflare Pages removes
  the bandwidth question.
- **Memory.** Model plus a large decoded image is hundreds of megabytes. Cap
  matte requests by source megapixels and say so plainly above the cap
  rather than crashing the tab.
- **Speed.** 0.6 s per image on WebGPU, around 5 s on the WASM fallback,
  worse on phones. The per-row shape means the user chooses when to pay it.
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
