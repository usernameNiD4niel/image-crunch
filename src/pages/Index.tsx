import { useCallback } from "react";
import { Masthead } from "@/components/Masthead";
import { Statement } from "@/components/Statement";
import { DropZone, getImageDimensions } from "@/components/DropZone";
import { Queue } from "@/components/Queue";
import { Controls } from "@/components/Controls";
import { useQueue } from "@/hooks/useQueue";
import { trackUrl } from "@/lib/engine/client";
import type { QueueItem } from "@/lib/engine/types";

const Index = () => {
  const { items, settings, totals, notice, dispatch, downloadOne, downloadAll, removeItem } = useQueue();
  const working = items.filter((i) => i.status === "working").length;
  const errors = items.filter((i) => i.status === "error").length;

  // Never call URL.createObjectURL during render — it must run exactly
  // once per accepted file, inside this handler, wrapped in trackUrl so
  // the registry can revoke it later (see engine/client.ts).
  //
  // A single drop must produce a single notice. DropZone's screening
  // (oversized/unsupported files) happens synchronously and is reported
  // via `screeningMessage`; the dimension read below is async and can
  // itself reject per-file (a corrupt file). Both are composed into one
  // sentence and dispatched exactly once, after the dimension reads
  // settle, so the second never silently clobbers the first.
  const onFiles = useCallback(
    async (files: File[], screeningMessage: string | null) => {
      const built = await Promise.all(
        files.map(async (file): Promise<QueueItem | null> => {
          try {
            const { width, height } = await getImageDimensions(file);
            return {
              id: crypto.randomUUID(),
              file,
              source: { name: file.name, type: file.type, size: file.size, width, height },
              previewUrl: trackUrl(URL.createObjectURL(file)),
              status: "queued",
            };
          } catch {
            return null;
          }
        }),
      );

      const ok = built.filter((i): i is QueueItem => i !== null);
      const failed = built.length - ok.length;

      const parts: string[] = [];
      if (screeningMessage) parts.push(screeningMessage);
      if (failed > 0) parts.push(`${failed} file(s) could not be read.`);
      if (parts.length > 0) dispatch({ type: "notice", message: parts.join(" ") });

      if (ok.length > 0) dispatch({ type: "add", items: ok });
    },
    [dispatch],
  );

  return (
    <>
      <Masthead
        count={items.length}
        working={working}
        errors={errors}
        totals={totals}
        onDownloadAll={downloadAll}
      />
      <Statement />
      <main id="tool" className="mx-auto max-w-[1440px] border-t border-rule px-6 py-16">
        {notice && (
          <div className="mb-4 flex items-baseline justify-between border-b border-rule pb-2">
            <p className="text-ink-60">{notice}</p>
            <button
              type="button"
              onClick={() => dispatch({ type: "notice", message: null })}
              aria-label="Dismiss notice"
              className="text-ink-60"
            >
              ×
            </button>
          </div>
        )}

        {items.length === 0 ? (
          <DropZone onFiles={onFiles} />
        ) : (
          <>
            <Queue items={items} totals={totals} onDownloadOne={downloadOne} onRemove={removeItem} />
            <DropZone onFiles={onFiles} compact />
            <Controls
              settings={settings}
              onChange={(patch) => dispatch({ type: "settings", settings: patch })}
              onDownloadAll={downloadAll}
              disabled={totals.count === 0}
            />
          </>
        )}
      </main>
    </>
  );
};

export default Index;
