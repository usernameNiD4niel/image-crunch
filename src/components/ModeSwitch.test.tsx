import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ModeSwitch } from "./ModeSwitch";

afterEach(cleanup);

describe("ModeSwitch", () => {
  it("offers the two jobs as one radiogroup", () => {
    render(<ModeSwitch mode="compress" onChange={() => {}} />);

    const group = screen.getByRole("radiogroup", { name: /mode/i });
    expect(group).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("marks the mode on screen as the checked one", () => {
    render(<ModeSwitch mode="cutout" onChange={() => {}} />);

    expect(screen.getByRole("radio", { name: /remove background/i }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /compress/i }).getAttribute("aria-checked")).toBe("false");
  });

  it("asks for cut-out mode when the second option is clicked", () => {
    const onChange = vi.fn();
    render(<ModeSwitch mode="compress" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /remove background/i }));
    expect(onChange).toHaveBeenCalledWith("cutout");
  });

  it("does not re-announce the mode already on screen", () => {
    // The reducer guards this too, but a control that fires on every click of
    // the selected option makes that guard the only thing standing between a
    // settled queue and a re-sweep.
    const onChange = vi.fn();
    render(<ModeSwitch mode="compress" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /compress/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves and selects with the arrow keys, as a radiogroup does", () => {
    const onChange = vi.fn();
    render(<ModeSwitch mode="compress" onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("radio", { name: /compress/i }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("cutout");
  });

  it("keeps the group to a single tab stop", () => {
    render(<ModeSwitch mode="compress" onChange={() => {}} />);

    expect(screen.getByRole("radio", { name: /compress/i }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: /remove background/i }).getAttribute("tabindex")).toBe("-1");
  });

  it("says what cut-out mode does to the output, before it is chosen", () => {
    // Both notes are on screen in both modes, deliberately: cut-out mode
    // takes the Quality, Resize and Format controls away, and the user should
    // read that on the button they are about to press rather than discover it
    // when three controls disappear.
    render(<ModeSwitch mode="compress" onChange={() => {}} />);

    expect(screen.getByText(/lossless PNG/i)).toBeTruthy();
  });

  it("describes compress mode as leaving the picture alone", () => {
    render(<ModeSwitch mode="cutout" onChange={() => {}} />);

    expect(screen.getByText(/picture is untouched/i)).toBeTruthy();
  });

  it("can be held inert while the queue is busy", () => {
    const onChange = vi.fn();
    render(<ModeSwitch mode="compress" onChange={onChange} disabled />);

    fireEvent.click(screen.getByRole("radio", { name: /remove background/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
