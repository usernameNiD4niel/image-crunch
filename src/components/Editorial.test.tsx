import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Editorial } from "./Editorial";

afterEach(cleanup);

describe("Editorial", () => {
  // Entry 01 claims nothing leaves the browser. Background removal
  // downloads a model, which is the opposite direction — but it is a
  // network request, and the copy has to account for it or it is a lie by
  // omission.
  it("says the background model is downloaded from this site and runs locally", () => {
    render(<Editorial />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/background/i);
    expect(text).toMatch(/downloaded once/i);
    expect(text).toMatch(/never leave|never travel/i);
  });
});
