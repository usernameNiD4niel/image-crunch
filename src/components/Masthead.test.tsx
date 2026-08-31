import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Masthead } from "./Masthead";

afterEach(cleanup);

const totalsOf = (overrides: Partial<{ count: number; input: number; output: number; percent: number }> = {}) => ({
  count: 0,
  input: 0,
  output: 0,
  percent: 0,
  ...overrides,
});

describe("Masthead", () => {
  it("renders IDLE when there are no files", () => {
    render(
      <Masthead count={0} working={0} errors={0} totals={totalsOf()} onDownloadAll={() => {}} />,
    );
    expect(screen.getByText("IDLE · 0 FILES")).toBeTruthy();
  });

  it("renders WORKING while a sweep is in progress", () => {
    render(
      <Masthead count={3} working={2} errors={0} totals={totalsOf()} onDownloadAll={() => {}} />,
    );
    expect(screen.getByText("WORKING · 2 OF 3")).toBeTruthy();
  });

  it("renders a queued fallback instead of going blank when files exist, none are working, and none have completed yet", () => {
    render(
      <Masthead count={2} working={0} errors={0} totals={totalsOf()} onDownloadAll={() => {}} />,
    );
    expect(screen.getByText("2 FILES · QUEUED")).toBeTruthy();
  });

  it("renders a failed fallback when every queued file errored", () => {
    render(
      <Masthead count={2} working={0} errors={2} totals={totalsOf()} onDownloadAll={() => {}} />,
    );
    expect(screen.getByText("2 FILES · 2 FAILED")).toBeTruthy();
  });

  it("shows a minus sign for a positive saving", () => {
    render(
      <Masthead
        count={1}
        working={0}
        errors={0}
        totals={totalsOf({ count: 1, input: 100, output: 13, percent: 87.1 })}
        onDownloadAll={() => {}}
      />,
    );
    expect(screen.getByText("−87.1%")).toBeTruthy();
  });

  it("shows a plus sign, not a garbled double minus, when the output grew", () => {
    render(
      <Masthead
        count={1}
        working={0}
        errors={0}
        totals={totalsOf({ count: 1, input: 100, output: 112, percent: -12.3 })}
        onDownloadAll={() => {}}
      />,
    );
    expect(screen.getByText("+12.3%")).toBeTruthy();
    expect(screen.queryByText(/−-/)).toBeNull();
  });

  it("shows no sign at exactly zero savings", () => {
    render(
      <Masthead
        count={1}
        working={0}
        errors={0}
        totals={totalsOf({ count: 1, input: 100, output: 100, percent: 0 })}
        onDownloadAll={() => {}}
      />,
    );
    expect(screen.getByText("0.0%")).toBeTruthy();
  });
});
