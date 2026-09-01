import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Notices } from "./Notices";

afterEach(cleanup);

describe("Notices", () => {
  it("shows every standing notice, not just the most recent one", () => {
    render(
      <Notices
        notices={[
          { id: 1, message: "3 unsupported file(s) skipped." },
          { id: 2, message: "1 file(s) could not be read." },
        ]}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByText("3 unsupported file(s) skipped.")).toBeTruthy();
    expect(screen.getByText("1 file(s) could not be read.")).toBeTruthy();
  });

  it("dismisses the notice whose × was pressed, by id", () => {
    const onDismiss = vi.fn();
    render(
      <Notices
        notices={[
          { id: 1, message: "first" },
          { id: 2, message: "second" },
        ]}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice: second" }));
    expect(onDismiss).toHaveBeenCalledWith(2);
  });

  it("renders nothing when there is nothing to report", () => {
    const { container } = render(<Notices notices={[]} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
