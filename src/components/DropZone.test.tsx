import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { DropZone } from "./DropZone";

afterEach(cleanup);

function fileWithSize(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function changeWith(container: HTMLElement, files: File[]) {
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

const OK_SIZE = 1024;
const TOO_BIG = 36 * 1024 * 1024; // over the 35 MB cap

describe("DropZone screening", () => {
  it("passes through every file when all are within limits, with no screening message", () => {
    const onFiles = vi.fn();
    const { container } = render(<DropZone onFiles={onFiles} />);
    const a = fileWithSize("a.png", "image/png", OK_SIZE);
    const b = fileWithSize("b.jpg", "image/jpeg", OK_SIZE);

    changeWith(container, [a, b]);

    expect(onFiles).toHaveBeenCalledWith([a, b], null);
  });

  it("reports only the oversized files as skipped when that is the only rejection", () => {
    const onFiles = vi.fn();
    const { container } = render(<DropZone onFiles={onFiles} />);
    const ok = fileWithSize("a.png", "image/png", OK_SIZE);
    const big = fileWithSize("big.png", "image/png", TOO_BIG);

    changeWith(container, [ok, big]);

    expect(onFiles).toHaveBeenCalledWith([ok], "1 file(s) over 35 MB skipped.");
  });

  it("reports only the unsupported files as skipped when that is the only rejection", () => {
    const onFiles = vi.fn();
    const { container } = render(<DropZone onFiles={onFiles} />);
    const ok = fileWithSize("a.png", "image/png", OK_SIZE);
    const wrong = fileWithSize("a.bmp", "image/bmp", OK_SIZE);

    changeWith(container, [ok, wrong]);

    expect(onFiles).toHaveBeenCalledWith([ok], "1 unsupported file(s) skipped.");
  });

  it("combines both rejection categories into one message when a drop has both", () => {
    const onFiles = vi.fn();
    const { container } = render(<DropZone onFiles={onFiles} />);
    const ok = fileWithSize("a.png", "image/png", OK_SIZE);
    const big = fileWithSize("big.png", "image/png", TOO_BIG);
    const wrong = fileWithSize("a.bmp", "image/bmp", OK_SIZE);

    changeWith(container, [ok, big, wrong]);

    expect(onFiles).toHaveBeenCalledWith(
      [ok],
      "1 file(s) over 35 MB and 1 unsupported file(s) skipped.",
    );
  });

  it("does not double-count a file that is both oversized and unsupported", () => {
    const onFiles = vi.fn();
    const { container } = render(<DropZone onFiles={onFiles} />);
    const bigAndWrong = fileWithSize("both.bmp", "image/bmp", TOO_BIG);

    changeWith(container, [bigAndWrong]);

    expect(onFiles).toHaveBeenCalledWith([], "1 file(s) over 35 MB skipped.");
  });
});
