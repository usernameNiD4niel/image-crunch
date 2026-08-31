# Image Crunch

A client-side batch image compressor. Drop up to 30 images (35 MB each), pick a
quality, an optional resize and an output format, and get the compressed files
back one at a time or as a zip.

Everything happens in the browser. There is no backend, no upload, no account
and no telemetry — the files never leave the machine they were dropped on.

- **Formats in:** JPG, PNG, WebP, GIF, plus SVG and ICO (passed through
  byte-identical).
- **Formats out:** WebP (default), JPG, PNG, or keep the source format. GIF is
  never an output format.
- Encoding runs on a small pool of Web Workers via `OffscreenCanvas`, with a
  main-thread fallback where that is unavailable.

## Getting started

Requires Node 18+ and npm (this project uses `package-lock.json`).

```sh
npm install
npm run dev     # Vite dev server
npm test        # Vitest, single run
npm run build   # production build to dist/
```

Other scripts: `npm run test:watch`, `npm run lint`, `npm run preview`.

## Stack

Vite, React 18, TypeScript, Tailwind CSS v4, Base UI, fflate (zip), Vitest +
Testing Library.
