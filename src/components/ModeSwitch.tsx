import { useRef, type KeyboardEvent } from "react";
import type { Mode } from "@/lib/engine/types";

interface ModeSwitchProps {
  mode: Mode;
  onChange: (mode: Mode) => void;
  /** Held inert while the queue owes work — a mode change mid-sweep. */
  disabled?: boolean;
}

const MODES: { value: Mode; label: string; note: string }[] = [
  {
    value: "compress",
    label: "Compress",
    note: "Re-encode to your chosen format and quality. The picture is untouched.",
  },
  {
    value: "cutout",
    label: "Remove background",
    note: "Cut the subject out on your device. Written as lossless PNG with transparency.",
  },
];

/**
 * Which of the two jobs the page is doing. Above the queue rather than down
 * in Controls because it is not a setting: it decides which settings are even
 * consulted (see effectiveSettings in plan.ts), and the user should meet it
 * before they drop a file, not after.
 *
 * The keyboard behaviour is the WAI-ARIA radiogroup pattern, matching
 * SegmentedField in Controls: one tab stop, arrows move and select, wrapping
 * at both ends. Selecting on move is affordable here for the same reason it
 * is there — every change is a debounced re-run, not a destructive commit.
 */
export function ModeSwitch({ mode, onChange, disabled = false }: ModeSwitchProps) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = Math.max(
    0,
    MODES.findIndex((option) => option.value === mode),
  );

  function select(next: Mode) {
    if (disabled) return;
    // Re-selecting the mode already on screen is not a change. The reducer
    // guards this as well, but a control that reports it anyway would leave
    // that guard as the only thing between a settled queue and a re-sweep.
    if (next === mode) return;
    onChange(next);
  }

  function move(to: number) {
    const index = (to + MODES.length) % MODES.length;
    select(MODES[index].value);
    buttonsRef.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled) return;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(MODES.length - 1);
        break;
      default:
        return; // Tab, Space, Enter and everything else stay the browser's
    }
    event.preventDefault();
  }

  return (
    <div className="mb-10 border-b border-rule pb-6">
      <p id="mode-label" className={`label ${disabled ? "text-ink-58" : "text-ink-72"}`}>
        Mode
      </p>
      <div role="radiogroup" aria-labelledby="mode-label" className="mt-3 grid gap-3 md:grid-cols-2">
        {MODES.map((option, index) => {
          const selected = option.value === mode;
          return (
            <button
              key={option.value}
              ref={(node) => {
                buttonsRef.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === checkedIndex ? 0 : -1}
              disabled={disabled}
              onClick={() => select(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`border px-4 py-4 text-left transition-colors duration-[140ms] ease-[var(--ease)] focus-visible:ring-0 disabled:opacity-[0.38] ${
                selected ? "border-ink bg-ink text-paper" : "border-rule text-ink hover:border-ink"
              }`}
            >
              <span className="label block">{option.label}</span>
              <span className={`data mt-2 block text-[0.8125rem] ${selected ? "opacity-72" : "text-ink-72"}`}>
                {option.note}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
