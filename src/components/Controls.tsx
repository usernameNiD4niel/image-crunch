import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Field, FieldLabel, FieldContent } from "@/components/ui/field";
import { ButtonGroup } from "@/components/ui/button-group";
import { Slider } from "@/components/ui/slider";
import type { EncodeSettings, IconSize, OutputFormat, ResizePreset } from "@/lib/engine/types";
import { ICON_SIZES } from "@/lib/engine/plan";

interface ControlsProps {
  settings: EncodeSettings;
  onChange: (patch: Partial<EncodeSettings>) => void;
  onDownloadAll: () => void;
  onReset: () => void;
  disabled: boolean;
}

const FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "keep", label: "Keep" },
  { value: "image/jpeg", label: "JPG" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WebP" },
  { value: "image/x-icon", label: "ICO" },
];

const ICONS: { value: IconSize; label: string }[] = ICON_SIZES.map((size) => ({
  value: size,
  label: String(size),
}));

const RESIZES: { value: ResizePreset; label: string }[] = [
  { value: "none", label: "None" },
  { value: 2048, label: "2048" },
  { value: 1280, label: "1280" },
];

function segmentButtonClass(selected: boolean) {
  return `data border px-3 py-1 text-[0.8125rem] transition-colors duration-[140ms] ease-[var(--ease)] focus-visible:ring-0 disabled:opacity-[0.38] ${
    selected ? "border-ink bg-ink text-paper" : "border-rule text-ink-72"
  }`;
}

/**
 * One labelled radiogroup of segmented buttons. Resize and Format are the
 * same control with different options; writing them twice meant two places
 * to keep the label wiring, the roles and the selected styling in step.
 *
 * Keyboard behaviour is the WAI-ARIA radiogroup pattern, not seven tab
 * stops: the group is a single stop (roving tabindex — only the checked
 * option is reachable with Tab) and the arrow keys move within it, wrapping
 * at both ends, with Home/End for the extremes. Moving selects, which is
 * what the pattern specifies and what this control can afford: every change
 * is a debounced re-encode, not a destructive commit.
 */
function SegmentedField<T>({
  id,
  label,
  options,
  value,
  onSelect,
  className,
  disabled = false,
}: {
  id: string;
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
  className?: string;
  /** Renders the whole group inert — for a setting the current format ignores. */
  disabled?: boolean;
}) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // The checked option, or the first one when the value is somehow not in
  // the list — a group with no tabbable member is a keyboard trap in
  // reverse: Tab would skip the control entirely.
  const checkedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  function move(to: number) {
    const index = (to + options.length) % options.length;
    onSelect(options[index].value);
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
        move(options.length - 1);
        break;
      default:
        return; // Tab, Space, Enter and everything else stay the browser's
    }
    // Only for the keys handled above: arrows would otherwise scroll the
    // page and Home/End would jump it to top or bottom.
    event.preventDefault();
  }

  return (
    <Field className={className}>
      <FieldLabel id={`${id}-label`} className={`label ${disabled ? "text-ink-58" : "text-ink-72"}`}>
        {label}
      </FieldLabel>
      <FieldContent>
        <ButtonGroup role="radiogroup" aria-labelledby={`${id}-label`} className="mt-2 flex-wrap gap-2">
          {options.map((option, index) => (
            <button
              key={String(option.value)}
              ref={(node) => {
                buttonsRef.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={value === option.value}
              tabIndex={index === checkedIndex ? 0 : -1}
              disabled={disabled}
              onClick={() => onSelect(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={segmentButtonClass(value === option.value)}
            >
              {option.label}
            </button>
          ))}
        </ButtonGroup>
      </FieldContent>
    </Field>
  );
}

// How long an armed reset stays hot. Long enough to move the pointer and
// read the word, short enough that a button left armed and forgotten is not
// still waiting to wipe the queue when the user comes back.
const ARM_TIMEOUT_MS = 4000;

/**
 * Clear-the-queue, in two clicks. Emptying a 30-file queue cannot be undone
 * — the files are gone from the page and the object URLs are revoked — so
 * the first click only arms the button and the second one means it. The
 * confirmation is the button itself rather than a modal: it is one control's
 * worth of consequence, and a dialog over the queue would hide the very
 * thing being cleared. It disarms on blur and on a timeout, so a stray click
 * cannot leave a live trigger sitting in the toolbar.
 *
 * Never --signal, armed or not: the signal colour is the download action's.
 */
function ResetButton({ onReset }: { onReset: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onReset();
      }}
      onBlur={() => setArmed(false)}
      className={`label border px-3 py-3 transition-colors duration-[140ms] ease-[var(--ease)] focus-visible:ring-0 ${
        armed ? "border-ink bg-ink text-paper" : "border-ink text-ink hover:bg-ink hover:text-paper"
      }`}
    >
      {armed ? "Sure?" : "Reset"}
    </button>
  );
}

export function Controls({ settings, onChange, onDownloadAll, onReset, disabled }: ControlsProps) {
  // An .ico carries lossless PNGs at fixed square sizes: the quality slider
  // has nothing to act on and the resize presets are overridden by the icon
  // bundle. Both stay on screen — the settings still exist, and the user is
  // one click from a format that uses them — but inert, because a control
  // that moves without changing the output is worse than one that is plainly
  // not in play.
  const ico = settings.format === "image/x-icon";

  return (
    <div className="sticky bottom-0 z-40 border-t border-ink bg-paper py-4">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:items-center">
        <Field className={ico ? "md:col-span-2 opacity-[0.38]" : "md:col-span-4"}>
          <FieldLabel className="label text-ink-72">
            Quality <span className="data text-ink">{ico ? "—" : settings.quality}</span>
          </FieldLabel>
          <FieldContent>
            <Slider
              // FieldLabel above is decorative here (no htmlFor) because the
              // interactive element Base UI actually renders is a nested
              // <input> inside Slider.Thumb, not something the Root's id can
              // reach — getAriaLabel forwards the accessible name directly to
              // that input (see the comment on Slider in ui/slider.tsx).
              getAriaLabel={() => "Quality"}
              min={10}
              max={100}
              step={5}
              value={settings.quality}
              disabled={ico}
              onValueChange={(value) => {
                // Base UI's Slider.onValueChange signature is
                // (value: number | readonly number[], eventDetails) => void —
                // not Radix's (value: number[]) => void. The wrapper in
                // ui/slider.tsx doesn't pin the Value generic, so TS still
                // sees the union here even though this is a single-thumb
                // slider; narrow with Array.isArray rather than casting.
                onChange({ quality: Array.isArray(value) ? value[0] : value });
              }}
              className="mt-3"
            />
          </FieldContent>
        </Field>

        {/* Resize stays on screen under ICO but inert: the preset is still
            the user's, and it comes back the moment they leave ICO — it is
            simply not what decides an icon's size. Icon appears beside it,
            taking the width Quality and Resize give up. */}
        <SegmentedField
          id="resize"
          label="Resize"
          options={RESIZES}
          value={settings.resize}
          onSelect={(resize) => onChange({ resize })}
          disabled={ico}
          className={ico ? "md:col-span-2" : "md:col-span-3"}
        />

        {ico && (
          <SegmentedField
            id="icon"
            label="Icon"
            options={ICONS}
            value={settings.icon}
            onSelect={(icon) => onChange({ icon })}
            className="md:col-span-3"
          />
        )}

        <SegmentedField
          id="format"
          label="Format"
          options={FORMATS}
          value={settings.format}
          onSelect={(format) => onChange({ format })}
          className="md:col-span-3"
        />

        <div className="flex items-center gap-3 md:col-span-2 md:justify-self-end">
          <ResetButton onReset={onReset} />
          <button
            type="button"
            onClick={onDownloadAll}
            disabled={disabled}
            className="label bg-signal px-5 py-3 text-signal-ink transition-opacity duration-[140ms] ease-[var(--ease)] hover:opacity-90 focus-visible:ring-0 disabled:opacity-[0.38]"
          >
            ↓ All · Zip
          </button>
        </div>
      </div>
    </div>
  );
}
