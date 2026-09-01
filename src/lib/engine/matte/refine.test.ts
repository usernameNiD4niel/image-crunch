import { describe, it, expect } from "vitest";
import { normalizeMask, applyMaskAsAlpha, decontaminateEdges, SOLID_ALPHA } from "./refine";

describe("normalizeMask", () => {
  // The q8 build tops out at 254, so "opaque" pixels would come out
  // fractionally transparent and composite wrong on every background.
  it("rescales a mask whose maximum is 254 so the maximum becomes 255", () => {
    const mask = normalizeMask(new Uint8Array([0, 127, 254]));
    expect(mask[2]).toBe(255);
    expect(mask[0]).toBe(0);
    expect(mask[1]).toBe(128);
  });

  it("leaves a mask that already reaches 255 untouched", () => {
    const mask = normalizeMask(new Uint8Array([0, 128, 255]));
    expect([...mask]).toEqual([0, 128, 255]);
  });

  it("leaves an all-zero mask alone rather than dividing by zero", () => {
    const mask = normalizeMask(new Uint8Array([0, 0, 0]));
    expect([...mask]).toEqual([0, 0, 0]);
  });
});

describe("applyMaskAsAlpha", () => {
  it("writes the mask into the alpha channel and leaves RGB untouched", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    applyMaskAsAlpha(rgba, new Uint8Array([255, 0]));

    expect([...rgba]).toEqual([10, 20, 30, 255, 40, 50, 60, 0]);
  });

  it("throws when the mask does not describe every pixel", () => {
    const rgba = new Uint8ClampedArray(8);
    expect(() => applyMaskAsAlpha(rgba, new Uint8Array([255]))).toThrow(/pixel/i);
  });
});

describe("decontaminateEdges", () => {
  // A half-transparent edge pixel holds a blend of subject and the
  // background that was just removed. Left as-is it shows up as a halo.
  it("replaces a partially transparent pixel's colour with its solid neighbour's", () => {
    // 2x1: [solid red][half-transparent green-contaminated]
    const rgba = new Uint8ClampedArray([200, 0, 0, 255, 0, 200, 0, 128]);
    decontaminateEdges(rgba, 2, 1);

    expect([...rgba.slice(4, 7)]).toEqual([200, 0, 0]);
    expect(rgba[7]).toBe(128); // alpha is not touched
  });

  it("leaves fully opaque pixels alone", () => {
    const rgba = new Uint8ClampedArray([200, 0, 0, 255, 0, 200, 0, 255]);
    decontaminateEdges(rgba, 2, 1);
    expect([...rgba]).toEqual([200, 0, 0, 255, 0, 200, 0, 255]);
  });

  it("leaves fully transparent pixels alone", () => {
    const rgba = new Uint8ClampedArray([200, 0, 0, 255, 9, 9, 9, 0]);
    decontaminateEdges(rgba, 2, 1);
    expect([...rgba.slice(4)]).toEqual([9, 9, 9, 0]);
  });

  it("leaves an edge pixel with no solid neighbour alone rather than inventing a colour", () => {
    const rgba = new Uint8ClampedArray([5, 6, 7, 128, 9, 9, 9, 0]);
    decontaminateEdges(rgba, 2, 1);
    expect([...rgba.slice(0, 3)]).toEqual([5, 6, 7]);
  });

  it("treats SOLID_ALPHA and above as solid", () => {
    expect(SOLID_ALPHA).toBe(250);
  });
});
