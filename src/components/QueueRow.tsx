import type { QueueItem } from "@/lib/engine/types";
import { formatBytes, formatPercent, savingsPercent } from "@/lib/engine/plan";
import { Item, ItemActions } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";

interface QueueRowProps {
  index: number;
  item: QueueItem;
  expanded: boolean;
  onToggle: () => void;
  onDownload: () => void;
  onRemove: () => void;
}

// NOTE: the Compare panel (Task 12) is not wired in yet — `expanded` and
// `onToggle` are kept so the expand affordance and its aria-expanded state
// are already in place, but nothing renders below the row until Compare
// exists. Compare.tsx does not exist as of this task.
export function QueueRow({ index, item, expanded, onToggle, onDownload, onRemove }: QueueRowProps) {
  const result = item.result;
  const percent = result ? savingsPercent(item.source.size, result.size) : 0;

  return (
    <Item
      render={<li />}
      variant="outline"
      size="sm"
      className="grid grid-cols-12 items-baseline gap-x-4 gap-y-1 rounded-none border-x-0 border-t-0 border-b border-rule px-0 py-4 focus-visible:border-transparent focus-visible:ring-0"
    >
      <span className="data col-span-1 text-ink-38">{String(index + 1).padStart(2, "0")}</span>

      <span className="col-span-4 truncate">{item.source.name}</span>

      <span className="data col-span-3 text-[0.8125rem] text-ink-60">
        {item.source.width}×{item.source.height}
        {result && !result.keptOriginal && ` → ${result.width}×${result.height}`}
      </span>

      <span className="data col-span-2 text-[0.8125rem]">
        {item.status === "working" && (
          <span className="inline-flex items-center gap-2 text-ink-60">
            <Spinner className="size-3.5" />
            encoding…
          </span>
        )}
        {result && (
          <>
            {formatBytes(item.source.size)} → {formatBytes(result.size)}
          </>
        )}
      </span>

      <span className="data col-span-1 text-right">
        {item.status === "passthrough" && <span className="text-ink-38">—</span>}
        {result && !result.keptOriginal && (
          <span className={percent >= 0 ? "text-signal" : "text-ink-60"}>{formatPercent(percent)}</span>
        )}
      </span>

      <ItemActions className="col-span-1 justify-end gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label="Compare"
          className="focus-visible:ring-0"
        >
          {expanded ? "⌃" : "⌄"}
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={!result}
          aria-label="Download"
          className="focus-visible:ring-0 disabled:text-ink-38"
        >
          ↓
        </button>
        <button type="button" onClick={onRemove} aria-label="Remove" className="focus-visible:ring-0">
          ×
        </button>
      </ItemActions>

      {item.status === "passthrough" && (
        <p className="data col-span-12 text-[0.8125rem] text-ink-38">passthrough — no gain</p>
      )}

      {item.status === "error" && (
        <p className="data col-span-12 text-[0.8125rem] text-ink-60">{item.error}</p>
      )}
    </Item>
  );
}
