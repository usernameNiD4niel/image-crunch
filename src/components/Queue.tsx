import { useState } from "react";
import type { Mode, OutputFormat, QueueItem } from "@/lib/engine/types";
import { formatBytes, formatPercent, resolveOutputFormat } from "@/lib/engine/plan";
import { QueueRow } from "@/components/QueueRow";

interface QueueProps {
  items: QueueItem[];
  /** Rows superseded and awaiting the debounced sweep, plus rows encoding now. */
  pending: number;
  totals: { count: number; input: number; output: number; percent: number };
  onDownloadOne: (item: QueueItem) => void;
  onRemove: (item: QueueItem) => void;
  mode: Mode;
  /**
   * The queue's format setting. Held rather than a precomputed boolean
   * because whether a cut-out forces a different output format is a
   * per-ROW question: KEEP on a .jpg substitutes WebP exactly as an
   * explicit JPG choice does, and a mixed queue answers differently row
   * by row.
   */
  format: OutputFormat;
}

export function Queue({ items, pending, totals, onDownloadOne, onRemove, mode, format }: QueueProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section aria-labelledby="queue-heading">
      <div className="flex items-baseline justify-between border-b border-ink pb-2">
        {/* A real h2, styled as a label: the queue is a section of the page
            and belongs in the heading outline under the h1 statement. */}
        <h2 id="queue-heading" className="label">
          Queue
        </h2>
        <span className="data text-[0.8125rem] text-ink-72">{items.length} FILES</span>
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
            mode={mode}
            // Asked of the resolver, not of the raw setting: it is the
            // resolver that decides a cut-out cannot be a JPEG, and it
            // does so for FORMAT=KEEP on a .jpg source just as much as
            // for an explicit JPG. Comparing its answer with and without
            // alpha is the only thing that stays true as that rule moves.
            formatSubstituted={
              !!item.cutout &&
              resolveOutputFormat(item.source.type, format, false) !==
                resolveOutputFormat(item.source.type, format, true)
            }
          />
        ))}
      </ul>

      {/* The only aria-live region in the queue — per-row live regions
          would be a screen-reader firehose during a sweep. */}
      <div className="data flex items-baseline justify-between pt-4 text-[0.8125rem]" aria-live="polite">
        <span className="label">Total</span>
        {/* From the moment a setting changes — not from when the sweep 200ms
            later actually starts — the per-row results are superseded, so
            there is no honest aggregate to state. Stating the previous one
            would have this live region read out figures for settings the user
            has already moved off; stating the empty one would read out a
            0 B → 0 B that was never true. Say what is happening instead. */}
        {pending > 0 ? (
          <span className="text-ink-72">re-encoding {pending} file(s)…</span>
        ) : (
          <span>
            {formatBytes(totals.input)} → {formatBytes(totals.output)}{" "}
            <span className={totals.percent >= 0 ? "text-signal" : "text-ink-72"}>
              {formatPercent(totals.percent)}
            </span>
          </span>
        )}
      </div>
    </section>
  );
}
