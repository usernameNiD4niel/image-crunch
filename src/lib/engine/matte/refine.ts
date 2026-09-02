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
  // Peak cost: a second full RGBA buffer — ~80 MB for a 20 MP source, on
  // top of the one being corrected.
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
