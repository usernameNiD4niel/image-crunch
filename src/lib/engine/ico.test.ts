import { describe, it, expect } from "vitest";
import { buildIco, ICO_MAX_SIZE } from "./ico";

/** A stand-in PNG payload — buildIco never inspects the bytes it carries. */
function payload(byte: number, length: number): Uint8Array {
  return new Uint8Array(length).fill(byte);
}

async function bytes(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

describe("buildIco", () => {
  it("writes the ICONDIR header: reserved 0, type 1 (icon), and the image count", async () => {
    const view = await bytes(
      buildIco([
        { size: 16, png: payload(1, 40) },
        { size: 32, png: payload(2, 60) },
      ]),
    );

    expect(view.getUint16(0, true)).toBe(0); // reserved
    expect(view.getUint16(2, true)).toBe(1); // 1 = icon (2 would be a cursor)
    expect(view.getUint16(4, true)).toBe(2); // image count
  });

  it("describes each image in a 16-byte directory entry", async () => {
    const view = await bytes(buildIco([{ size: 48, png: payload(7, 120) }]));

    expect(view.getUint8(6)).toBe(48); // width
    expect(view.getUint8(7)).toBe(48); // height
    expect(view.getUint8(8)).toBe(0); // palette colours: 0 = truecolour
    expect(view.getUint8(9)).toBe(0); // reserved
    expect(view.getUint16(10, true)).toBe(1); // colour planes
    expect(view.getUint16(12, true)).toBe(32); // bits per pixel (RGBA)
    expect(view.getUint32(14, true)).toBe(120); // bytes in this image
    expect(view.getUint32(18, true)).toBe(6 + 16); // offset: header + one entry
  });

  // The width/height fields are single bytes, so the format's largest legal
  // icon does not fit in them — the spec spends the 0 it freed by having no
  // zero-pixel icons.
  it("writes a 256px icon's dimensions as 0", async () => {
    const view = await bytes(buildIco([{ size: 256, png: payload(9, 10) }]));

    expect(view.getUint8(6)).toBe(0);
    expect(view.getUint8(7)).toBe(0);
  });

  it("offsets each image past the whole directory and every image before it", async () => {
    const view = await bytes(
      buildIco([
        { size: 16, png: payload(1, 40) },
        { size: 32, png: payload(2, 60) },
        { size: 48, png: payload(3, 80) },
      ]),
    );

    const directoryEnd = 6 + 16 * 3;
    expect(view.getUint32(18, true)).toBe(directoryEnd);
    expect(view.getUint32(18 + 16, true)).toBe(directoryEnd + 40);
    expect(view.getUint32(18 + 32, true)).toBe(directoryEnd + 40 + 60);
  });

  it("carries each payload through byte for byte, at the offset it advertised", async () => {
    const blob = buildIco([
      { size: 16, png: payload(0xaa, 4) },
      { size: 32, png: payload(0xbb, 3) },
    ]);
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(buffer.buffer);

    const first = view.getUint32(18, true);
    const second = view.getUint32(18 + 16, true);

    expect([...buffer.slice(first, first + 4)]).toEqual([0xaa, 0xaa, 0xaa, 0xaa]);
    expect([...buffer.slice(second, second + 3)]).toEqual([0xbb, 0xbb, 0xbb]);
    expect(buffer.length).toBe(6 + 32 + 4 + 3);
  });

  it("declares itself an icon file so browsers and Windows recognise it", async () => {
    const blob = buildIco([{ size: 16, png: payload(1, 10) }]);
    expect(blob.type).toBe("image/x-icon");
  });

  it("refuses to build an empty icon", () => {
    expect(() => buildIco([])).toThrow(/at least one/i);
  });

  it("refuses a size the format cannot describe", () => {
    expect(() => buildIco([{ size: 512, png: payload(1, 10) }])).toThrow(/256/);
    expect(ICO_MAX_SIZE).toBe(256);
  });
});
