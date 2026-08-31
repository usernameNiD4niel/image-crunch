import { describe, it, expect, vi, beforeEach } from "vitest";
import { EncodeClient, StaleResult, trackUrl, releaseUrl, releaseAll } from "./client";

describe("blob-URL registry", () => {
  beforeEach(() => {
    // jsdom's URL.revokeObjectURL is a no-op stub; spy on it so we can
    // assert it is called the right number of times without depending
    // on real object-URL semantics.
    vi.restoreAllMocks();
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  it("trackUrl returns the url unchanged and registers it", () => {
    expect(trackUrl("blob:a")).toBe("blob:a");
  });

  it("releaseUrl revokes a tracked url exactly once, even if called twice", () => {
    trackUrl("blob:b");
    releaseUrl("blob:b");
    releaseUrl("blob:b");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:b");
  });

  it("releaseUrl on an untracked url does nothing", () => {
    releaseUrl("blob:never-tracked");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("releaseAll revokes every remaining tracked url and clears the registry", () => {
    trackUrl("blob:c");
    trackUrl("blob:d");
    releaseAll();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:c");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:d");

    // Registry is empty now: a second releaseAll revokes nothing new.
    vi.mocked(URL.revokeObjectURL).mockClear();
    releaseAll();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});

describe("EncodeClient generation bookkeeping", () => {
  // jsdom has neither OffscreenCanvas nor Worker, so the client always
  // constructs in main-thread-fallback mode here — no real Worker is
  // ever spun up. That keeps this a thin, honest check of the counter
  // and lifecycle logic rather than a mock of the worker protocol.

  it("bumpGeneration increments and returns the new generation", () => {
    const client = new EncodeClient();
    expect(client.bumpGeneration()).toBe(1);
    expect(client.bumpGeneration()).toBe(2);
    expect(client.bumpGeneration()).toBe(3);
    client.dispose();
  });

  it("dispose is safe to call with nothing pending and safe to call twice", () => {
    const client = new EncodeClient();
    expect(() => client.dispose()).not.toThrow();
    expect(() => client.dispose()).not.toThrow();
  });

  it("StaleResult is a thrown Error subclass distinguishable from a real failure", () => {
    const err = new StaleResult();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StaleResult");
  });
});
