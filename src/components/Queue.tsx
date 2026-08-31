import { useState } from "react";
import type { QueueItem } from "@/lib/engine/types";
import { formatBytes, formatPercent } from "@/lib/engine/plan";
import { QueueRow } from "@/components/QueueRow";

interface QueueProps {
  items: QueueItem[];
  totals: { count: number; input: number; output: number; percent: number };
  onDownloadOne: (item: QueueItem) => void;
  onRemove: (item: QueueItem) => void;
}

export function Queue({ items, totals, onDownloadOne, onRemove }: QueueProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section aria-labelledby="queue-heading">
      <div className="flex items-baseline justify-between border-b border-ink pb-2">
        {/* A real h2, styled as a label: the queue is a section of the page
            and belongs in the heading outline under the h1 statement. */}
        <h2 id="queue-heading" className="label">
          Queue
        </h2>
        <span className="data text-[0.8125rem] text-ink-60">{items.length} FILES</span>
      </div>

      <ul>
        {items.map((item, index) => (
          <QueueRow
            key={item.id}
            index={index}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onDownload={() => onDownloadOne(item)}
            onRemove={() => onRemove(item)}
          />
        ))}
      </ul>

      {/* The only aria-live region in the queue — per-row live regions
          would be a screen-reader firehose during a sweep. */}
      <div className="data flex items-baseline justify-between pt-4 text-[0.8125rem]" aria-live="polite">
        <span className="label">Total</span>
        <span>
          {formatBytes(totals.input)} → {formatBytes(totals.output)}{" "}
          <span className={totals.percent >= 0 ? "text-signal" : "text-ink-60"}>
            {formatPercent(totals.percent)}
          </span>
        </span>
      </div>
    </section>
  );
}
