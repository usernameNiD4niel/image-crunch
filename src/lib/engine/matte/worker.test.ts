import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A 4x4 image is plenty: nothing here is testing the pixels, only how many
// times the model is loaded and how many inferences run at once.
const W = 4;
const H = 4;

const settle = () => new Promise((r) => setTimeout(r, 0));

let loads = 0;
let inflight = 0;
let maxInflight = 0;

const infer = vi.fn(async () => {
  inflight += 1;
  maxInflight = Math.max(maxInflight, inflight);
  await settle();
  inflight -= 1;
  return { output: [{ mul: () => ({ to: () => ({}) }) }] };
});

const process = vi.fn(async () => ({ pixel_values: {} }));

vi.mock("@huggingface/transformers", () => {
  const from_pretrained = async () => {
    loads += 1;
    // Slow on purpose: the whole point is what a SECOND request does while
    // the first one's load is still in flight.
    await settle();
    await settle();
    return infer;
  };
  return {
    env: {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: "",
      backends: { onnx: { wasm: { wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1/dist/" } } },
    },
    AutoModel: { from_pretrained },
    AutoProcessor: { from_pretrained: async () => process },
    RawImage: {
      fromBlob: async () => ({ width: W, height: H }),
      fromTensor: () => ({ resize: async () => ({ data: new Uint8Array(W * H).fill(255) }) }),
    },
  };
});

class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {
      drawImage: () => {},
      putImageData: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(W * H * 4) }),
    };
  }
  async convertToBlob() {
    return new Blob([new Uint8Array(4)], { type: "image/png" });
  }
}

const saved: Record<string, unknown> = {};
let posted: unknown[] = [];

beforeEach(() => {
  loads = 0;
  inflight = 0;
  maxInflight = 0;
  posted = [];
  infer.mockClear();
  const g = globalThis as Record<string, unknown>;
  saved.OffscreenCanvas = g.OffscreenCanvas;
  saved.createImageBitmap = g.createImageBitmap;
  saved.postMessage = self.postMessage;
  g.OffscreenCanvas = FakeCanvas;
  g.createImageBitmap = async () => ({ close: () => {} });
  self.postMessage = ((message: unknown) => posted.push(message)) as typeof self.postMessage;
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  g.OffscreenCanvas = saved.OffscreenCanvas;
  g.createImageBitmap = saved.createImageBitmap;
  self.postMessage = saved.postMessage as typeof self.postMessage;
  self.onmessage = null;
  vi.resetModules();
});

async function loadWorker() {
  vi.resetModules();
  await import("./worker");
  return (data: unknown) => self.onmessage!({ data } as MessageEvent);
}

function request(seq: number) {
  return {
    type: "matte",
    id: `row-${seq}`,
    generation: 0,
    seq,
    file: new File([], "photo.png", { type: "image/png" }),
  };
}

describe("matte worker", () => {
  // The ✂ button is disabled per ROW, so pressing it on row A and then row
  // B posts two messages that both arrive before either has loaded
  // anything. Without a memo they both call from_pretrained: a second
  // 88 MB download, and two copies of the model held in one module scope.
  it("loads the model once for two requests that arrive together", async () => {
    const send = await loadWorker();

    send(request(0));
    send(request(1));
    await vi.waitFor(() => expect(posted).toHaveLength(2));

    expect(loads).toBe(1);
    expect(posted.every((m) => (m as { type: string }).type === "done")).toBe(true);
  });

  it("runs one inference at a time", async () => {
    const send = await loadWorker();

    send(request(0));
    send(request(1));
    send(request(2));
    await vi.waitFor(() => expect(posted).toHaveLength(3));

    expect(infer).toHaveBeenCalledTimes(3);
    expect(maxInflight).toBe(1);
  });

  it("answers every request, each with its own seq", async () => {
    const send = await loadWorker();

    send(request(0));
    send(request(1));
    await vi.waitFor(() => expect(posted).toHaveLength(2));

    expect(posted.map((m) => (m as { seq: number }).seq)).toEqual([0, 1]);
  });

  it("points the ONNX runtime at this origin before loading anything", async () => {
    await loadWorker();
    const { env } = await import("@huggingface/transformers");

    expect(JSON.stringify(env.backends.onnx.wasm.wasmPaths)).not.toContain("jsdelivr");
    expect(JSON.stringify(env.backends.onnx.wasm.wasmPaths)).toContain("/models/ort/");
    expect(env.allowRemoteModels).toBe(false);
  });
});
