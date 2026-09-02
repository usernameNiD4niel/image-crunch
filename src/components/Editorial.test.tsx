import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
    // Match the new sentence as a contiguous claim to ensure it makes the
    // central honesty claim: the model is downloaded once from this site,
    // runs on the device, and images never leave it. This fails if the
    // sentence is deleted, reworded to drop the origin, or changed to say
    // images do leave the device.
    expect(text).toMatch(
      /removing a background.*downloaded once.*this site.*on your device.*never leave/is
    );
  });
});
