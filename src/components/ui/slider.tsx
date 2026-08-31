import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  getAriaLabel,
  ...props
}: SliderPrimitive.Root.Props & {
  // Forwarded to Slider.Thumb's nested <input> — the accessible name for the
  // handle Base UI actually makes focusable/keyboard-operable. An aria-label
  // on Root would land on a non-interactive wrapper <div> and be ignored by
  // screen readers, so it isn't accepted here; use getAriaLabel instead.
  getAriaLabel?: (index: number) => string
}) {
  const _values = Array.isArray(value)
    ? value
    : typeof value === "number"
      ? [value]
      : Array.isArray(defaultValue)
        ? defaultValue
        : typeof defaultValue === "number"
          ? [defaultValue]
          : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          // rounded-none: the generated pill radius is a hard 9999px in
          // Tailwind and does not resolve through the --radius-* tokens
          // (pinned to 0 for this design). Every other rounded-* class in
          // this app tracks the token; that one does not, so it must be
          // overridden explicitly here.
          className="relative grow overflow-hidden rounded-none bg-muted select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            // bg-signal: the filled portion of the quality track is one of the
            // three sanctioned uses of --signal in this app.
            className="bg-signal select-none data-horizontal:h-full data-vertical:w-full transition-[width] duration-[140ms] ease-[var(--ease)]"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            getAriaLabel={getAriaLabel}
            // rounded-none: see the Track comment above — the generated pill
            // radius does not square via the --radius tokens and must be
            // overridden explicitly.
            // focus-visible:ring-0: the primitive's own focus ring is neutralised
            // so it doesn't stack with the app-wide :focus-visible outline (index.css).
            className="relative block size-3 shrink-0 rounded-none border border-ink bg-paper transition-[box-shadow] duration-[140ms] ease-[var(--ease)] select-none after:absolute after:-inset-2 focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
