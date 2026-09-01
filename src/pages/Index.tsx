import { useCallback, useState } from "react";
import { Masthead } from "@/components/Masthead";
import { Statement } from "@/components/Statement";
import { DropZone, getImageDimensions } from "@/components/DropZone";
import { Queue } from "@/components/Queue";
import { Controls } from "@/components/Controls";
import { Editorial } from "@/components/Editorial";
import { Notices } from "@/components/Notices";
import { useQueue } from "@/hooks/useQueue";
import { trackUrl } from "@/lib/engine/client";
import { pickDevice, isModelPresent } from "@/lib/engine/matte/assets";
import type { QueueItem } from "@/lib/engine/types";

const Index = () => {
  const {
    items,
    settings,
    totals,
    notices,
    pending,
    dispatch,
    downloadOne,
    downloadAll,
    removeItem,
    reset,
    cutOut,
    restoreBackground,
  } = useQueue();
  // Whether the one-off "this will download N MB" notice has been shown.
  // Set ONLY once the model has actually been found: if the check said the
  // weights are missing, nothing was announced and nothing has been
  // downloaded, so the next press must run the check again rather than
  // fall through into a worker that cannot load.
  const [downloadAnnounced, setDownloadAnnounced] = useState(false);
  const working = items.filter((i) => i.status === "working").length;
  const errors = items.filter((i) => i.status === "error").length;

  // Never call URL.createObjectURL during render — it must run exactly
  // once per accepted file, inside this handler, wrapped in trackUrl so
  // the registry can revoke it later (see engine/client.ts).
  //
  // DropZone's screening (oversized/unsupported files) happens synchronously
  // and is reported via `screeningMessage`; the dimension read below is async
  // and can itself reject per-file (a corrupt file). Both are raised after the
  // dimension reads settle, as separate notices that stack — nothing a drop
  // has to say can overwrite anything another drop said.
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
      // A clean drop CLEARS what is standing: an earlier "3 unsupported
      // file(s) skipped." would otherwise sit above the new files reading as
      // a report on them. A drop with something to say adds to the list
      // instead of replacing it — the older report is still true, and the
      // user may not have read it yet.
      if (parts.length === 0) dispatch({ type: "clear-notices" });
      else for (const message of parts) dispatch({ type: "notice", message });

      if (ok.length > 0) dispatch({ type: "add", items: ok });
    },
    [dispatch],
  );

  const onCutOut = useCallback(
    async (item: QueueItem) => {
      if (!downloadAnnounced) {
        const device = pickDevice();
        // Re-checked on every press until it succeeds, in both directions:
        // a deployment without weights must keep saying so rather than
        // silently handing the second press to a worker that fails with a
        // raw protobuf error, and a model deployed mid-session must still
        // get its download notice.
        if (!(await isModelPresent(device))) {
          dispatch({
            type: "notice",
            message:
              "Background removal is unavailable: the model was not deployed. Run `npm run fetch-model` and redeploy.",
          });
          return;
        }
        setDownloadAnnounced(true);
        dispatch({
          type: "notice",
          message:
            device === "webgpu"
              ? "Downloading the background model — about 85 MB, once. It stays on your device."
              : "This browser has no WebGPU, so background removal uses the slower fallback: about 43 MB to download, and a few seconds per image.",
        });
      }
      cutOut(item);
    },
    [cutOut, dispatch, downloadAnnounced],
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
      {/* scroll-mt-12 clears the 48px fixed masthead: both Statement's
          href="#tool" and DropZone's post-drop scrollIntoView target this
          element, and without the offset the notice bar and the top of the
          queue land underneath the header. */}
      <main id="tool" className="mx-auto max-w-[1440px] scroll-mt-12 border-t border-rule px-6 py-16">
        <Notices notices={notices} onDismiss={(id) => dispatch({ type: "dismiss-notice", id })} />

        {items.length === 0 ? (
          <DropZone onFiles={onFiles} />
        ) : (
          <>
            <Queue
              items={items}
              pending={pending}
              totals={totals}
              onDownloadOne={downloadOne}
              onRemove={removeItem}
              onCutOut={onCutOut}
              onRestore={restoreBackground}
              format={settings.format}
            />
            <DropZone onFiles={onFiles} compact />
            <Controls
              settings={settings}
              onChange={(patch) => dispatch({ type: "settings", settings: patch })}
              onDownloadAll={downloadAll}
              onReset={reset}
              // Also disabled from the settings change onward, not just when
              // empty: every row still carries the PREVIOUS run's bytes
              // through the debounce gap and the sweep, so a zip taken then
              // would not match the settings on screen. Masthead's ↓ ALL
              // already hides while the totals have no rows to report.
              disabled={totals.count === 0 || pending > 0}
            />
          </>
        )}
      </main>
      <Editorial />
    </>
  );
};

export default Index;
