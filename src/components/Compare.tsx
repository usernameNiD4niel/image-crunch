import { useEffect, useState } from "react";
import type { EncodeResult, QueueItem } from "@/lib/engine/types";
import { releaseUrl, trackUrl } from "@/lib/engine/client";

interface CompareProps {
  item: QueueItem;
  result: EncodeResult;
}

export function Compare({ item, result }: CompareProps) {
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [split, setSplit] = useState(50);

  // The output blob URL is derived state, not something we can compute at
  // render time: URL.createObjectURL must run exactly once per blob and be
  // revoked exactly once when that blob is replaced or this panel unmounts.
  // Doing it in render would mint a new (leaked) URL on every re-render —
  // e.g. every tick of the split slider above.
  useEffect(() => {
    const url = trackUrl(URL.createObjectURL(result.blob));
    setOutputUrl(url);
    return () => releaseUrl(url);
  }, [result.blob]);

  // Clip the compressed image inside a container sized to `split`% of the
  // frame, then compensate the inner <img> width so it renders at the same
  // scale as the uncropped original underneath — otherwise the clipped side
  // would squash horizontally and the two images would show different
  // effective zoom levels. `10000 / split` divides by zero at split === 0,
  // so the compressed layer (and its width math) is skipped entirely there;
  // at split === 100 the container is full width and the compensation is a
  // no-op (100%).
  const showCompressed = outputUrl && split > 0;

  return (
    <div className="mt-4 border border-rule bg-paper-2 p-4">
      <div className="relative aspect-video overflow-hidden bg-paper-2">
        <img
          src={item.previewUrl}
          alt={`Original ${item.source.name}`}
          className="absolute inset-0 h-full w-full object-contain"
        />
        {showCompressed && (
          <div className="absolute inset-0 overflow-hidden" style={{ width: `${split}%` }}>
            <img
              src={outputUrl}
              alt={`Compressed ${item.source.name}`}
              className="absolute inset-0 h-full w-full object-contain"
              style={{ width: `${10000 / split}%` }}
            />
          </div>
        )}
        <div
          className="absolute inset-y-0 w-px bg-ink"
          style={{ left: `${split}%` }}
          aria-hidden
        />
      </div>

      {/* The visible label IS the accessible name — there is no separate
          aria-label, so a sighted user and a screen-reader user call this
          control the same thing. */}
      <label className="label mt-3 block text-ink-60" htmlFor={`split-${item.id}`}>
        Divider
      </label>
      {/*
        A plain range input, not the shared <Slider>: Slider's Indicator is
        hard-coded to bg-signal (the quality track's one sanctioned use of
        --signal per the design system), and its fill is transitioned
        (transition-[width]) for discrete state changes. Reusing it here
        would (a) make the divider red — a fourth, disallowed use of
        --signal — and (b) lag the fill behind the pointer while dragging,
        since CSS transitions fight live drag input. A bare input keeps the
        divider ink-colored and untransitioned.
      */}
      <input
        id={`split-${item.id}`}
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        className="w-full accent-[var(--ink)]"
      />

      <div className="data mt-2 flex justify-between text-[0.8125rem] text-ink-60">
        <span>COMPRESSED</span>
        <span>ORIGINAL</span>
      </div>
    </div>
  );
}
