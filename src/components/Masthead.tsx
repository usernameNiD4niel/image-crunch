import { formatBytes, formatPercent } from "@/lib/engine/plan";

interface MastheadProps {
  count: number;
  working: number;
  errors: number;
  totals: { count: number; input: number; output: number; percent: number };
  onDownloadAll: () => void;
}

export function Masthead({ count, working, errors, totals, onDownloadAll }: MastheadProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 h-12 border-b border-rule bg-paper">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-6">
        <span className="label">Image Crunch</span>

        <div className="data flex items-center gap-4 text-[0.8125rem]">
          {working > 0 ? (
            <span>WORKING · {working} OF {count}</span>
          ) : count === 0 ? (
            <span className="text-ink-60">IDLE · 0 FILES</span>
          ) : totals.count > 0 ? (
            <>
              {/* Below 768px only the percentage and the action survive — the
                  masthead is 48px tall and the byte figures are the first
                  thing that can be dropped without losing the headline fact. */}
              <span className="hidden text-ink-60 md:inline">
                {totals.count} FILES · {formatBytes(totals.input)} → {formatBytes(totals.output)}
              </span>
              {/* Completed work must not hide failed work: a queue that
                  finished some files and failed others used to report only
                  the successes. Kept outside the md-only span so the failure
                  count survives the mobile truncation. */}
              {errors > 0 && <span className="text-ink-60">{errors} FAILED</span>}
              <span className={totals.percent >= 0 ? "text-signal" : "text-ink-60"}>
                {formatPercent(totals.percent)}
              </span>
              <button
                type="button"
                onClick={onDownloadAll}
                className="border border-ink px-3 py-1 transition-colors duration-[140ms] ease-[var(--ease)] hover:bg-ink hover:text-paper"
              >
                ↓ ALL
              </button>
            </>
          ) : errors > 0 ? (
            <span className="text-ink-60">{count} FILES · {errors} FAILED</span>
          ) : (
            <span className="text-ink-60">{count} FILES · QUEUED</span>
          )}
        </div>
      </div>
    </header>
  );
}
