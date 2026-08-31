import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPTED_TYPES, MAX_FILE_BYTES } from "@/lib/engine/plan";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  onReject: (message: string) => void;
  /**
   * Renders the compact "add more" bar shown beneath a non-empty queue,
   * instead of the full idle drop target. Same drag/drop/click behaviour.
   */
  compact?: boolean;
}

export function DropZone({ onFiles, onReject, compact = false }: DropZoneProps) {
  const [active, setActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const files = Array.from(list);
      const tooBig = files.filter((f) => f.size > MAX_FILE_BYTES);
      const wrongType = files.filter((f) => !ACCEPTED_TYPES.includes(f.type));
      const ok = files.filter((f) => f.size <= MAX_FILE_BYTES && ACCEPTED_TYPES.includes(f.type));

      if (tooBig.length) onReject(`${tooBig.length} file(s) over 35 MB were skipped.`);
      else if (wrongType.length) onReject(`${wrongType.length} unsupported file(s) were skipped.`);

      if (ok.length) {
        onFiles(ok);
        document.getElementById("tool")?.scrollIntoView({ behavior: "smooth" });
      }
    },
    [onFiles, onReject],
  );

  // Drop anywhere on the page, at any scroll position.
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setActive(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setActive(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setActive(false);
      accept(e.dataTransfer?.files ?? null);
    };

    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [accept]);

  const openPicker = () => inputRef.current?.click();
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={ACCEPTED_TYPES.join(",")}
      className="sr-only"
      onChange={(e) => accept(e.target.files)}
    />
  );

  // Active drag state is signalled with an ink hairline, never --signal:
  // --signal is reserved app-wide for the savings figure, the quality
  // track fill, and the primary action, and the drop zone is none of those.
  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        className={`mt-6 flex w-full items-baseline justify-between border px-6 py-4 text-left transition-colors duration-[140ms] ease-[var(--ease)] focus-visible:ring-0 ${
          active ? "border-ink bg-paper-2" : "border-rule bg-paper-2"
        }`}
      >
        <span className="label text-ink">Add more</span>
        <span className="data text-[0.8125rem] text-ink-38">up to 35 MB each · 30 files max</span>
        {input}
      </div>
    );
  }

  return (
    <Empty
      role="button"
      tabIndex={0}
      onClick={openPicker}
      onKeyDown={onKeyDown}
      aria-label="Drop images, or click to choose files"
      className={`w-full items-start rounded-none border border-solid px-6 py-24 text-left transition-colors duration-[140ms] ease-[var(--ease)] focus-visible:ring-0 ${
        active ? "border-ink bg-paper-2" : "border-rule bg-paper-2"
      }`}
    >
      <EmptyHeader className="max-w-none items-start gap-1 text-left">
        <EmptyTitle className="label text-ink">Drop images</EmptyTitle>
        <EmptyDescription className="text-ink-60">
          or click to choose · up to 35 MB each · 30 files max
        </EmptyDescription>
        <span className="data mt-2 block text-[0.8125rem] text-ink-38">
          JPG · PNG · WEBP · GIF · SVG · ICO
        </span>
      </EmptyHeader>
      {input}
    </Empty>
  );
}

export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}
