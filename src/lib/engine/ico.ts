/**
 * The ICO container.
 *
 * No browser can encode ICO — canvas speaks PNG, JPEG and WebP and nothing
 * else — so an .ico is assembled by hand here: a small directory, then one
 * PNG per size. PNG-inside-ICO is legal and is what Windows itself has
 * shipped since Vista; every browser reads it as a favicon.
 *
 * Layout, all little-endian:
 *
 *   ICONDIR        6 bytes   reserved(2)=0, type(2)=1, count(2)
 *   ICONDIRENTRY  16 bytes   × count, in the order the images appear
 *   payloads                 the PNGs, back to back
 */

/** The largest icon the format can describe (see the 0-means-256 rule below). */
export const ICO_MAX_SIZE = 256;

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

export interface IcoEntry {
  /** Square edge length in pixels, 1–256. */
  size: number;
  png: Uint8Array;
}

export function buildIco(entries: IcoEntry[]): Blob {
  if (entries.length === 0) throw new Error("An .ico needs at least one image");
  for (const { size } of entries) {
    if (size < 1 || size > ICO_MAX_SIZE) {
      throw new Error(`An .ico image must be 1–${ICO_MAX_SIZE}px, got ${size}`);
    }
  }

  const directory = new ArrayBuffer(HEADER_BYTES + ENTRY_BYTES * entries.length);
  const view = new DataView(directory);

  view.setUint16(0, 0, true); // reserved, always 0
  view.setUint16(2, 1, true); // 1 = icon, 2 = cursor
  view.setUint16(4, entries.length, true);

  // Every payload sits after the whole directory, so the first offset is
  // known only once the entry count is: hence directory-then-payloads rather
  // than writing each entry as its image is encoded.
  let offset = directory.byteLength;

  entries.forEach((entry, index) => {
    const at = HEADER_BYTES + ENTRY_BYTES * index;
    // Width and height are ONE byte each, so 256 does not fit. The format
    // spends the value it has no other use for: 0 means 256.
    const dimension = entry.size === ICO_MAX_SIZE ? 0 : entry.size;

    view.setUint8(at, dimension);
    view.setUint8(at + 1, dimension);
    view.setUint8(at + 2, 0); // palette entries; 0 for a truecolour image
    view.setUint8(at + 3, 0); // reserved
    view.setUint16(at + 4, 1, true); // colour planes
    view.setUint16(at + 6, 32, true); // bits per pixel — RGBA
    view.setUint32(at + 8, entry.png.byteLength, true);
    view.setUint32(at + 12, offset, true);

    offset += entry.png.byteLength;
  });

  return new Blob([directory, ...entries.map((e) => e.png)], { type: "image/x-icon" });
}
