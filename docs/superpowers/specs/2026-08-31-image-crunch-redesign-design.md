# Image Crunch — Full Redesign

**Date:** 2026-08-31
**Status:** Approved design, pending implementation plan
**Author:** Daniel Rey (with Claude)

## Purpose

Rebuild Image Crunch's interface and processing engine. The app works but looks
generated: stock shadcn slate tokens, a gradient-text hero, three stacked cards.
The redesign commits to a Swiss editorial aesthetic, adds a batch queue, and
replaces the main-thread canvas pipeline with a worker-based one.

Authentication and the Supabase backend were removed in a prior change. The app
is client-only: no accounts, no uploads, no server. Nothing in this redesign
reintroduces a backend.

## Constraints

- Client-side only. Every byte is processed in the browser; no network calls
  beyond loading the app itself.
- React 18.3 stays. Verified: `@base-ui/react@1.7.0` declares
  `react: ^17 || ^18 || ^19`, so no React major bump is required.
- Free and account-free. The only limits are the ones the browser can actually
  honor: 35MB per file and 30 files per queue (§3), both stated up front rather
  than discovered on failure.

## 1. Foundation

### Color

Monochrome plus one signal color, expressed in oklch under Tailwind v4's
`@theme inline` (not `@layer base` / `hsl(var(--x))`, which is the v3 pattern
this project currently uses).

| Token | Value | Role |
|---|---|---|
| `--paper` | `oklch(0.985 0.004 90)` | page ground — warm, never pure white |
| `--paper-2` | `oklch(0.962 0.005 90)` | inset wells: image field, input tracks |
| `--ink` | `oklch(0.145 0 0)` | all type |
| `--ink-60` | `--ink` @ 60% | secondary copy, labels |
| `--ink-38` | `--ink` @ 38% | tertiary, disabled |
| `--rule` | `--ink` @ 12% | hairlines — the only "border" |
| `--signal` | `oklch(0.62 0.24 27)` | live values + primary action ONLY |
| `--signal-ink` | `oklch(1 0 0)` | type on signal fill |
| `--radius` | `0` | square, everywhere |

**Signal red is never decorative.** It marks exactly three things: the live
savings figure, the filled portion of the quality track, and the primary
download action. A red icon or red heading breaks the system.

### Type

Archivo Expanded 800 (display) / Archivo 400·500 (body, labels) / JetBrains Mono
500 (all data). Self-hosted via `@fontsource` — no CDN request, no layout shift,
works offline.

| Role | Size | Face |
|---|---|---|
| display | `clamp(3.5rem, 11vw, 9.5rem)`, `-0.04em`, `0.86` line | Archivo Expanded 800 |
| h2 | `2.25rem`, `-0.02em` | Archivo 500 |
| body | `1.0625rem / 1.6`, max 62ch | Archivo 400 |
| label | `0.6875rem`, `0.14em`, uppercase | Archivo 500 |
| data | `0.8125–1.25rem` | JetBrains Mono 500 |

Every number in the app — sizes, percentages, dimensions, quality, queue indices
— is mono with `font-variant-numeric: tabular-nums`. This is what stops values
from jittering as they update, and is most of why the app reads as an instrument
rather than a template.

### Layout, rules, motion

- 12-column editorial grid, `max-width: 1440px`, 24px gutters (16px < 768px).
- Content is deliberately not always centred: the display statement sits hard
  left against the margin; data columns align right.
- **No cards.** No shadow, no border-radius. Sections separate with 1px `--rule`
  hairlines running the full grid width. Inset areas use `--paper-2` plus a
  hairline, never elevation.
- Motion: 140ms `cubic-bezier(0.2, 0, 0, 1)` on state change. No scroll
  animations, no parallax. Numbers cross-fade, never count up. Everything
  instant under `prefers-reduced-motion`.
- Focus: 2px `--signal` outline, 2px offset, square, `:focus-visible` only.

## 2. Page architecture

Single route. `/` renders `Index`, `*` renders `NotFound`. Four zones, one scroll.

```
00 MASTHEAD    fixed, 48px, hairline bottom. Live status line.
01 STATEMENT   100dvh − masthead. Display type hard left; meta column right.
02 THE TOOL    #tool — scroll target for START and for global drop.
03 EDITORIAL   numbered entries, two-column, hairline-separated.
04 COLOPHON    mono, small.
```

**The masthead earns its fixity.** It is the live status line, not decoration:

- idle — `IDLE · 0 FILES`
- working — `WORKING · 3 OF 7`
- done — `7 FILES · 3.5 MB → 582 KB · −83.4%` with the percentage in signal red,
  plus a `↓ ALL` action.

**Drop anywhere, at any scroll position.** The window is a global drop target.
Dropping a file while reading the statement scrolls to `#tool` and starts work.
This is what keeps the landing zone from being an obstacle between arriving and
using.

**The statement is type, not image.** `SMALLER FILES. SAME PICTURE.` in Archivo
Expanded 800, hard left, ragged right. No illustration, no gradient, no
screenshot. Uploaded images supply all the color the page ever has — which is
why the palette is monochrome plus one signal.

**Editorial sections:** 01 Nothing leaves your browser · 02 Which format should
I use (JPG/PNG/WebP compared as a mono data table) · 03 What quality actually
changes.

**Responsive:** below 768px the grid collapses to 4 columns, display drops to
`clamp(2.75rem, 14vw, 4rem)`, the meta column moves beneath the CTA, and the
masthead status truncates to the percentage alone.

## 3. The tool

One layout, four states — the frame never moves, content fills in. Built on
current shadcn primitives: `Empty` (idle), `Item` (queue rows), `Field` (each
control), `ButtonGroup` (format selector), `Spinner` (in-flight).

```
QUEUE                                          7 FILES   [ + ]
──────────────────────────────────────────────────────────────
01  hero.png        3840×2160 → 1920×1080
    2.4 MB → 310 KB                       −87.1%    ⌄  ↓
──────────────────────────────────────────────────────────────
02  bg.webp         ▓▓▓▓▓▓▓▓░░░░░░  encoding…       ⌄  ↓
──────────────────────────────────────────────────────────────
03  logo.svg        vector — passthrough    —       ⌄  ↓
──────────────────────────────────────────────────────────────
TOTAL               3.5 MB → 582 KB       −83.4%

CONTROLS (sticky above viewport bottom while queue in view)
QUALITY  85  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░   RESIZE  ● NONE ○ 2048 ○ 1280
FORMAT   [ KEEP ][ JPG ][ PNG ][ WEBP ]        [ ↓ ALL · ZIP ]
```

### Decisions

**Settings are global, not per-file.** One quality, one resize, one format across
the queue. Per-file overrides would double the state model to serve a case most
users don't have. The per-row `↓` still downloads a single file, so anyone
needing different settings for one image can run it alone.

**Row expansion (`⌄`)** reveals before/after for that file at matched scale, split
by a draggable divider, with hold-to-see-original on touch. One row open at a
time; collapsed by default so the queue stays scannable.

**Debounce at 200ms**, visible rows first. Settings changes cancel in-flight work
rather than stacking it (see generation counter, §4).

**Download-all produces a real `.zip` via `fflate`** (~8KB gzipped, no wasm).
Firing N sequential `<a download>` clicks is throttled or blocked by browsers,
and per-file-only downloads would undercut the reason batch exists.

**Queue cap: 30 files.** Not a technical limit — a promise the browser can keep.
Beyond that, memory pressure from decoded bitmaps is genuinely risky on mobile.
Files past the cap are rejected with a clear message, never accepted and then
failed.

### Honest states

These replace behavior that currently misreports what the app did:

- **SVG and ICO** are accepted but marked `passthrough — no gain` and downloaded
  byte-identical. Rasterizing a vector to "compress" it is a downgrade disguised
  as a feature.
- **GIF is removed from output formats.** Canvas has no GIF encoder; the current
  build ships PNG bytes under a `.gif` name. `KEEP` (don't change format)
  becomes the default option.
- **Files that grow** show `+4.2% — kept original` and download the original.
- **Resize is explicit.** The current silent 1920px clamp becomes a visible
  `RESIZE` control, and every row shows real input → output dimensions.
- **The size limit is stated correctly.** Current copy says 10MB; the code
  allows 35MB.

### Accessibility

Queue is a `ul` of `Item`s. `aria-live="polite"` on the total line only — per-row
live regions would be a screen-reader firehose. The compare divider is a real
slider with arrow-key support. Every control keyboard-reachable with the 2px
signal focus ring.

## 4. Processing engine

New module `src/lib/engine/`, replacing `src/lib/imageUtils.ts`:

```
engine/
  types.ts    QueueItem, EncodeSettings, EncodeResult, EngineMessage
  plan.ts     PURE: targetDimensions(), resolveOutputFormat(), isPassthrough(),
              savings(), outputFilename()      ← unit-testable, no DOM
  encode.ts   one pass: decode → resize → encode
  worker.ts   message loop, generation guard, bitmap.close()
  client.ts   worker pool + fallback, cancellation, blob-URL registry
  useQueue.ts reducer hook: add / remove / reset / re-encode-all
```

**One pass, not two.** `decode → resize → encode(targetFormat, quality)` happens
in a single function. This structurally eliminates the current bug where
`convertImageFormat` re-read the original file at full size, discarding both the
resize and the quality pass — there is no second entry point left to disagree
with the first.

**Worker pool of `min(3, navigator.hardwareConcurrency)`.** Each worker handles
one file at a time: `createImageBitmap` → `OffscreenCanvas` → `convertToBlob`.
Feature-detected; browsers without `OffscreenCanvas.prototype.convertToBlob` use
a main-thread fallback driven by the same pure `plan.ts` logic.

**Cancellation by generation counter.** Each settings change increments a
generation; results arriving with a stale generation are discarded rather than
rendered. Dragging the slider across a 12-file queue yields one final render.

**Memory discipline** — the current code's real failure at batch scale:
`bitmap.close()` immediately after encode; decoded bitmaps never retained; every
`createObjectURL` registered centrally and revoked on row removal and unmount.
No `createObjectURL` inside render, ever. (Today `ImageProcessor.tsx:172` leaks
one blob URL per render, and the slider re-renders constantly.)

## 5. Stack migration

Current: Tailwind 3.4, `@radix-ui/react-*` ×25, shadcn circa Feb 2025,
`forwardRef` components, React 18.3.

Target: Tailwind 4.x, `@base-ui/react`, shadcn CLI v4, `data-slot` components,
React 18.3 (unchanged).

`data-slot` matters here beyond currency: it allows styling component internals
from CSS without wrapper divs, which is what makes hairline-and-square styling
clean rather than a pile of overrides.

**Deletions:** ~48 unused `ui/*` files, `tailwind.config.ts` (v4 needs no
config), `src/lib/imageUtils.ts`, `src/App.css`.

## 6. Order of work

Each phase ends with a green build, so any phase can be a stopping point.

```
0  branch + baseline build
1  Tailwind v3→v4 codemod, verify visual parity
2  shadcn re-init --base base-ui, @theme oklch tokens,
   @fontsource Archivo + JetBrains Mono, delete dead ui/*
3  engine: plan.ts TDD-first, then worker, then useQueue
4  components: masthead, statement, queue, controls, compare
5  editorial copy, meta/OG tags, favicon
6  frontend-design polish pass + a11y/Lighthouse audit
```

Phases 1 and 2 stack two migrations; they are sequenced, never simultaneous, so
Tailwind v4 builds green before Base UI is introduced and any failure is
attributable to one change.

## 7. Testing

This repo currently has **no test runner** — no `test` script, no vitest, no
testing-library. Phase 3 begins by adding **Vitest + jsdom**.

Real unit tests, all against pure `plan.ts`:

- dimension math, including aspect-ratio preservation and no-upscale
- `resolveOutputFormat` — `KEEP` behavior, passthrough types, GIF exclusion
- the larger-than-original case returning the original
- savings arithmetic, including the 0-byte and identical-size edges
- `outputFilename` collision handling for zip entries (two `logo.png` inputs)

Canvas encoding gets a thin integration check, not unit tests — mocking canvas
produces tests that pass while the feature is broken.

## 8. Out of scope

- **wasm encoders** (`jSquash`/mozjpeg/oxipng) would beat `canvas.toBlob` on
  quality-per-byte, but cost 1MB+ of wasm. Worth revisiting once the redesign
  ships.
- Per-file setting overrides.
- Dark theme. The design commits to paper-white; a dark ground would require
  every decision to be made twice.
- Any account, sync, or history feature. The app stores nothing.
