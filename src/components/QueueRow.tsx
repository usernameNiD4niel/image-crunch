import type { QueueItem } from "@/lib/engine/types";
import { currentResult, formatBytes, formatPercent, isPassthrough, savingsPercent } from "@/lib/engine/plan";
import { Item, ItemActions } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Compare } from "@/components/Compare";

interface QueueRowProps {
  index: number;
  item: QueueItem;
  expanded: boolean;
  onToggle: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onCutOut: () => void;
  onRestore: () => void;
  /** True when the queue's format is JPG and this row had to go elsewhere. */
  formatSubstituted?: boolean;
}

export function QueueRow({
  index,
  item,
  expanded,
  onToggle,
  onDownload,
  onRemove,
  onCutOut,
  onRestore,
  formatSubstituted,
}: QueueRowProps) {
  // Not item.result: while a re-encode is in flight the row still holds the
  // previous run's bytes, and every figure derived from them describes
  // settings that are no longer on screen. currentResult withholds them for
  // a working or errored row, so this row's sizes, percentage and download
  // are either current or absent — never quietly stale.
  const result = currentResult(item);
  const working = item.status === "working";
  const percent = result ? savingsPercent(item.source.size, result.size) : 0;

  return (
    <Item
      render={<li />}
      variant="outline"
      size="sm"
      className="grid grid-cols-12 items-baseline gap-x-4 gap-y-1 rounded-none border-x-0 border-t-0 border-b border-rule px-0 py-4 duration-[140ms] ease-[var(--ease)] focus-visible:border-transparent focus-visible:ring-0"
    >
      <span className="data col-span-1 text-ink-58">{String(index + 1).padStart(2, "0")}</span>

      <span className="col-span-4 truncate">{item.source.name}</span>

      <span className="data col-span-3 text-[0.8125rem] text-ink-72">
        {item.source.width}×{item.source.height}
        {result?.outcome === "encoded" && ` → ${result.width}×${result.height}`}
      </span>

      {/* Working OR sizes, never both: this column used to render the
          spinner and the previous run's byte figures side by side, so a
          re-encoding row read "⟳ encoding… 3.4 MB → 141 KB" with numbers
          from the settings the user had just changed away from. */}
      <span className="data col-span-2 text-[0.8125rem]">
        {working ? (
          <span className="inline-flex items-center gap-2 text-ink-72">
            <Spinner className="size-3.5" />
            encoding…
          </span>
        ) : (
          result && (
            <>
              {formatBytes(item.source.size)} → {formatBytes(result.size)}
            </>
          )
        )}
      </span>

      <span className="data col-span-1 text-right">
        {/* A passthrough was never decoded, so there is no percentage to
            report — a dash, not a "0.0%" that would imply we tried. A kept
            original WAS re-encoded, so its (zero or negative) figure is real
            and gets shown, but never in --signal: it is not a saving. */}
        {item.status === "passthrough" && <span className="text-ink-58">—</span>}
        {item.status === "kept" && <span className="text-ink-72">{formatPercent(percent)}</span>}
        {result?.outcome === "encoded" && (
          <span className={percent >= 0 ? "text-signal" : "text-ink-72"}>{formatPercent(percent)}</span>
        )}
      </span>

      <ItemActions className="col-span-1 justify-end gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`Compare ${item.source.name}`}
          className="focus-visible:ring-0"
        >
          {expanded ? "⌃" : "⌄"}
        </button>
        {/* Passthrough files (svg, ico) are never decoded, so a cut-out on
            one would mean nothing — and encodeOne's passthrough branch
            re-labels its output bytes with the source mime, so the file
            handed out would silently be the wrong format under the source
            extension. */}
        {!isPassthrough(item.source.type) && (
          <button
            type="button"
            onClick={item.cutout ? onRestore : onCutOut}
            disabled={item.matting}
            aria-label={
              item.cutout
                ? `Restore background from ${item.source.name}`
                : `Cut out background from ${item.source.name}`
            }
            className="focus-visible:ring-0 disabled:text-ink-58"
          >
            ✂
          </button>
        )}
        <button
          type="button"
          onClick={onDownload}
          disabled={!result}
          aria-label={`Download ${item.source.name}`}
          className="focus-visible:ring-0 disabled:text-ink-58"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.source.name}`}
          className="focus-visible:ring-0"
        >
          ×
        </button>
      </ItemActions>

      {item.status === "passthrough" && (
        <p className="data col-span-11 col-start-2 text-[0.8125rem] text-ink-58">passthrough — no gain</p>
      )}

      {item.status === "kept" && (
        <p className="data col-span-11 col-start-2 text-[0.8125rem] text-ink-72">
          kept original — re-encoding did not make this file smaller
        </p>
      )}

      {item.status === "error" && (
        <p className="data col-span-11 col-start-2 text-[0.8125rem] text-ink-72">{item.error}</p>
      )}

      {item.matting && (
        <p className="data col-span-11 col-start-2 text-[0.8125rem] text-ink-72">
          removing background…
        </p>
      )}

      {item.cutout && !item.matting && (
        <p className="data col-span-11 col-start-2 text-[0.8125rem] text-ink-72">
          cut out
          {formatSubstituted && " · output as WEBP (JPG has no transparency)"}
        </p>
      )}

      {/* Deliberately item.result, not `result`: the compare panel holds
          local split-position state and mints an object URL per blob, so
          unmounting it on every settings sweep would reset the divider the
          user just placed and thrash URLs. It carries no figures — only the
          two images — and re-points at the new blob the moment the encode
          lands. Downloads are gated on `result`; the preview is not. */}
      {expanded && item.result && (
        <div className="col-span-12">
          <Compare item={item} result={item.result} />
        </div>
      )}
    </Item>
  );
}
