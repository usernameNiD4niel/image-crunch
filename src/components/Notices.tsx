import type { Notice } from "@/hooks/useQueue";

interface NoticesProps {
  notices: Notice[];
  onDismiss: (id: number) => void;
}

/**
 * The standing reports about what a drop could not do. Deliberately a list:
 * a drop's screening message, its per-file read failures and the queue-cap
 * rejection are separate facts raised at separate moments, and each is
 * dismissed on its own — none of them may silently replace another.
 */
export function Notices({ notices, onDismiss }: NoticesProps) {
  if (notices.length === 0) return null;

  return (
    <div className="mb-4 border-b border-rule pb-2">
      {notices.map((notice) => (
        <div key={notice.id} className="flex items-baseline justify-between">
          <p className="text-ink-60">{notice.message}</p>
          <button
            type="button"
            onClick={() => onDismiss(notice.id)}
            // Named, not a bare "Dismiss notice": with several standing at
            // once a screen reader otherwise hears the same button repeated.
            aria-label={`Dismiss notice: ${notice.message}`}
            className="text-ink-60"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
