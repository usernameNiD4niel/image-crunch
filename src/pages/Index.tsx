import { useCallback } from "react";
import { Masthead } from "@/components/Masthead";
import { Statement } from "@/components/Statement";
import { DropZone, getImageDimensions } from "@/components/DropZone";
import { Queue } from "@/components/Queue";
import { useQueue } from "@/hooks/useQueue";
import { trackUrl } from "@/lib/engine/client";
import type { QueueItem } from "@/lib/engine/types";

const Index = () => {
  const { items, totals, notice, dispatch, downloadOne, downloadAll, removeItem } = useQueue();
  const working = items.filter((i) => i.status === "working").length;
  const errors = items.filter((i) => i.status === "error").length;

  const onReject = useCallback((message: string) => dispatch({ type: "notice", message }), [dispatch]);

  // Never call URL.createObjectURL during render — it must run exactly
  // once per accepted file, inside this handler, wrapped in trackUrl so
  // the registry can revoke it later (see engine/client.ts).
  const onFiles = useCallback(
    async (files: File[]) => {
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
      if (failed > 0) dispatch({ type: "notice", message: `${failed} file(s) could not be read.` });
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
          <DropZone onFiles={onFiles} onReject={onReject} />
        ) : (
          <>
            <Queue items={items} totals={totals} onDownloadOne={downloadOne} onRemove={removeItem} />
            <DropZone onFiles={onFiles} onReject={onReject} compact />
          </>
        )}
      </main>
    </>
  );
};

export default Index;
