import { useRef, type KeyboardEvent } from "react";
import { Field, FieldLabel, FieldContent } from "@/components/ui/field";
import { ButtonGroup } from "@/components/ui/button-group";
import { Slider } from "@/components/ui/slider";
import type { EncodeSettings, OutputFormat, ResizePreset } from "@/lib/engine/types";

interface ControlsProps {
  settings: EncodeSettings;
  onChange: (patch: Partial<EncodeSettings>) => void;
  onDownloadAll: () => void;
  disabled: boolean;
}

const FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "keep", label: "Keep" },
  { value: "image/jpeg", label: "JPG" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WebP" },
];

const RESIZES: { value: ResizePreset; label: string }[] = [
  { value: "none", label: "None" },
  { value: 2048, label: "2048" },
  { value: 1280, label: "1280" },
];

function segmentButtonClass(selected: boolean) {
  return `data border px-3 py-1 text-[0.8125rem] transition-colors duration-[140ms] ease-[var(--ease)] focus-visible:ring-0 ${
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
}: {
  id: string;
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
  className?: string;
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
      <FieldLabel id={`${id}-label`} className="label text-ink-72">
        {label}
      </FieldLabel>
      <FieldContent>
        <ButtonGroup role="radiogroup" aria-labelledby={`${id}-label`} className="mt-2 gap-2">
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

export function Controls({ settings, onChange, onDownloadAll, disabled }: ControlsProps) {
  return (
    <div className="sticky bottom-0 z-40 border-t border-ink bg-paper py-4">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:items-center">
        <Field className="md:col-span-4">
          <FieldLabel className="label text-ink-72">
            Quality <span className="data text-ink">{settings.quality}</span>
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

        <SegmentedField
          id="resize"
          label="Resize"
          options={RESIZES}
          value={settings.resize}
          onSelect={(resize) => onChange({ resize })}
          className="md:col-span-3"
        />

        <SegmentedField
          id="format"
          label="Format"
          options={FORMATS}
          value={settings.format}
          onSelect={(format) => onChange({ format })}
          className="md:col-span-3"
        />

        <div className="md:col-span-2 md:justify-self-end">
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
