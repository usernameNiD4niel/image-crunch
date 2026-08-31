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
    selected ? "border-ink bg-ink text-paper" : "border-rule text-ink-60"
  }`;
}

export function Controls({ settings, onChange, onDownloadAll, disabled }: ControlsProps) {
  return (
    <div className="sticky bottom-0 z-40 border-t border-ink bg-paper py-4">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:items-center">
        <Field className="md:col-span-4">
          <FieldLabel className="label text-ink-60">
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

        <Field className="md:col-span-3">
          <FieldLabel id="resize-label" className="label text-ink-60">
            Resize
          </FieldLabel>
          <FieldContent>
            <ButtonGroup
              role="radiogroup"
              aria-labelledby="resize-label"
              className="mt-2 gap-2"
            >
              {RESIZES.map((r) => (
                <button
                  key={String(r.value)}
                  type="button"
                  role="radio"
                  aria-checked={settings.resize === r.value}
                  onClick={() => onChange({ resize: r.value })}
                  className={segmentButtonClass(settings.resize === r.value)}
                >
                  {r.label}
                </button>
              ))}
            </ButtonGroup>
          </FieldContent>
        </Field>

        <Field className="md:col-span-3">
          <FieldLabel id="format-label" className="label text-ink-60">
            Format
          </FieldLabel>
          <FieldContent>
            <ButtonGroup
              role="radiogroup"
              aria-labelledby="format-label"
              className="mt-2 gap-2"
            >
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.format === f.value}
                  onClick={() => onChange({ format: f.value })}
                  className={segmentButtonClass(settings.format === f.value)}
                >
                  {f.label}
                </button>
              ))}
            </ButtonGroup>
          </FieldContent>
        </Field>

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
