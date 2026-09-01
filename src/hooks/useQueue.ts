import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { EncodeOutcome, EncodeResult, EncodeSettings, ItemStatus, QueueItem } from "@/lib/engine/types";
import { currentResult, MAX_QUEUE, outputFilename, savingsPercent } from "@/lib/engine/plan";
import { EncodeClient, releaseAll, releaseUrl, StaleResult } from "@/lib/engine/client";
import { bundleZip } from "@/lib/engine/zip";

export interface QueueState {
  items: QueueItem[];
  settings: EncodeSettings;
  notice: string | null;
}

export const initialQueueState: QueueState = {
  items: [],
  // WebP by default, not "keep": with "keep" a PNG source can essentially
  // never shrink (canvas's PNG encoder does not beat a well-encoded source),
  // so a first run would read 0.0% on every row and look broken. Editorial
  // entry 02 already recommends WebP; the default now matches the app's own
  // advice. KEEP remains one click away for anyone who needs the format
  // preserved.
  settings: { quality: 85, resize: "none", format: "image/webp" },
  notice: null,
};

// One row per engine outcome, deliberately explicit: "passthrough" (never
// decoded) and "kept" (decoded, re-encoded, output was no smaller) both ship
// the original bytes but are different facts about what happened, and the
// queue must be able to say which.
const STATUS_BY_OUTCOME: Record<EncodeOutcome, ItemStatus> = {
  encoded: "done",
  passthrough: "passthrough",
  kept: "kept",
};

export type QueueAction =
  | { type: "add"; items: QueueItem[] }
  | { type: "remove"; id: string }
  | { type: "working"; id: string }
  | { type: "result"; id: string; result: EncodeResult }
  | { type: "error"; id: string; message: string }
  | { type: "settings"; settings: Partial<EncodeSettings> }
  | { type: "notice"; message: string | null };

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "add": {
      const room = MAX_QUEUE - state.items.length;
      const accepted = action.items.slice(0, Math.max(0, room));
      const rejected = action.items.length - accepted.length;
      return {
        ...state,
        items: [...state.items, ...accepted],
        notice: rejected > 0 ? `Queue holds ${MAX_QUEUE} files. ${rejected} not added.` : state.notice,
      };
    }
    case "remove":
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case "working":
      return {
        ...state,
        items: state.items.map((i) => (i.id === action.id ? { ...i, status: "working" } : i)),
      };
    case "result":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id
            ? { ...i, status: STATUS_BY_OUTCOME[action.result.outcome], result: action.result }
            : i,
        ),
      };
    case "error":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id
            ? // A failed run's stored result belongs to an earlier, successful
              // run under different settings. It must not be counted in the
              // totals or offered as a download, and unlike "working" there is
              // no display-continuity reason to keep the bytes around.
              { ...i, status: "error", error: action.message, result: undefined }
            : i,
        ),
      };
    case "settings": {
      // A no-op dispatch (the slider re-reporting the value it already has)
      // must not requeue a settled queue — it would strip every row's figures
      // and start a sweep for settings nobody changed.
      const keys = Object.keys(action.settings) as (keyof EncodeSettings)[];
      if (keys.every((k) => state.settings[k] === action.settings[k])) return state;

      // Superseding happens HERE, on the change itself — not 200ms later when
      // the debounced sweep sets "working". In that window the figures on the
      // rows, the totals and the zip all still described the settings the user
      // had just moved off, and a download taken then handed out those bytes.
      // The stored blobs stay on the items (the compare panel reads them
      // directly); it is `currentResult` that stops treating them as current.
      return {
        ...state,
        settings: { ...state.settings, ...action.settings },
        items: state.items.map((i) =>
          i.status === "queued" ? i : { ...i, status: "queued", error: undefined },
        ),
      };
    }
    case "notice":
      return { ...state, notice: action.message };
    default:
      return state;
  }
}

export function useQueue() {
  const [state, dispatch] = useReducer(queueReducer, initialQueueState);
  const clientRef = useRef<EncodeClient | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  if (clientRef.current === null) clientRef.current = new EncodeClient();

  useEffect(() => {
    return () => {
      clientRef.current?.dispose();
      releaseAll();
    };
  }, []);

  // runAll must NEVER depend on `state.items`/`state.settings` directly:
  // every "result"/"working"/"error" dispatch below produces a new items
  // array, which would give a useCallback-memoized runAll a new identity
  // on every completed encode, which would re-fire the scheduling effect
  // below, which would re-encode everything again, forever. Instead, the
  // latest items/settings are read through refs kept in sync on every
  // render, so runAll's own identity is stable (empty dep array) and
  // completing an encode never itself triggers another sweep.
  const itemsRef = useRef(state.items);
  const settingsRef = useRef(state.settings);
  itemsRef.current = state.items;
  settingsRef.current = state.settings;

  const runAll = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    client.bumpGeneration();

    for (const item of itemsRef.current) {
      dispatch({ type: "working", id: item.id });
      client
        .encode(item.id, item.file, item.source, settingsRef.current)
        .then((result) => dispatch({ type: "result", id: item.id, result }))
        .catch((error) => {
          if (error instanceof StaleResult) return; // superseded, not a failure
          dispatch({ type: "error", id: item.id, message: error.message });
        });
    }
  }, []);

  // Debounced re-encode. Keyed ONLY on values that should genuinely
  // trigger a fresh sweep: which files are queued (by id, order-stable
  // join, not the array reference) and the settings that affect encoding.
  // Deliberately NOT keyed on `state.items` itself — a "result" dispatch
  // changes item.status/item.result and therefore the items array
  // identity, but not the id set or the settings, so it must not
  // re-trigger this effect (see runAll's comment above for why that
  // matters).
  const itemIdsKey = state.items.map((i) => i.id).join(",");
  useEffect(() => {
    if (state.items.length === 0) return;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(runAll, 200);
    return () => window.clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIdsKey, state.settings.quality, state.settings.resize, state.settings.format, runAll]);

  const totals = useMemo(() => {
    // currentResult, not i.result: a row that is mid-re-encode still holds
    // the PREVIOUS run's bytes, and aggregating those would announce a total
    // for settings that are no longer on screen (the Queue total is an
    // aria-live region — it would read out stale figures during a drag).
    const done = state.items
      .map((i) => ({ item: i, result: currentResult(i) }))
      .filter((r): r is { item: QueueItem; result: EncodeResult } => r.result !== undefined);
    const input = done.reduce((n, r) => n + r.item.source.size, 0);
    const output = done.reduce((n, r) => n + r.result.size, 0);
    return { count: done.length, input, output, percent: savingsPercent(input, output) };
  }, [state.items]);

  // Rows the app owes work on: superseded and waiting for the debounced
  // sweep ("queued"), or being encoded right now ("working"). The UI needs
  // the whole window, not just the in-flight part — between the settings
  // change and the sweep there is no honest aggregate to show either.
  const pending = useMemo(
    () => state.items.filter((i) => i.status === "queued" || i.status === "working").length,
    [state.items],
  );

  const downloadOne = useCallback((item: QueueItem) => {
    const result = currentResult(item);
    if (!result) return;
    const name = outputFilename(item.source.name, result.mime, new Set());
    save(result.blob, name);
  }, []);

  const downloadAll = useCallback(async () => {
    // A zip assembled mid-sweep would mix rows finished under the new
    // settings with rows still holding the old run's bytes, under one
    // filename scheme, with nothing on screen saying so. Refuse outright
    // while any row is working; the UI disables the button too, but the
    // guard is here so no caller can route around it.
    // "queued" counts as mid-sweep too: from the moment settings change every
    // row is superseded and waiting for the debounced re-encode, even though
    // no work has started yet.
    if (state.items.some((i) => i.status === "working" || i.status === "queued")) return;

    const taken = new Set<string>();
    const entries = state.items
      .map((i) => ({ item: i, result: currentResult(i) }))
      .filter((r): r is { item: QueueItem; result: EncodeResult } => r.result !== undefined)
      .map(({ item, result }) => {
        const name = outputFilename(item.source.name, result.mime, taken);
        taken.add(name);
        return { name, blob: result.blob };
      });
    if (entries.length === 0) return;
    save(await bundleZip(entries), "image-crunch.zip");
  }, [state.items]);

  const removeItem = useCallback((item: QueueItem) => {
    releaseUrl(item.previewUrl);
    dispatch({ type: "remove", id: item.id });
  }, []);

  return { ...state, totals, pending, dispatch, downloadOne, downloadAll, removeItem };
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Firefox and Safari can truncate or drop the download if the object URL
  // is revoked in the same task as the synthetic click on a detached
  // anchor. Yield first; the URL still cannot outlive this turn of the
  // event loop by more than a tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
