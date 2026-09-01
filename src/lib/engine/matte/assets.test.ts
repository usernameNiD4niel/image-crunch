import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { MODEL_BASE, MODEL_FILES, DTYPE_FOR_DEVICE, pickDevice, isModelPresent } from "./assets";

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

  it("checks the weights file for the device that will actually load it", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([8, 6]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    })) as Mock<typeof fetch>;
    await isModelPresent("webgpu", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/models/briaai/RMBG-1.4/onnx/model.onnx");
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
