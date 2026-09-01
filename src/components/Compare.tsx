import { useEffect, useState } from "react";
import type { EncodeResult, QueueItem } from "@/lib/engine/types";
import { formatBytes, formatLabel } from "@/lib/engine/plan";
import { releaseUrl, trackUrl } from "@/lib/engine/client";

interface CompareProps {
  item: QueueItem;
  result: EncodeResult;
}

/** One captioned pane. The caption is a real <figcaption>, not a loose row of
 *  text under an image, so each pane carries its own size and format with it. */
function Pane({ src, alt, label, bytes, format }: {
  src: string;
  alt: string;
  label: string;
  bytes: number;
  format: string;
}) {
  return (
    <figure className="min-w-0">
      <div className="aspect-video overflow-hidden border border-rule bg-paper">
        <img src={src} alt={alt} className="h-full w-full object-contain" />
      </div>
      <figcaption className="data mt-2 flex flex-wrap items-baseline gap-x-2 text-[0.8125rem] text-ink-72">
        <span className="label">{label}</span>
        <span>
          {formatBytes(bytes)} · {format}
        </span>
      </figcaption>
    </figure>
  );
}

export function Compare({ item, result }: CompareProps) {
  const [outputUrl, setOutputUrl] = useState<string | null>(null);

  // The output blob URL is derived state, not something we can compute at
  // render time: URL.createObjectURL must run exactly once per blob and be
  // revoked exactly once when that blob is replaced or this panel unmounts.
  // Doing it in render would mint a new (leaked) URL on every re-render.
  useEffect(() => {
    const url = trackUrl(URL.createObjectURL(result.blob));
    setOutputUrl(url);
    return () => releaseUrl(url);
  }, [result.blob]);

  return (
    <div className="mt-4 border border-rule bg-paper-2 p-4">
      {/* Two panes side by side at every width, compressed first: the two
          images are being compared, and one drawn on top of the other — the
          old clipped overlay and its divider — meant neither could be seen
          whole. Below 640px each pane is narrow rather than stacked, which is
          the layout this panel is for. */}
      <div data-compare-row className="grid grid-cols-2 gap-4">
        {outputUrl && (
          <Pane
            src={outputUrl}
            alt={`Compressed ${item.source.name}`}
            label="Compressed"
            bytes={result.size}
            format={formatLabel(result.mime)}
          />
        )}
        <Pane
          src={item.previewUrl}
          alt={`Original ${item.source.name}`}
          label="Original"
          bytes={item.source.size}
          format={formatLabel(item.source.type)}
        />
      </div>
    </div>
  );
}
