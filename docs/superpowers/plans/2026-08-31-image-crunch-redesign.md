# Image Crunch Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Image Crunch as a Swiss-editorial, batch-capable image compressor running on a worker-based encoding engine, on a modern Tailwind v4 + Base UI foundation.

**Architecture:** A single-route React SPA with no backend. Pure planning logic (`plan.ts`) is unit-tested and drives two interchangeable execution paths — a worker pool using `OffscreenCanvas`, and a main-thread fallback. The UI is a fixed status masthead, a full-height type statement, a file queue with global settings, and editorial sections below.

**Tech Stack:** React 18.3, TypeScript 5.5, Vite 5, Tailwind CSS 4, Base UI 1.7 (via shadcn CLI v4), fflate 0.8, Vitest 4 + jsdom 30, @fontsource-variable (Archivo, JetBrains Mono).

**Spec:** `docs/superpowers/specs/2026-08-31-image-crunch-redesign-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Client-only.** No network calls beyond loading the app. No backend, no accounts, no analytics, no storage of user files.
- **React stays at 18.3.** Do not upgrade to 19. `@base-ui/react@1.7.0` declares `react: ^17 || ^18 || ^19` — verified.
- **Limits:** 35 MB per file (`MAX_FILE_BYTES`), 30 files per queue (`MAX_QUEUE`). Both stated in UI copy up front.
- **Color tokens are oklch, in `@theme inline`.** `--paper oklch(0.985 0.004 90)`, `--paper-2 oklch(0.962 0.005 90)`, `--ink oklch(0.145 0 0)`, `--signal oklch(0.62 0.24 27)`, `--signal-ink oklch(1 0 0)`, `--rule` = ink @ 12%.
- **`--signal` marks exactly three things:** the live savings figure, the filled part of the quality track, the primary download action. Nowhere else.
- **`--radius: 0`.** No `rounded-*` classes anywhere. No `shadow-*`. Separation is 1px `--rule` hairlines only.
- **All numbers are JetBrains Mono with `font-variant-numeric: tabular-nums`.** Sizes, percentages, dimensions, quality, queue indices.
- **Motion:** 140ms `cubic-bezier(0.2, 0, 0, 1)` on state change only. No scroll or entrance animation. Everything instant under `prefers-reduced-motion: reduce`.
- **Focus:** 2px `--signal` outline, 2px offset, square, `:focus-visible` only.
- **GIF is not an output format.** Options are `KEEP`, JPG, PNG, WebP.
- **SVG and ICO are passthrough** — downloaded byte-identical, labelled `passthrough — no gain`.
- **Never call `URL.createObjectURL` during render.**
- **Verification commands** used throughout: `npm test`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`.

---

## File Structure

**Created:**

```
src/lib/engine/types.ts        Shared types + constants. No logic.
src/lib/engine/plan.ts         PURE decision logic. No DOM. Fully unit-tested.
src/lib/engine/plan.test.ts    Tests for plan.ts.
src/lib/engine/encode.ts       decode → resize → encode, one pass. Runs in worker or main thread.
src/lib/engine/worker.ts       Web Worker entry: message loop + generation guard.
src/lib/engine/client.ts       Worker pool, fallback, cancellation, blob-URL registry.
src/lib/engine/zip.ts          fflate bundling + filename collision handling.
src/hooks/useQueue.ts          Reducer hook owning queue state.
src/hooks/useQueue.test.ts     Reducer tests.
src/components/Masthead.tsx    Fixed status bar. Live status line.
src/components/Statement.tsx   Full-height display type + CTA + meta column.
src/components/Queue.tsx       Empty state, rows, totals.
src/components/QueueRow.tsx    One file: name, dimensions, sizes, savings, expand, download.
src/components/Compare.tsx     Before/after divider inside an expanded row.
src/components/Controls.tsx    Sticky quality / resize / format / download-all bar.
src/components/Editorial.tsx   Numbered editorial entries + colophon.
src/components/DropZone.tsx    Global window-level drop target.
```

**Deleted:** `tailwind.config.ts`, `postcss.config.js`, `src/App.css`, `src/lib/imageUtils.ts`, `src/components/ImageUploader.tsx`, `src/components/ImageProcessor.tsx`, ~48 unused `src/components/ui/*` files.

**Modified:** `src/index.css` (rewritten), `src/pages/Index.tsx` (rewritten), `vite.config.ts`, `index.html`, `package.json`, `components.json`.

---

## Task 1: Branch and test infrastructure

This repo has no test runner at all. Everything downstream depends on one existing.

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json`
- Create: `src/lib/engine/plan.test.ts` (smoke test only, replaced in Task 5)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` command running Vitest in jsdom.

- [ ] **Step 1: Create the working branch**

```bash
git checkout -b redesign
git status --short   # expect clean
```

- [ ] **Step 2: Record the baseline build**

```bash
npm run build
```

Expected: succeeds. If it does not, stop — fix the baseline before changing anything, or you cannot attribute later failures.

- [ ] **Step 3: Install test dependencies**

```bash
npm install -D vitest@^4 jsdom@^30 @testing-library/react@^16 @testing-library/jest-dom@^6
```

- [ ] **Step 4: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Configure Vitest in `vite.config.ts`**

Add the triple-slash reference on line 1 and the `test` block. Keep the existing `plugins` and `resolve` config exactly as they are:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
// ...existing imports unchanged...

export default defineConfig(({ mode }) => ({
  // ...existing server/plugins/resolve config unchanged...
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
```

- [ ] **Step 6: Write a smoke test that fails**

Create `src/lib/engine/plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("test infrastructure", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run the tests**

```bash
npm test
```

Expected: PASS, 1 test. If Vitest cannot resolve `@/` imports later, the `resolve.alias` in `vite.config.ts` already handles it — Vitest reads the same config.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/lib/engine/plan.test.ts
git commit -m "test: add vitest + jsdom test infrastructure"
```

---

## Task 2: Tailwind v3 → v4 migration

Visual parity only. The app should look exactly as it does now when this task ends — ugly, but working on the new foundation. Design tokens come in Task 3.

**Files:**
- Modify: `src/index.css`, `vite.config.ts`, `package.json`
- Delete: `tailwind.config.ts`, `postcss.config.js`

**Interfaces:**
- Consumes: Task 1's green build.
- Produces: Tailwind v4 build pipeline via `@tailwindcss/vite`.

- [ ] **Step 1: Run the official codemod**

```bash
npx @tailwindcss/upgrade@latest
```

This rewrites `index.css`, converts `tailwind.config.ts` content into CSS, and updates `package.json`. Review everything it changed before continuing:

```bash
git diff --stat
```

- [ ] **Step 2: Install the Vite plugin, remove PostCSS scaffolding**

```bash
npm install @tailwindcss/vite@^4
npm uninstall autoprefixer postcss tailwindcss-animate
```

`tailwindcss-animate` is v3-era. Its only consumer is the accordion keyframes, which nothing in the redesign uses. If the codemod left `@plugin "tailwindcss-animate";` in `index.css`, delete that line.

- [ ] **Step 3: Wire the plugin in `vite.config.ts`**

```ts
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), mode === "development" && componentTagger()].filter(Boolean),
  // ...rest unchanged...
}));
```

- [ ] **Step 4: Delete the dead config files**

```bash
git rm -f tailwind.config.ts postcss.config.js
```

Tailwind v4 needs neither: content detection is automatic and PostCSS is handled by the Vite plugin.

- [ ] **Step 5: Verify the build and the type check**

```bash
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

Expected: both succeed.

- [ ] **Step 6: Verify visually**

```bash
npm run dev
```

Open the app, upload any image, move the quality slider, download. Expected: identical to before the migration. Any visual break here is a Tailwind issue, not a design issue — fix it now, while that attribution is still unambiguous.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "build: migrate tailwind v3 to v4"
```

---

## Task 3: Design tokens and typography

**Files:**
- Modify: `src/index.css` (rewrite the theme layer)
- Modify: `package.json`
- Delete: `src/App.css`

**Interfaces:**
- Consumes: Task 2's Tailwind v4 pipeline.
- Produces: CSS custom properties `--color-paper`, `--color-paper-2`, `--color-ink`, `--color-signal`, `--color-signal-ink`, `--color-rule`; font families `--font-display`, `--font-sans`, `--font-mono`. Tailwind generates `bg-paper`, `text-ink`, `border-rule`, `font-mono` etc. from these automatically.

- [ ] **Step 1: Install self-hosted fonts**

```bash
npm install @fontsource-variable/archivo@^5 @fontsource-variable/jetbrains-mono@^5
```

- [ ] **Step 2: Confirm which CSS entry points the packages expose**

```bash
ls node_modules/@fontsource-variable/archivo/
```

Archivo's variable font carries both weight and width axes. Fontsource ships the width axis as a separate stylesheet when present. Expected: `index.css` and, if the width axis is packaged, `wdth.css`. **Use whichever files actually exist** — if `wdth.css` is absent, import `index.css` and reach Expanded via `font-stretch`/`font-variation-settings` instead. Do not guess; check the directory.

- [ ] **Step 3: Rewrite `src/index.css`**

Replace the whole file:

```css
@import "tailwindcss";
@import "@fontsource-variable/archivo/index.css";
@import "@fontsource-variable/jetbrains-mono/index.css";

:root {
  --paper: oklch(0.985 0.004 90);
  --paper-2: oklch(0.962 0.005 90);
  --ink: oklch(0.145 0 0);
  --ink-60: oklch(0.145 0 0 / 60%);
  --ink-38: oklch(0.145 0 0 / 38%);
  --rule: oklch(0.145 0 0 / 12%);
  --signal: oklch(0.62 0.24 27);
  --signal-ink: oklch(1 0 0);
  --ease: cubic-bezier(0.2, 0, 0, 1);
}

@theme inline {
  --color-paper: var(--paper);
  --color-paper-2: var(--paper-2);
  --color-ink: var(--ink);
  --color-ink-60: var(--ink-60);
  --color-ink-38: var(--ink-38);
  --color-rule: var(--rule);
  --color-signal: var(--signal);
  --color-signal-ink: var(--signal-ink);

  --font-sans: "Archivo Variable", system-ui, sans-serif;
  --font-display: "Archivo Variable", system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;

  --radius: 0px;
}

@layer base {
  * {
    border-color: var(--rule);
  }

  body {
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: 1.0625rem;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  /* Every number in the app. */
  .data {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .display {
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: 125%;
    letter-spacing: -0.04em;
    line-height: 0.86;
    font-size: clamp(3.5rem, 11vw, 9.5rem);
  }

  @media (max-width: 767px) {
    .display {
      font-size: clamp(2.75rem, 14vw, 4rem);
    }
  }

  .label {
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-weight: 500;
  }

  :focus-visible {
    outline: 2px solid var(--signal);
    outline-offset: 2px;
    border-radius: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
}
```

- [ ] **Step 4: Remove the dead stylesheet**

```bash
git rm -f src/App.css
grep -rn "App.css" src/   # expect no results
```

- [ ] **Step 5: Verify the tokens resolve**

```bash
npm run dev
```

In DevTools, inspect `body`. Expected: background computes to the warm paper oklch value, not white; body font is Archivo. Existing components will look wrong — they still use `bg-background`/`bg-card` class names that no longer exist. That is expected and is fixed in Task 4.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add swiss editorial design tokens and self-hosted fonts"
```

---

## Task 4: shadcn re-init onto Base UI, prune dead components

The riskiest task. Do it in the order given — the CLI first, dependency removal last, so a failure has one cause.

**Files:**
- Modify: `components.json`, `package.json`
- Create: `src/components/ui/*` (regenerated: slider, select, tooltip, toast/sonner, field, item, empty, button, button-group, spinner)
- Delete: ~48 unused `src/components/ui/*`

**Interfaces:**
- Consumes: Task 3's tokens.
- Produces: Base UI-backed primitives importable from `@/components/ui/*`.

- [ ] **Step 1: Inventory what is actually imported**

```bash
grep -rho "@/components/ui/[a-z-]*" src --include="*.tsx" | sort -u
```

Record this list. Anything not on it, and not in the redesign's needs (field, item, empty, button-group, spinner), gets deleted in Step 6.

- [ ] **Step 2: Preview the re-init without writing**

```bash
npx shadcn@latest init --base base-ui --dry-run
```

Read the output. It will rewrite `components.json` and may touch `index.css`. **If it proposes overwriting the `@theme inline` block from Task 3, decline that file and merge its additions by hand** — the tokens are the design, and regenerating them loses the work.

- [ ] **Step 3: Run the re-init**

```bash
npx shadcn@latest init --base base-ui
```

- [ ] **Step 4: Check the current API before adding components**

```bash
npx shadcn@latest docs slider
npx shadcn@latest docs field
npx shadcn@latest docs item
```

Base UI's component APIs differ from Radix's (compound parts, different prop names). Read the generated source rather than assuming Radix shapes — this is the single most likely place to waste an hour.

- [ ] **Step 5: Add the components the redesign needs**

```bash
npx shadcn@latest add button slider select tooltip sonner field item empty button-group spinner
```

- [ ] **Step 6: Delete every unused ui file**

```bash
cd src/components/ui
ls *.tsx | grep -vE "^(button|slider|select|tooltip|sonner|field|item|empty|button-group|spinner)\.tsx$" | xargs git rm -f
cd -
grep -rn "@/components/ui/" src --include="*.tsx" | grep -vE "(button|slider|select|tooltip|sonner|field|item|empty|button-group|spinner)"
```

The final grep must return nothing. If it returns a hit, that file imports something you just deleted — either restore that one component or rewrite the importing file.

- [ ] **Step 7: Remove the Radix dependencies**

```bash
npm uninstall $(node -e "console.log(Object.keys(require('./package.json').dependencies).filter(d=>d.startsWith('@radix-ui/')).join(' '))")
npm uninstall cmdk vaul embla-carousel-react react-day-picker recharts input-otp react-resizable-panels next-themes date-fns
```

The second line removes libraries that only existed to serve the deleted `ui/*` files. Verify each is genuinely unreferenced first:

```bash
for p in cmdk vaul embla-carousel-react react-day-picker recharts input-otp react-resizable-panels next-themes date-fns; do echo -n "$p: "; grep -rl "$p" src --include="*.tsx" --include="*.ts" | wc -l; done
```

Expected: all zero. Anything non-zero, keep that package.

- [ ] **Step 8: Fix remaining compile errors**

`ImageUploader.tsx` and `ImageProcessor.tsx` still import `card`, `alert`, `badge`, `separator`, `label`. They are deleted in Task 14, but the build must stay green now. Replace those imports with plain elements — a `<div className="border border-rule p-6">` for cards, `<p className="text-signal">` for alerts. Do not restore the deleted components.

- [ ] **Step 9: Verify**

```bash
npx tsc --noEmit -p tsconfig.app.json
npm test
npm run build
```

Expected: all three pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "build: migrate shadcn to base ui, prune unused primitives"
```

---

## Task 5: Pure planning logic (TDD)

Everything in this task is a pure function. No DOM, no canvas, no async. This is where correctness lives.

**Files:**
- Create: `src/lib/engine/types.ts`
- Create: `src/lib/engine/plan.ts`
- Modify: `src/lib/engine/plan.test.ts` (replace the smoke test)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type OutputFormat = "keep" | "image/jpeg" | "image/png" | "image/webp"`
  - `type ResizePreset = "none" | 2048 | 1280`
  - `interface EncodeSettings { quality: number; resize: ResizePreset; format: OutputFormat }`
  - `interface SourceInfo { name: string; type: string; size: number; width: number; height: number }`
  - `isPassthrough(type: string): boolean`
  - `resolveOutputFormat(sourceType: string, format: OutputFormat): string`
  - `targetDimensions(width: number, height: number, resize: ResizePreset): { width: number; height: number }`
  - `savingsPercent(originalBytes: number, outputBytes: number): number`
  - `shouldKeepOriginal(originalBytes: number, outputBytes: number): boolean`
  - `outputFilename(sourceName: string, mime: string, taken: Set<string>): string`
  - `formatBytes(bytes: number): string`
  - `MAX_FILE_BYTES`, `MAX_QUEUE`, `PASSTHROUGH_TYPES`, `ACCEPTED_TYPES`

- [ ] **Step 1: Write `types.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing tests**

Replace `src/lib/engine/plan.test.ts` entirely:

```ts
import { describe, it, expect } from "vitest";
import {
  isPassthrough,
  resolveOutputFormat,
  targetDimensions,
  savingsPercent,
  shouldKeepOriginal,
  outputFilename,
  formatBytes,
} from "./plan";

describe("isPassthrough", () => {
  it("treats vector and icon formats as passthrough", () => {
    expect(isPassthrough("image/svg+xml")).toBe(true);
    expect(isPassthrough("image/x-icon")).toBe(true);
  });

  it("treats raster formats as encodable", () => {
    expect(isPassthrough("image/png")).toBe(false);
    expect(isPassthrough("image/jpeg")).toBe(false);
    expect(isPassthrough("image/webp")).toBe(false);
  });
});

describe("resolveOutputFormat", () => {
  it("keeps the source type when format is keep", () => {
    expect(resolveOutputFormat("image/png", "keep")).toBe("image/png");
  });

  it("returns the requested type when converting", () => {
    expect(resolveOutputFormat("image/png", "image/webp")).toBe("image/webp");
  });

  it("never converts a passthrough type, even when asked", () => {
    expect(resolveOutputFormat("image/svg+xml", "image/jpeg")).toBe("image/svg+xml");
  });

  it("normalises the legacy image/jpg source type to image/jpeg", () => {
    expect(resolveOutputFormat("image/jpg", "keep")).toBe("image/jpeg");
  });

  it("maps a GIF source to PNG under keep, since canvas cannot encode GIF", () => {
    expect(resolveOutputFormat("image/gif", "keep")).toBe("image/png");
  });
});

describe("targetDimensions", () => {
  it("returns the source size when resize is none", () => {
    expect(targetDimensions(3840, 2160, "none")).toEqual({ width: 3840, height: 2160 });
  });

  it("clamps the long edge and preserves aspect ratio", () => {
    expect(targetDimensions(3840, 2160, 2048)).toEqual({ width: 2048, height: 1152 });
  });

  it("clamps by height when the image is portrait", () => {
    expect(targetDimensions(2160, 3840, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it("never upscales a smaller image", () => {
    expect(targetDimensions(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });

  it("rounds to whole pixels and never returns zero", () => {
    expect(targetDimensions(1000, 3, 1280)).toEqual({ width: 1000, height: 3 });
    const r = targetDimensions(4000, 5, 1280);
    expect(Number.isInteger(r.width)).toBe(true);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });
});

describe("savingsPercent", () => {
  it("reports a positive percentage when the file shrinks", () => {
    expect(savingsPercent(1000, 250)).toBeCloseTo(75, 5);
  });

  it("reports a negative percentage when the file grows", () => {
    expect(savingsPercent(1000, 1042)).toBeCloseTo(-4.2, 5);
  });

  it("reports zero for an identical size", () => {
    expect(savingsPercent(1000, 1000)).toBe(0);
  });

  it("reports zero rather than dividing by zero", () => {
    expect(savingsPercent(0, 0)).toBe(0);
  });
});

describe("shouldKeepOriginal", () => {
  it("keeps the original when the encode is larger", () => {
    expect(shouldKeepOriginal(1000, 1042)).toBe(true);
  });

  it("keeps the original when the encode is identical", () => {
    expect(shouldKeepOriginal(1000, 1000)).toBe(true);
  });

  it("uses the encode when it is smaller", () => {
    expect(shouldKeepOriginal(1000, 999)).toBe(false);
  });
});

describe("outputFilename", () => {
  it("swaps the extension to match the output mime", () => {
    expect(outputFilename("hero.png", "image/webp", new Set())).toBe("hero.webp");
  });

  it("preserves a name that has no extension", () => {
    expect(outputFilename("hero", "image/jpeg", new Set())).toBe("hero.jpg");
  });

  it("preserves dots inside the base name", () => {
    expect(outputFilename("logo.v2.png", "image/png", new Set())).toBe("logo.v2.png");
  });

  it("disambiguates collisions with a numeric suffix", () => {
    const taken = new Set(["logo.png"]);
    expect(outputFilename("logo.png", "image/png", taken)).toBe("logo-2.png");
  });

  it("keeps incrementing past a second collision", () => {
    const taken = new Set(["logo.png", "logo-2.png"]);
    expect(outputFilename("logo.png", "image/png", taken)).toBe("logo-3.png");
  });
});

describe("formatBytes", () => {
  it("formats zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats kilobytes without decimals", () => {
    expect(formatBytes(310 * 1024)).toBe("310 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

```bash
npm test
```

Expected: FAIL — `Failed to resolve import "./plan"`.

- [ ] **Step 4: Implement `plan.ts`**

```ts
import type { OutputFormat, ResizePreset } from "./types";

export const MAX_FILE_BYTES = 35 * 1024 * 1024;
export const MAX_QUEUE = 30;

export const PASSTHROUGH_TYPES = ["image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"];

export const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  ...PASSTHROUGH_TYPES,
];

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

export function isPassthrough(type: string): boolean {
  return PASSTHROUGH_TYPES.includes(type);
}

export function resolveOutputFormat(sourceType: string, format: OutputFormat): string {
  const source = sourceType === "image/jpg" ? "image/jpeg" : sourceType;
  if (isPassthrough(source)) return source;
  if (format === "keep") return source === "image/gif" ? "image/png" : source;
  return format;
}

export function targetDimensions(
  width: number,
  height: number,
  resize: ResizePreset,
): { width: number; height: number } {
  if (resize === "none") return { width, height };

  const longEdge = Math.max(width, height);
  if (longEdge <= resize) return { width, height };

  const scale = resize / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function savingsPercent(originalBytes: number, outputBytes: number): number {
  if (originalBytes <= 0) return 0;
  return ((originalBytes - outputBytes) / originalBytes) * 100;
}

export function shouldKeepOriginal(originalBytes: number, outputBytes: number): boolean {
  return outputBytes >= originalBytes;
}

export function outputFilename(sourceName: string, mime: string, taken: Set<string>): string {
  const ext = EXTENSIONS[mime] ?? "bin";
  const lastDot = sourceName.lastIndexOf(".");
  const base = lastDot > 0 ? sourceName.slice(0, lastDot) : sourceName;

  let candidate = `${base}.${ext}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}.${ext}`;
    n += 1;
  }
  return candidate;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

Note `resolveOutputFormat` maps a GIF source under `keep` to PNG — canvas cannot encode GIF, and the spec forbids shipping PNG bytes under a `.gif` name.

- [ ] **Step 5: Run the tests**

```bash
npm test
```

Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/types.ts src/lib/engine/plan.ts src/lib/engine/plan.test.ts
git commit -m "feat: add pure encoding decision logic with tests"
```

---

## Task 6: Encode pass and worker

**Files:**
- Create: `src/lib/engine/encode.ts`, `src/lib/engine/worker.ts`

**Interfaces:**
- Consumes: `plan.ts` (`targetDimensions`, `resolveOutputFormat`, `isPassthrough`, `shouldKeepOriginal`).
- Produces:
  - `encodeOne(file: File, source: SourceInfo, settings: EncodeSettings): Promise<EncodeResult>`
  - Worker protocol: in `{ type: "encode"; id: string; generation: number; file: File; source: SourceInfo; settings: EncodeSettings }`; out `{ type: "done"; id; generation; result }` or `{ type: "error"; id; generation; message }`.

- [ ] **Step 1: Write `encode.ts`**

```ts
import type { EncodeSettings, EncodeResult, SourceInfo } from "./types";
import { isPassthrough, resolveOutputFormat, shouldKeepOriginal, targetDimensions } from "./plan";

export function canUseOffscreen(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas.prototype.convertToBlob === "function"
  );
}

/** decode -> resize -> encode, in ONE pass. */
export async function encodeOne(
  file: File,
  source: SourceInfo,
  settings: EncodeSettings,
): Promise<EncodeResult> {
  const mime = resolveOutputFormat(source.type, settings.format);

  if (isPassthrough(source.type)) {
    return {
      blob: file,
      size: file.size,
      width: source.width,
      height: source.height,
      mime: source.type,
      keptOriginal: true,
    };
  }

  const { width, height } = targetDimensions(source.width, source.height, settings.resize);
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = canUseOffscreen()
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });

    const ctx = canvas.getContext("2d") as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("Could not acquire a 2D context");

    // JPEG has no alpha: composite onto white rather than letting it go black.
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
    }

    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const quality = settings.quality / 100;
    const blob =
      canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: mime, quality })
        : await new Promise<Blob>((resolve, reject) =>
            (canvas as HTMLCanvasElement).toBlob(
              (b) => (b ? resolve(b) : reject(new Error("Encoding produced no data"))),
              mime,
              quality,
            ),
          );

    // A "compressed" file that grew is not a saving. Ship the original.
    if (shouldKeepOriginal(file.size, blob.size) && settings.resize === "none" && mime === source.type) {
      return {
        blob: file,
        size: file.size,
        width: source.width,
        height: source.height,
        mime: source.type,
        keptOriginal: true,
      };
    }

    return { blob, size: blob.size, width, height, mime, keptOriginal: false };
  } finally {
    bitmap.close();
  }
}
```

The `keptOriginal` branch requires `resize === "none"` and an unchanged mime — otherwise a deliberate resize or format conversion that happens to grow would be silently ignored, which is a different lie from the one we are fixing.

- [ ] **Step 2: Write `worker.ts`**

```ts
/// <reference lib="webworker" />
import type { EncodeSettings, SourceInfo } from "./types";
import { encodeOne } from "./encode";

export interface EncodeRequest {
  type: "encode";
  id: string;
  generation: number;
  file: File;
  source: SourceInfo;
  settings: EncodeSettings;
}

let currentGeneration = 0;

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { id, generation, file, source, settings } = event.data;
  currentGeneration = Math.max(currentGeneration, generation);

  try {
    const result = await encodeOne(file, source, settings);

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
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean. If `OffscreenCanvas` types are missing, add `"WebWorker"` to `compilerOptions.lib` in `tsconfig.app.json`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/engine/encode.ts src/lib/engine/worker.ts tsconfig.app.json
git commit -m "feat: add single-pass encoder and worker"
```

---

## Task 7: Engine client — pool, fallback, URL registry

**Files:**
- Create: `src/lib/engine/client.ts`

**Interfaces:**
- Consumes: `worker.ts` protocol, `encode.ts` (`encodeOne`, `canUseOffscreen`).
- Produces:
  - `class EncodeClient` with `encode(id, file, source, settings): Promise<EncodeResult>`, `bumpGeneration(): number`, `dispose(): void`
  - `trackUrl(url: string): string`, `releaseUrl(url: string): void`, `releaseAll(): void`

- [ ] **Step 1: Write `client.ts`**

```ts
import type { EncodeResult, EncodeSettings, SourceInfo } from "./types";
import { canUseOffscreen, encodeOne } from "./encode";

const liveUrls = new Set<string>();

export function trackUrl(url: string): string {
  liveUrls.add(url);
  return url;
}

export function releaseUrl(url: string): void {
  if (liveUrls.delete(url)) URL.revokeObjectURL(url);
}

export function releaseAll(): void {
  for (const url of liveUrls) URL.revokeObjectURL(url);
  liveUrls.clear();
}

interface Pending {
  resolve: (r: EncodeResult) => void;
  reject: (e: Error) => void;
  generation: number;
}

export class EncodeClient {
  private workers: Worker[] = [];
  private next = 0;
  private generation = 0;
  private pending = new Map<string, Pending>();
  private readonly useWorkers = canUseOffscreen() && typeof Worker !== "undefined";

  constructor() {
    if (!this.useWorkers) return;

    const size = Math.max(1, Math.min(3, navigator.hardwareConcurrency || 2));
    for (let i = 0; i < size; i += 1) {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event) => this.handle(event.data);
      this.workers.push(worker);
    }
  }

  bumpGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  async encode(
    id: string,
    file: File,
    source: SourceInfo,
    settings: EncodeSettings,
  ): Promise<EncodeResult> {
    const generation = this.generation;

    if (!this.useWorkers) {
      const result = await encodeOne(file, source, settings);
      if (generation < this.generation) throw new StaleResult();
      return result;
    }

    return new Promise<EncodeResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, generation });
      const worker = this.workers[this.next % this.workers.length];
      this.next += 1;
      worker.postMessage({ type: "encode", id, generation, file, source, settings });
    });
  }

  private handle(data: { type: string; id: string; generation: number; result?: EncodeResult; message?: string }) {
    const entry = this.pending.get(data.id);
    if (!entry) return;
    this.pending.delete(data.id);

    if (data.generation < this.generation) {
      entry.reject(new StaleResult());
      return;
    }

    if (data.type === "done" && data.result) entry.resolve(data.result);
    else entry.reject(new Error(data.message ?? "Encoding failed"));
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.pending.clear();
  }
}

export class StaleResult extends Error {
  constructor() {
    super("Superseded by newer settings");
    this.name = "StaleResult";
  }
}
```

`StaleResult` is thrown, not returned, so callers must decide explicitly — the queue reducer in Task 8 ignores it rather than rendering an error.

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/engine/client.ts
git commit -m "feat: add worker pool client with cancellation and url registry"
```

---

## Task 8: Queue state and zip bundling

**CHECKPOINT:** after this task the engine is complete and tested while the old UI still runs. This is a safe stopping point.

**Files:**
- Create: `src/lib/engine/zip.ts`, `src/hooks/useQueue.ts`, `src/hooks/useQueue.test.ts`

**Interfaces:**
- Consumes: `plan.ts`, `client.ts`, `types.ts`.
- Produces:
  - `bundleZip(entries: { name: string; blob: Blob }[]): Promise<Blob>`
  - `useQueue()` returning `{ items, settings, totals, status, addFiles, removeItem, clearAll, setSettings, downloadOne, downloadAll }`
  - `queueReducer(state, action)` exported for tests

- [ ] **Step 1: Install fflate**

```bash
npm install fflate@^0.8
```

- [ ] **Step 2: Write `zip.ts`**

```ts
import { zip } from "fflate";

export async function bundleZip(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};

  for (const entry of entries) {
    files[entry.name] = new Uint8Array(await entry.blob.arrayBuffer());
  }

  return new Promise<Blob>((resolve, reject) => {
    // level 0: image bytes are already compressed; deflating again wastes time for ~0 gain.
    zip(files, { level: 0 }, (err, data) => {
      if (err) reject(err);
      else resolve(new Blob([data], { type: "application/zip" }));
    });
  });
}
```

- [ ] **Step 3: Write the failing reducer tests**

Create `src/hooks/useQueue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { queueReducer, initialQueueState } from "./useQueue";
import type { QueueItem } from "@/lib/engine/types";

function item(id: string, size = 1000): QueueItem {
  return {
    id,
    file: new File([], `${id}.png`, { type: "image/png" }),
    source: { name: `${id}.png`, type: "image/png", size, width: 100, height: 100 },
    previewUrl: `blob:${id}`,
    status: "queued",
  };
}

describe("queueReducer", () => {
  it("adds items", () => {
    const state = queueReducer(initialQueueState, { type: "add", items: [item("a"), item("b")] });
    expect(state.items).toHaveLength(2);
  });

  it("rejects items beyond the queue cap", () => {
    const many = Array.from({ length: 31 }, (_, i) => item(`f${i}`));
    const state = queueReducer(initialQueueState, { type: "add", items: many });
    expect(state.items).toHaveLength(30);
    expect(state.notice).toMatch(/30/);
  });

  it("removes an item by id", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a"), item("b")] });
    const state = queueReducer(added, { type: "remove", id: "a" });
    expect(state.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("records a result and marks the item done", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a")] });
    const state = queueReducer(added, {
      type: "result",
      id: "a",
      result: {
        blob: new Blob(),
        size: 250,
        width: 100,
        height: 100,
        mime: "image/png",
        keptOriginal: false,
      },
    });
    expect(state.items[0].status).toBe("done");
    expect(state.items[0].result?.size).toBe(250);
  });

  it("computes totals across completed items only", () => {
    let state = queueReducer(initialQueueState, { type: "add", items: [item("a", 1000), item("b", 1000)] });
    state = queueReducer(state, {
      type: "result",
      id: "a",
      result: { blob: new Blob(), size: 250, width: 1, height: 1, mime: "image/png", keptOriginal: false },
    });
    const totals = state.items
      .filter((i) => i.status === "done")
      .reduce((acc, i) => ({ input: acc.input + i.source.size, output: acc.output + (i.result?.size ?? 0) }), {
        input: 0,
        output: 0,
      });
    expect(totals).toEqual({ input: 1000, output: 250 });
  });

  it("marks an item errored without touching its neighbours", () => {
    const added = queueReducer(initialQueueState, { type: "add", items: [item("a"), item("b")] });
    const state = queueReducer(added, { type: "error", id: "a", message: "boom" });
    expect(state.items[0].status).toBe("error");
    expect(state.items[0].error).toBe("boom");
    expect(state.items[1].status).toBe("queued");
  });
});
```

- [ ] **Step 4: Run the tests to confirm they fail**

```bash
npm test
```

Expected: FAIL — cannot resolve `./useQueue`.

- [ ] **Step 5: Implement `useQueue.ts`**

```ts
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { EncodeResult, EncodeSettings, QueueItem } from "@/lib/engine/types";
import { MAX_QUEUE, outputFilename, savingsPercent } from "@/lib/engine/plan";
import { EncodeClient, releaseAll, releaseUrl, StaleResult } from "@/lib/engine/client";
import { bundleZip } from "@/lib/engine/zip";

export interface QueueState {
  items: QueueItem[];
  settings: EncodeSettings;
  notice: string | null;
}

export const initialQueueState: QueueState = {
  items: [],
  settings: { quality: 85, resize: "none", format: "keep" },
  notice: null,
};

export type QueueAction =
  | { type: "add"; items: QueueItem[] }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "working"; id: string }
  | { type: "result"; id: string; result: EncodeResult }
  | { type: "error"; id: string; message: string }
  | { type: "settings"; settings: Partial<EncodeSettings> }
  | { type: "notice"; message: string | null };

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "add": {
      const room = MAX_QUEUE - state.items.length;
      const accepted = action.items.slice(0, Math.max(0, room));
      const rejected = action.items.length - accepted.length;
      return {
        ...state,
        items: [...state.items, ...accepted],
        notice: rejected > 0 ? `Queue holds ${MAX_QUEUE} files. ${rejected} not added.` : state.notice,
      };
    }
    case "remove":
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case "clear":
      return { ...state, items: [], notice: null };
    case "working":
      return {
        ...state,
        items: state.items.map((i) => (i.id === action.id ? { ...i, status: "working" } : i)),
      };
    case "result":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id
            ? { ...i, status: action.result.keptOriginal ? "passthrough" : "done", result: action.result }
            : i,
        ),
      };
    case "error":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id ? { ...i, status: "error", error: action.message } : i,
        ),
      };
    case "settings":
      return { ...state, settings: { ...state.settings, ...action.settings } };
    case "notice":
      return { ...state, notice: action.message };
    default:
      return state;
  }
}

export function useQueue() {
  const [state, dispatch] = useReducer(queueReducer, initialQueueState);
  const clientRef = useRef<EncodeClient | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  if (clientRef.current === null) clientRef.current = new EncodeClient();

  useEffect(() => {
    return () => {
      clientRef.current?.dispose();
      releaseAll();
    };
  }, []);

  const runAll = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    client.bumpGeneration();

    for (const item of state.items) {
      dispatch({ type: "working", id: item.id });
      client
        .encode(item.id, item.file, item.source, state.settings)
        .then((result) => dispatch({ type: "result", id: item.id, result }))
        .catch((error) => {
          if (error instanceof StaleResult) return; // superseded, not a failure
          dispatch({ type: "error", id: item.id, message: error.message });
        });
    }
  }, [state.items, state.settings]);

  // Debounced re-encode on any settings or queue change.
  useEffect(() => {
    if (state.items.length === 0) return;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(runAll, 200);
    return () => window.clearTimeout(debounceRef.current);
  }, [state.items.length, state.settings, runAll]);

  const totals = useMemo(() => {
    const done = state.items.filter((i) => i.result);
    const input = done.reduce((n, i) => n + i.source.size, 0);
    const output = done.reduce((n, i) => n + (i.result?.size ?? 0), 0);
    return { count: done.length, input, output, percent: savingsPercent(input, output) };
  }, [state.items]);

  const downloadOne = useCallback((item: QueueItem) => {
    if (!item.result) return;
    const name = outputFilename(item.source.name, item.result.mime, new Set());
    save(item.result.blob, name);
  }, []);

  const downloadAll = useCallback(async () => {
    const taken = new Set<string>();
    const entries = state.items
      .filter((i) => i.result)
      .map((i) => {
        const name = outputFilename(i.source.name, i.result!.mime, taken);
        taken.add(name);
        return { name, blob: i.result!.blob };
      });
    if (entries.length === 0) return;
    save(await bundleZip(entries), "image-crunch.zip");
  }, [state.items]);

  const removeItem = useCallback((item: QueueItem) => {
    releaseUrl(item.previewUrl);
    dispatch({ type: "remove", id: item.id });
  }, []);

  return { ...state, totals, dispatch, downloadOne, downloadAll, removeItem };
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 6: Run the tests**

```bash
npm test
```

Expected: PASS — plan tests and reducer tests.

- [ ] **Step 7: Verify the build**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add queue state, zip bundling, and debounced re-encode"
```

---

## Task 9: Masthead and Statement

The first visible piece of the redesign.

**Files:**
- Create: `src/components/Masthead.tsx`, `src/components/Statement.tsx`
- Modify: `src/pages/Index.tsx`

**Interfaces:**
- Consumes: `useQueue()` totals and item statuses, `formatBytes`.
- Produces: `<Masthead status={...} onDownloadAll={...} />`, `<Statement />`.

- [ ] **Step 1: Write `Masthead.tsx`**

```tsx
import { formatBytes } from "@/lib/engine/plan";

interface MastheadProps {
  count: number;
  working: number;
  totals: { count: number; input: number; output: number; percent: number };
  onDownloadAll: () => void;
}

export function Masthead({ count, working, totals, onDownloadAll }: MastheadProps) {
  const done = totals.count > 0 && working === 0;

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-12 border-b border-rule bg-paper">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-6">
        <span className="label">Image Crunch</span>

        <div className="data flex items-center gap-4 text-[0.8125rem]">
          {working > 0 && <span>WORKING · {working} OF {count}</span>}
          {count === 0 && <span className="text-ink-60">IDLE · 0 FILES</span>}
          {done && (
            <>
              <span className="text-ink-60">
                {totals.count} FILES · {formatBytes(totals.input)} → {formatBytes(totals.output)}
              </span>
              <span className="text-signal">−{totals.percent.toFixed(1)}%</span>
              <button
                type="button"
                onClick={onDownloadAll}
                className="border border-ink px-3 py-1 transition-colors duration-[140ms] hover:bg-ink hover:text-paper"
              >
                ↓ ALL
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Write `Statement.tsx`**

```tsx
export function Statement() {
  return (
    <section className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-[1440px] grid-cols-1 content-center gap-12 px-6 pt-12 md:grid-cols-12">
      <div className="md:col-span-8">
        <h1 className="display">
          Smaller
          <br />
          files.
          <br />
          Same
          <br />
          picture.
        </h1>

        <a
          href="#tool"
          className="mt-10 inline-block bg-signal px-6 py-3 text-signal-ink transition-opacity duration-[140ms] hover:opacity-90"
        >
          <span className="label">Start ↓</span>
        </a>
      </div>

      <aside className="self-end md:col-span-4 md:col-start-9">
        <ul className="label space-y-1 text-ink-60">
          <li>Free</li>
          <li>No account</li>
          <li>On-device</li>
        </ul>
        <p className="mt-6 max-w-[42ch] text-ink-60">
          Every byte is processed in your own browser. Nothing is uploaded, ever.
        </p>
      </aside>
    </section>
  );
}
```

- [ ] **Step 3: Wire both into `Index.tsx`**

Replace the file body with the masthead, statement, and a placeholder `<main id="tool" />`. Keep `useQueue()` at this level — it is the single owner of queue state, and Tasks 10–12 read from it.

```tsx
import { Masthead } from "@/components/Masthead";
import { Statement } from "@/components/Statement";
import { useQueue } from "@/hooks/useQueue";

const Index = () => {
  const { items, totals, downloadAll } = useQueue();
  const working = items.filter((i) => i.status === "working").length;

  return (
    <>
      <Masthead count={items.length} working={working} totals={totals} onDownloadAll={downloadAll} />
      <Statement />
      <main id="tool" className="mx-auto max-w-[1440px] border-t border-rule px-6 py-16" />
    </>
  );
};

export default Index;
```

- [ ] **Step 4: Verify**

```bash
npm run dev
```

Expected: paper ground, huge Archivo Expanded statement hard left, mono status line reading `IDLE · 0 FILES`, one red CTA. Nothing rounded, no shadows anywhere.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add masthead status bar and type statement"
```

---

## Task 10: Queue and rows

**Files:**
- Create: `src/components/Queue.tsx`, `src/components/QueueRow.tsx`, `src/components/DropZone.tsx`
- Modify: `src/pages/Index.tsx`

**Interfaces:**
- Consumes: `useQueue()`, `plan.ts` (`formatBytes`, `savingsPercent`, `ACCEPTED_TYPES`, `MAX_FILE_BYTES`), `getImageDimensions` (moved into `DropZone.tsx` as a local helper — `imageUtils.ts` is deleted in Task 14).
- Produces: `<DropZone onFiles={(files: File[]) => void} />`, `<Queue items settings totals onRemove onDownloadOne />`.

- [ ] **Step 1: Write `DropZone.tsx`**

It is both the empty-state target and a window-level listener, so a drop anywhere on the page works.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPTED_TYPES, MAX_FILE_BYTES } from "@/lib/engine/plan";

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  onReject: (message: string) => void;
}

export function DropZone({ onFiles, onReject }: DropZoneProps) {
  const [active, setActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const files = Array.from(list);
      const tooBig = files.filter((f) => f.size > MAX_FILE_BYTES);
      const wrongType = files.filter((f) => !ACCEPTED_TYPES.includes(f.type));
      const ok = files.filter((f) => f.size <= MAX_FILE_BYTES && ACCEPTED_TYPES.includes(f.type));

      if (tooBig.length) onReject(`${tooBig.length} file(s) over 35 MB were skipped.`);
      else if (wrongType.length) onReject(`${wrongType.length} unsupported file(s) were skipped.`);

      if (ok.length) {
        onFiles(ok);
        document.getElementById("tool")?.scrollIntoView({ behavior: "smooth" });
      }
    },
    [onFiles, onReject],
  );

  // Drop anywhere on the page, at any scroll position.
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setActive(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setActive(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setActive(false);
      accept(e.dataTransfer?.files ?? null);
    };

    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [accept]);

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className={`w-full border border-rule px-6 py-24 text-left transition-colors duration-[140ms] ${
        active ? "bg-paper-2 border-signal" : "bg-paper-2"
      }`}
    >
      <span className="label block text-ink">Drop images</span>
      <span className="mt-4 block text-ink-60">
        or click to choose · up to 35 MB each · 30 files max
      </span>
      <span className="data mt-2 block text-[0.8125rem] text-ink-38">
        JPG · PNG · WEBP · GIF · SVG · ICO
      </span>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES.join(",")}
        className="sr-only"
        onChange={(e) => accept(e.target.files)}
      />
    </button>
  );
}

export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}
```

Note the `URL.revokeObjectURL` in both handlers — the original `imageUtils.getImageDimensions` leaked one URL per file.

- [ ] **Step 2: Write `QueueRow.tsx`**

```tsx
import type { QueueItem } from "@/lib/engine/types";
import { formatBytes, savingsPercent } from "@/lib/engine/plan";
import { Compare } from "@/components/Compare";

interface QueueRowProps {
  index: number;
  item: QueueItem;
  expanded: boolean;
  onToggle: () => void;
  onDownload: () => void;
  onRemove: () => void;
}

export function QueueRow({ index, item, expanded, onToggle, onDownload, onRemove }: QueueRowProps) {
  const result = item.result;
  const percent = result ? savingsPercent(item.source.size, result.size) : 0;

  return (
    <li className="border-b border-rule py-4">
      <div className="grid grid-cols-12 items-baseline gap-4">
        <span className="data col-span-1 text-ink-38">{String(index + 1).padStart(2, "0")}</span>

        <span className="col-span-4 truncate">{item.source.name}</span>

        <span className="data col-span-3 text-[0.8125rem] text-ink-60">
          {item.source.width}×{item.source.height}
          {result && !result.keptOriginal && ` → ${result.width}×${result.height}`}
        </span>

        <span className="data col-span-2 text-[0.8125rem]">
          {item.status === "working" && <span className="text-ink-60">encoding…</span>}
          {item.status === "error" && <span className="text-ink-60">{item.error}</span>}
          {result && (
            <>
              {formatBytes(item.source.size)} → {formatBytes(result.size)}
            </>
          )}
        </span>

        <span className="data col-span-1 text-right">
          {item.status === "passthrough" && <span className="text-ink-38">—</span>}
          {result && !result.keptOriginal && (
            <span className={percent >= 0 ? "text-signal" : "text-ink-60"}>
              {percent >= 0 ? "−" : "+"}
              {Math.abs(percent).toFixed(1)}%
            </span>
          )}
        </span>

        <span className="col-span-1 flex justify-end gap-3">
          <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label="Compare">
            {expanded ? "⌃" : "⌄"}
          </button>
          <button type="button" onClick={onDownload} disabled={!result} aria-label="Download">
            ↓
          </button>
          <button type="button" onClick={onRemove} aria-label="Remove">
            ×
          </button>
        </span>
      </div>

      {item.status === "passthrough" && (
        <p className="data mt-2 text-[0.8125rem] text-ink-38">passthrough — no gain</p>
      )}

      {expanded && result && <Compare item={item} result={result} />}
    </li>
  );
}
```

- [ ] **Step 3: Write `Queue.tsx`**

Renders the empty state or the row list plus the totals line. The totals line carries the only `aria-live` region in the queue.

```tsx
import { useState } from "react";
import type { QueueItem } from "@/lib/engine/types";
import { formatBytes } from "@/lib/engine/plan";
import { QueueRow } from "@/components/QueueRow";

interface QueueProps {
  items: QueueItem[];
  totals: { count: number; input: number; output: number; percent: number };
  onDownloadOne: (item: QueueItem) => void;
  onRemove: (item: QueueItem) => void;
}

export function Queue({ items, totals, onDownloadOne, onRemove }: QueueProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-ink pb-2">
        <span className="label">Queue</span>
        <span className="data text-[0.8125rem] text-ink-60">{items.length} FILES</span>
      </div>

      <ul>
        {items.map((item, index) => (
          <QueueRow
            key={item.id}
            index={index}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onDownload={() => onDownloadOne(item)}
            onRemove={() => onRemove(item)}
          />
        ))}
      </ul>

      <div className="data flex items-baseline justify-between pt-4 text-[0.8125rem]" aria-live="polite">
        <span className="label">Total</span>
        <span>
          {formatBytes(totals.input)} → {formatBytes(totals.output)}{" "}
          <span className="text-signal">−{totals.percent.toFixed(1)}%</span>
        </span>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire into `Index.tsx`**

Inside `<main id="tool">`, render `<DropZone />` when `items.length === 0`, otherwise `<Queue />` with a smaller "add more" `DropZone` beneath it. Build `QueueItem`s in the `onFiles` handler using `getImageDimensions` and `crypto.randomUUID()` for ids, wrapping each preview URL in `trackUrl(URL.createObjectURL(file))`.

- [ ] **Step 5: Verify manually**

```bash
npm run dev
```

Drop four images including one SVG. Expected: rows appear with real dimensions; the SVG shows `passthrough — no gain` and `—`; savings percentages appear in red; the totals line updates; the masthead shows `WORKING · n OF m` then the final summary.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add file queue, rows, and global drop target"
```

---

## Task 11: Controls

**Files:**
- Create: `src/components/Controls.tsx`
- Modify: `src/pages/Index.tsx`

**Interfaces:**
- Consumes: `useQueue()` `settings` and `dispatch`, the shadcn `Slider`, `Field`, `ButtonGroup` generated in Task 4.
- Produces: `<Controls settings onChange onDownloadAll disabled />`.

- [ ] **Step 1: Re-read the generated Base UI Slider API**

```bash
cat src/components/ui/slider.tsx
```

Base UI's Slider is a compound component and its props differ from Radix's `value`/`onValueChange`. Write against what the file actually exports.

- [ ] **Step 2: Write `Controls.tsx`**

Sticky above the viewport bottom while the queue is in view. Three fields plus the primary action:

```tsx
import type { EncodeSettings, OutputFormat, ResizePreset } from "@/lib/engine/types";

interface ControlsProps {
  settings: EncodeSettings;
  onChange: (patch: Partial<EncodeSettings>) => void;
  onDownloadAll: () => void;
  disabled: boolean;
}

const FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "keep", label: "Keep" },
  { value: "image/jpeg", label: "JPG" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WebP" },
];

const RESIZES: { value: ResizePreset; label: string }[] = [
  { value: "none", label: "None" },
  { value: 2048, label: "2048" },
  { value: 1280, label: "1280" },
];

export function Controls({ settings, onChange, onDownloadAll, disabled }: ControlsProps) {
  return (
    <div className="sticky bottom-0 border-t border-ink bg-paper py-4">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:items-center">
        <div className="md:col-span-4">
          <label className="label block text-ink-60" htmlFor="quality">
            Quality <span className="data text-ink">{settings.quality}</span>
          </label>
          <input
            id="quality"
            type="range"
            min={10}
            max={100}
            step={5}
            value={settings.quality}
            onChange={(e) => onChange({ quality: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--signal)]"
          />
        </div>

        <fieldset className="md:col-span-3">
          <legend className="label text-ink-60">Resize</legend>
          <div className="mt-2 flex gap-2">
            {RESIZES.map((r) => (
              <button
                key={String(r.value)}
                type="button"
                onClick={() => onChange({ resize: r.value })}
                aria-pressed={settings.resize === r.value}
                className={`data border px-3 py-1 text-[0.8125rem] transition-colors duration-[140ms] ${
                  settings.resize === r.value ? "border-ink bg-ink text-paper" : "border-rule text-ink-60"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="md:col-span-3">
          <legend className="label text-ink-60">Format</legend>
          <div className="mt-2 flex gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => onChange({ format: f.value })}
                aria-pressed={settings.format === f.value}
                className={`data border px-3 py-1 text-[0.8125rem] transition-colors duration-[140ms] ${
                  settings.format === f.value ? "border-ink bg-ink text-paper" : "border-rule text-ink-60"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="md:col-span-2 md:justify-self-end">
          <button
            type="button"
            onClick={onDownloadAll}
            disabled={disabled}
            className="label bg-signal px-5 py-3 text-signal-ink transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-[0.38]"
          >
            ↓ All · Zip
          </button>
        </div>
      </div>
    </div>
  );
}
```

If the generated Base UI `Slider` gives a better keyboard experience than the native range input, swap it in — but keep the signal fill on the completed portion of the track and nowhere else.

- [ ] **Step 3: Wire into `Index.tsx`**

Render `<Controls />` below `<Queue />` only when `items.length > 0`; pass `onChange={(patch) => dispatch({ type: "settings", settings: patch })}`.

- [ ] **Step 4: Verify the debounce works**

```bash
npm run dev
```

Drag the quality slider quickly across its range with six files queued. Expected: the UI stays responsive, one final set of results renders, and no stale/flickering numbers appear. Check DevTools → Network shows zero requests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add global quality, resize, and format controls"
```

---

## Task 12: Before/after comparison

**Files:**
- Create: `src/components/Compare.tsx`

**Interfaces:**
- Consumes: `QueueItem`, `EncodeResult`, `trackUrl`/`releaseUrl` from `client.ts`.
- Produces: `<Compare item={item} result={result} />`.

- [ ] **Step 1: Write `Compare.tsx`**

The output blob URL is created in an effect, never in render, and revoked on unmount:

```tsx
import { useEffect, useState } from "react";
import type { EncodeResult, QueueItem } from "@/lib/engine/types";
import { releaseUrl, trackUrl } from "@/lib/engine/client";

interface CompareProps {
  item: QueueItem;
  result: EncodeResult;
}

export function Compare({ item, result }: CompareProps) {
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [split, setSplit] = useState(50);

  useEffect(() => {
    const url = trackUrl(URL.createObjectURL(result.blob));
    setOutputUrl(url);
    return () => releaseUrl(url);
  }, [result.blob]);

  return (
    <div className="mt-4 border border-rule bg-paper-2 p-4">
      <div className="relative aspect-video overflow-hidden bg-paper-2">
        <img
          src={item.previewUrl}
          alt="Original"
          className="absolute inset-0 h-full w-full object-contain"
        />
        {outputUrl && (
          <div className="absolute inset-0 overflow-hidden" style={{ width: `${split}%` }}>
            <img
              src={outputUrl}
              alt="Compressed"
              className="absolute inset-0 h-full w-full object-contain"
              style={{ width: `${10000 / split}%` }}
            />
          </div>
        )}
        <div className="absolute inset-y-0 w-px bg-ink" style={{ left: `${split}%` }} aria-hidden />
      </div>

      <label className="label mt-3 block text-ink-60" htmlFor={`split-${item.id}`}>
        Compare
      </label>
      <input
        id={`split-${item.id}`}
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        className="w-full accent-[var(--ink)]"
        aria-label="Comparison position"
      />

      <div className="data mt-2 flex justify-between text-[0.8125rem] text-ink-60">
        <span>COMPRESSED</span>
        <span>ORIGINAL</span>
      </div>
    </div>
  );
}
```

The inner `<img>` width compensation keeps both images at identical scale so the divider compares the same pixels — without it the clipped side squashes and the comparison is meaningless.

- [ ] **Step 2: Verify**

Expand a row with a heavily compressed JPEG (quality 20). Expected: dragging the slider shows visible artifacts on the compressed side while the original stays sharp, both perfectly aligned. Arrow keys move the divider.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add before/after comparison in expanded rows"
```

---

## Task 13: Editorial sections, colophon, metadata

**Files:**
- Create: `src/components/Editorial.tsx`
- Modify: `src/pages/Index.tsx`, `index.html`

**Interfaces:**
- Consumes: nothing.
- Produces: `<Editorial />`.

- [ ] **Step 1: Write `Editorial.tsx`**

Three numbered entries and the colophon. Real copy, not lorem:

```tsx
const ENTRIES = [
  {
    n: "01",
    title: "Nothing leaves your browser",
    body: "Image Crunch has no server. Your files are decoded, resized and re-encoded by your own device, and the results never travel anywhere. Close the tab and nothing remains — there is no account, no history, and nothing stored.",
  },
  {
    n: "02",
    title: "Which format should you use",
    body: "WebP is smaller than both JPG and PNG at matched quality and is supported everywhere that matters. Choose JPG for photographs headed somewhere old. Choose PNG when you need transparency or crisp flat colour — screenshots, logos, diagrams.",
  },
  {
    n: "03",
    title: "What quality actually changes",
    body: "Quality controls how much detail the encoder discards, not the pixel dimensions. Above 80 the loss is usually invisible; below 50 it is obvious in gradients and flat areas first. Use the comparison view before trusting a number.",
  },
];

export function Editorial() {
  return (
    <section className="mx-auto max-w-[1440px] px-6">
      {ENTRIES.map((entry) => (
        <article key={entry.n} className="grid grid-cols-1 gap-4 border-t border-rule py-10 md:grid-cols-12">
          <span className="data col-span-1 text-ink-38">{entry.n}</span>
          <h2 className="col-span-4 text-[2.25rem] leading-tight tracking-[-0.02em]">{entry.title}</h2>
          <p className="col-span-6 col-start-7 max-w-[62ch] text-ink-60">{entry.body}</p>
        </article>
      ))}

      <footer className="data border-t border-rule py-8 text-[0.8125rem] text-ink-38">
        IMAGE CRUNCH · 2026 · DANIEL REY · TYPE: ARCHIVO / JETBRAINS MONO
      </footer>
    </section>
  );
}
```

- [ ] **Step 2: Render it below the tool in `Index.tsx`**

- [ ] **Step 3: Update `index.html` metadata**

The current description promises "upscale and enhance", which the app does not do. Replace the description and OG description with the honest one:

```html
<meta name="description" content="Compress and convert images in your browser. Batch queue, no upload, no account, no limits worth mentioning. JPG, PNG and WebP." />
<meta property="og:description" content="Compress and convert images in your browser. Nothing is uploaded." />
```

- [ ] **Step 4: Verify**

```bash
npm run build && npm run preview
```

Read the editorial sections at 1440px and at 375px. Expected: 62ch measure holds on desktop; entries stack on mobile; hairlines align to the grid.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add editorial sections, colophon, and honest metadata"
```

---

## Task 14: Remove the legacy implementation

**Files:**
- Delete: `src/lib/imageUtils.ts`, `src/components/ImageUploader.tsx`, `src/components/ImageProcessor.tsx`

**Interfaces:**
- Consumes: Tasks 9–13 must be complete — these deletions remove the old UI entirely.
- Produces: nothing new.

- [ ] **Step 1: Confirm nothing imports them**

```bash
grep -rn "imageUtils\|ImageUploader\|ImageProcessor" src/
```

Expected: no results. If `Index.tsx` still references them, finish wiring the new components first.

- [ ] **Step 2: Delete**

```bash
git rm -f src/lib/imageUtils.ts src/components/ImageUploader.tsx src/components/ImageProcessor.tsx
```

- [ ] **Step 3: Full verification**

```bash
npm test
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

Expected: all three pass.

- [ ] **Step 4: Check the bundle**

```bash
npm run build 2>&1 | tail -6
```

Expected: smaller than the 434 KB baseline recorded in Task 1 — ~25 Radix packages and 48 components are gone, offset by fonts and fflate. If it grew substantially, check whether a deleted dependency crept back in.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy single-image implementation"
```

---

## Task 15: Design polish and accessibility audit

**Files:** any component, as the audit dictates.

**Interfaces:**
- Consumes: the complete app.
- Produces: no new interfaces.

- [ ] **Step 1: Load the design skill**

Invoke `frontend-design:frontend-design` and review every screen against it. This is the pass that separates "follows the spec" from "looks designed" — spacing rhythm, optical alignment of the display type, the exact weight of the hairlines, how the queue breathes at 3 files versus 30.

- [ ] **Step 2: Audit the signal color**

```bash
grep -rn "signal" src/components/ | grep -v "signal-ink"
```

Every hit must be one of: the savings figure, the quality track fill, the primary download action, or a focus ring. Anything else violates the spec's central rule — remove the color, not the rule.

- [ ] **Step 3: Audit for forbidden shapes**

```bash
grep -rn "rounded\|shadow" src/
```

Expected: no results.

- [ ] **Step 4: Keyboard pass**

Tab through the entire page with no mouse. Every control reachable, focus always visible with the 2px signal outline, the comparison divider movable by arrow keys, no focus traps.

- [ ] **Step 5: Screen reader spot check**

Queue changes should announce once via the totals line, not once per row. Buttons that show only a glyph (`⌄`, `↓`, `×`) must have `aria-label`s — verify each.

- [ ] **Step 6: Reduced motion**

Enable the OS "reduce motion" setting. Expected: no transitions anywhere, everything instant, nothing broken.

- [ ] **Step 7: Lighthouse**

```bash
npm run build && npm run preview
```

Run Lighthouse against the preview URL. Target: Accessibility ≥ 95, Best Practices ≥ 95. Fix what it finds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "polish: design and accessibility pass"
```

---

## Self-Review Notes

**Spec coverage check** — every spec section maps to a task:

| Spec section | Tasks |
|---|---|
| §1 Foundation (color, type, layout, motion, focus) | 3, 15 |
| §2 Page architecture (masthead, statement, drop-anywhere, editorial, colophon, responsive) | 9, 10, 13 |
| §3 The tool (empty, queue, rows, global settings, expansion, debounce, zip, cap, honest states, a11y) | 8, 10, 11, 12, 15 |
| §4 Engine (one pass, pool, fallback, generation, memory) | 5, 6, 7, 8 |
| §5 Stack migration (Tailwind v4, Base UI, deletions) | 2, 4, 14 |
| §6 Order of work | task order |
| §7 Testing (Vitest, plan.ts cases) | 1, 5, 8 |
| §8 Out of scope | not implemented, by design |

**Known gaps, deliberately left:**

- The main-thread fallback path is exercised only by feature detection, not by an automated test. Verifying it needs a browser without `OffscreenCanvas`; the spec accepts a thin integration check here rather than a mock that would pass while broken.
- Task 4 depends on shadcn CLI output that cannot be fully predicted from here. Steps 2 and 4 of that task exist specifically to read reality before writing code.
