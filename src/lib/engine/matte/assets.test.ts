import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import {
  MODEL_BASE,
  MODEL_FILES,
  DTYPE_FOR_DEVICE,
  ORT_WASM_BASE,
  localWasmPaths,
  pickDevice,
  isModelPresent,
} from "./assets";

const gpuDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, "gpu");

afterEach(() => {
  if (gpuDescriptor) Object.defineProperty(globalThis.navigator, "gpu", gpuDescriptor);
  else delete (globalThis.navigator as unknown as Record<string, unknown>).gpu;
});

describe("model assets", () => {
  it("names the file each backend loads", () => {
    // fp16 weights are saved as model.onnx because that is the name the
    // loader asks for; see the plan's Global Constraints.
    expect(MODEL_FILES.webgpu).toBe("model.onnx");
    expect(MODEL_FILES.wasm).toBe("model_quantized.onnx");
    expect(MODEL_BASE).toBe("/models/briaai/RMBG-1.4");
  });

  // Measured in the spike: q8 is ~10x slower than fp16 on WebGPU and no
  // faster than WASM, so the pairing is not arbitrary.
  it("pairs each device with the dtype measured fastest for it", () => {
    expect(DTYPE_FOR_DEVICE.webgpu).toBe("fp32");
    expect(DTYPE_FOR_DEVICE.wasm).toBe("q8");
  });

  it("chooses webgpu when the browser exposes it, wasm otherwise", () => {
    Object.defineProperty(globalThis.navigator, "gpu", { value: {}, configurable: true });
    expect(pickDevice()).toBe("webgpu");
    delete (globalThis.navigator as unknown as Record<string, unknown>).gpu;
    expect(pickDevice()).toBe("wasm");
  });

  // The app's own copy promises the image never leaves the device. That is
  // a claim about the RUNTIME as well as the pixels: transformers.js
  // defaults the ONNX Runtime's WASM binaries to cdn.jsdelivr.net, so
  // without a local override the first cut-out hands a third party the
  // user's IP, UA and referrer — and the feature dies offline or under a
  // strict CSP.
  it("serves the ONNX runtime from this origin, never a CDN", () => {
    expect(ORT_WASM_BASE).toBe("/models/ort/");
    expect(ORT_WASM_BASE.startsWith("/")).toBe(true);
  });

  it("re-points the paths transformers.js chose at this origin, keeping its filenames", () => {
    const cdn = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/";
    const rewritten = localWasmPaths({
      mjs: `${cdn}ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${cdn}ort-wasm-simd-threaded.asyncify.wasm`,
    });

    expect(rewritten).toEqual({
      mjs: "/models/ort/ort-wasm-simd-threaded.asyncify.mjs",
      wasm: "/models/ort/ort-wasm-simd-threaded.asyncify.wasm",
    });
    expect(JSON.stringify(rewritten)).not.toContain("jsdelivr");
  });

  it("falls back to the local prefix when nothing has been set", () => {
    expect(localWasmPaths(undefined)).toBe(ORT_WASM_BASE);
    expect(localWasmPaths("")).toBe(ORT_WASM_BASE);
  });

  // Reading the source, because the worker cannot be imported here (it is a
  // module worker that loads an 88 MB model on first message) and because
  // WHEN the override happens is the whole point: transformers.js sets its
  // CDN default at import time, and onnxruntime-web reads wasmPaths when a
  // session is created. An override written after the first load would be
  // silently too late.
  it("has the worker apply the local paths before it ever loads a model", () => {
    const source = readFileSync("src/lib/engine/matte/worker.ts", "utf8");
    expect(source).toContain("localWasmPaths");
    expect(source.indexOf("localWasmPaths")).toBeLessThan(source.indexOf("from_pretrained"));
  });

  it("checks the weights file for the device that will actually load it", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([8, 6]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    })) as Mock<typeof fetch>;
    await isModelPresent("webgpu", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/models/briaai/RMBG-1.4/onnx/model.onnx");
  });

  // The file being asked about is 88 MB. A presence check that reads it is
  // not a check, it is the download — so ask for one byte, and drop even
  // that.
  it("asks for one byte and abandons the body", async () => {
    const body = new Response(new Uint8Array([8, 6]), {
      status: 206,
      headers: { "content-type": "application/octet-stream" },
    });
    const fetchImpl = vi.fn(async () => body) as Mock<typeof fetch>;

    await expect(isModelPresent("wasm", fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit)?.headers).toMatchObject({
      Range: "bytes=0-0",
    });
    expect(body.bodyUsed).toBe(true);
  });

  it("reports the model present when the server returns real bytes", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([8, 6, 18, 7]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }));
    await expect(isModelPresent("wasm", fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
  });

  // A dev server answers a missing file with index.html and a 200, which is
  // how the spike's protobuf parse failure happened. A status check alone
  // would call that "present".
  it("reports the model missing when the server answers with HTML", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!doctype html><html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    await expect(isModelPresent("wasm", fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("reports the model missing when the request fails outright", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network");
    });
    await expect(isModelPresent("wasm", fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });
});
