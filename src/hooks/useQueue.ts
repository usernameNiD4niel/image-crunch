import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { EncodeOutcome, EncodeResult, EncodeSettings, ItemStatus, Mode, QueueItem } from "@/lib/engine/types";
import { currentResult, effectiveSettings, isPassthrough, MAX_QUEUE, outputFilename, savingsPercent } from "@/lib/engine/plan";
import { EncodeClient, releaseAll, releaseUrl, StaleResult } from "@/lib/engine/client";
import { MatteClient } from "@/lib/engine/matte/client";
import { bundleZip } from "@/lib/engine/zip";

export interface Notice {
  id: number;
  message: string;
}

export interface QueueState {
  items: QueueItem[];
  settings: EncodeSettings;
  // The job on screen. Kept beside `settings` rather than inside them: an
  // EncodeSettings is what the encoder is handed, and the mode is a page-level
  // choice that DECIDES those (see effectiveSettings) rather than being one.
  mode: Mode;
  // A list, not a single string: a drop's screening report, its per-file read
  // failures and the queue-cap rejection can all be raised within a tick of
  // each other, and two drops in quick succession raise two independent
  // reports. With one slot the loser of that race was never shown at all.
  notices: Notice[];
  nextNoticeId: number;
}

// Three is what fits above the queue without pushing it off screen, and no
// user needs a scrollback of drop reports: the oldest falls off.
export const MAX_NOTICES = 3;

export const initialQueueState: QueueState = {
  items: [],
  // WebP by default, not "keep": with "keep" a PNG source can essentially
  // never shrink (canvas's PNG encoder does not beat a well-encoded source),
  // so a first run would read 0.0% on every row and look broken. Editorial
  // entry 02 already recommends WebP; the default now matches the app's own
  // advice. KEEP remains one click away for anyone who needs the format
  // preserved.
  settings: { quality: 85, resize: "none", format: "image/webp", icon: 64 },
  mode: "compress",
  notices: [],
  nextNoticeId: 1,
};

function withNotice(state: QueueState, message: string): QueueState {
  return {
    ...state,
    notices: [...state.notices, { id: state.nextNoticeId, message }].slice(-MAX_NOTICES),
    nextNoticeId: state.nextNoticeId + 1,
  };
}

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
  | { type: "reset" }
  | { type: "settings"; settings: Partial<EncodeSettings> }
  | { type: "set-mode"; mode: Mode }
  | { type: "notice"; message: string }
  | { type: "dismiss-notice"; id: number }
  | { type: "clear-notices" }
  | { type: "matte-start"; id: string }
  | { type: "matte-done"; id: string; cutout: { blob: Blob; width: number; height: number } }
  | { type: "matte-error"; id: string; message: string }
  | { type: "matte-clear"; id: string };

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "add": {
      const room = MAX_QUEUE - state.items.length;
      const accepted = action.items.slice(0, Math.max(0, room));
      const rejected = action.items.length - accepted.length;
      const added = { ...state, items: [...state.items, ...accepted] };
      return rejected > 0
        ? withNotice(added, `Queue holds ${MAX_QUEUE} files. ${rejected} not added.`)
        : added;
    }
    case "reset":
      // Files only. Settings are the user's preferences, not part of the
      // batch being cleared; notices are, since every one of them reports on
      // a drop whose files are going away.
      return { ...state, items: [], notices: [] };
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
    case "set-mode": {
      // Same no-op guard as "settings", for the same reason: re-selecting the
      // mode already on screen must not requeue a settled queue.
      if (state.mode === action.mode) return state;

      // Leaving cut-out mode drops every cut-out. The modes are exclusive —
      // compress mode's claim is that it only re-encodes what it was given,
      // and a surviving matte would quietly break that on every row that had
      // been through the other mode. Entering cut-out mode keeps the ones it
      // finds: they are exactly what that mode was about to produce anyway.
      const restoring = action.mode === "compress";
      return {
        ...state,
        mode: action.mode,
        // Superseded here rather than by the sweep, for the reason spelled out
        // in "settings" above: until the re-encode lands, every figure on the
        // rows describes a mode that is no longer on screen.
        items: state.items.map((i) => ({
          ...i,
          status: "queued",
          error: undefined,
          cutout: restoring ? undefined : i.cutout,
          matting: restoring ? false : i.matting,
        })),
      };
    }
    case "notice":
      return withNotice(state, action.message);
    case "dismiss-notice":
      return { ...state, notices: state.notices.filter((n) => n.id !== action.id) };
    case "clear-notices":
      return state.notices.length === 0 ? state : { ...state, notices: [] };
    case "matte-start":
      return {
        ...state,
        items: state.items.map((i) => (i.id === action.id ? { ...i, matting: true } : i)),
      };
    case "matte-done":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id
            ? // Back to "queued", not "done": the row's stored result was
              // encoded from the ORIGINAL and no longer describes what this
              // row is. currentResult withholds it until the re-encode lands.
              { ...i, matting: false, cutout: action.cutout, status: "queued", error: undefined }
            : i,
        ),
      };
    case "matte-error":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id
            ? { ...i, matting: false, status: "error", error: action.message, result: undefined }
            : i,
        ),
      };
    case "matte-clear":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id
            ? { ...i, cutout: undefined, matting: false, status: "queued", error: undefined }
            : i,
        ),
      };
    default:
      return state;
  }
}

export function useQueue() {
  const [state, dispatch] = useReducer(queueReducer, initialQueueState);
  const clientRef = useRef<EncodeClient | null>(null);
  const matteRef = useRef<MatteClient | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  if (clientRef.current === null) clientRef.current = new EncodeClient();
  if (matteRef.current === null) matteRef.current = new MatteClient();

  useEffect(() => {
    return () => {
      clientRef.current?.dispose();
      matteRef.current?.dispose();
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
  // Mode is a ref of its own rather than being folded into settingsRef during
  // render, because setMode has to be able to move it BEFORE React commits —
  // see the comment there.
  const modeRef = useRef(state.mode);
  itemsRef.current = state.items;
  settingsRef.current = state.settings;
  modeRef.current = state.mode;

  const runAll = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    client.bumpGeneration();

    for (const item of itemsRef.current) {
      dispatch({ type: "working", id: item.id });
      client
        // The settings the ENGINE runs under, not the ones on the controls:
        // in cut-out mode those differ, and a matte must never be encoded
        // under the lossy format the user picked for the other job.
        .encode(
          item.id,
          item.cutout?.blob ?? item.file,
          item.source,
          effectiveSettings(settingsRef.current, modeRef.current),
          !!item.cutout,
        )
        .then((result) => dispatch({ type: "result", id: item.id, result }))
        .catch((error) => {
          if (error instanceof StaleResult) return; // superseded, not a failure
          dispatch({ type: "error", id: item.id, message: error.message });
        });
    }
  }, []);

  // (Re)start the 200ms debounce. Pulled out of the effect below so a
  // cut-out/restore can call it directly the moment its dispatch fires,
  // rather than waiting on a render + effect round trip: that dispatch
  // happens inside a Promise callback (matte() resolving), not a React
  // event handler, so React's passive-effect flush for the resulting
  // re-render is not guaranteed to land inside the same macrotask/tick —
  // calling this directly keeps cut-out scheduling exactly as prompt as
  // every other trigger.
  const scheduleSweep = useCallback(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(runAll, 200);
  }, [runAll]);

  // Debounced re-encode. Keyed ONLY on values that should genuinely
  // trigger a fresh sweep: which files are queued (by id, order-stable
  // join, not the array reference) and the settings that affect encoding.
  // Deliberately NOT keyed on `state.items` itself — a "result" dispatch
  // changes item.status/item.result and therefore the items array
  // identity, but not the id set or the settings, so it must not
  // re-trigger this effect (see runAll's comment above for why that
  // matters).
  const itemIdsKey = state.items.map((i) => i.id).join(",");
  // Changes when any row's cut-out appears OR disappears, so the effect
  // below also re-fires on `matte-done`/`matte-clear` — those dispatches
  // change `item.cutout`, not the id set or the settings, so without this
  // key the sweep would never notice a new (or restored) cut-out. (cutOut
  // and restoreBackground also call scheduleSweep directly — see above —
  // this key is what keeps the effect itself consistent with that state.)
  const cutoutKey = state.items.map((i) => (i.cutout ? `${i.id}+` : `${i.id}-`)).join(",");
  useEffect(() => {
    if (state.items.length === 0) return;
    scheduleSweep();
    return () => window.clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    itemIdsKey,
    cutoutKey,
    state.settings.quality,
    state.settings.resize,
    state.settings.format,
    state.settings.icon,
    state.mode,
    scheduleSweep,
  ]);

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

  const reset = useCallback(() => {
    // Bump first: a sweep may be in flight, and its results would otherwise
    // land on ids the reducer has already dropped. The reducer ignores them
    // either way, but the workers stop wasting cycles on a cleared queue.
    clientRef.current?.bumpGeneration();
    matteRef.current?.bumpGeneration();
    for (const item of itemsRef.current) releaseUrl(item.previewUrl);
    dispatch({ type: "reset" });
  }, []);

  const removeItem = useCallback((item: QueueItem) => {
    releaseUrl(item.previewUrl);
    dispatch({ type: "remove", id: item.id });
  }, []);

  // Background removal is per row and explicit: it costs seconds and a
  // model download, so it never happens because a setting moved.
  const cutOut = useCallback((item: QueueItem) => {
    const matte = matteRef.current;
    if (!matte) return;

    dispatch({ type: "matte-start", id: item.id });
    matte
      .matte(item.id, item.file)
      .then((cutout) => {
        // Patch itemsRef directly, in addition to dispatching. This
        // dispatch fires from a Promise callback, not a React event
        // handler, so React is free to delay committing it (and running
        // the effect above) past a macrotask boundary the fake-timer
        // debounce below has no way to wait for. runAll reads itemsRef,
        // not state, so mirroring `cutout` here — the one field runAll
        // actually reads off this ref — is what keeps the very next sweep
        // from encoding the stale, pre-cutout file.
        //
        // Deliberately only `cutout`: the reducer stays the sole source of
        // truth for everything rendered (`matting`, `status`, `error`
        // included). Mirroring those too would risk itemsRef briefly
        // holding a row the reducer never produced if a concurrent
        // dispatch (e.g. a "result" from an in-flight encode) lands
        // between this patch and React's own commit. matte-start and
        // matte-error are unmirrored for the same reason: nothing reads
        // `matting` or `error` off itemsRef, only off rendered state.
        itemsRef.current = itemsRef.current.map((i) => (i.id === item.id ? { ...i, cutout } : i));
        dispatch({ type: "matte-done", id: item.id, cutout });
        scheduleSweep();
      })
      .catch((error) => {
        if (error instanceof StaleResult) return; // superseded, not a failure
        dispatch({ type: "matte-error", id: item.id, message: error.message });
      });
  }, [scheduleSweep]);

  // Rows whose matte has already been asked for. Without this, the effect
  // below would re-fire on every render the sweep causes and queue a second
  // inference for a row that is already mid-matte — seconds of GPU time each,
  // and a queue that never settles. Cleared when cut-out mode is left, so
  // switching back on genuinely re-cuts.
  const requestedRef = useRef(new Set<string>());

  const setMode = useCallback(
    (mode: Mode) => {
      // Both refs are moved here, ahead of the dispatch, for the reason cutOut
      // spells out at length: runAll reads refs, not state, and the 200ms
      // debounce can elapse before React has committed this update. Without
      // the mirror the very next sweep encodes under the mode the user just
      // left — a matte written as a lossy JPEG, or an original still encoded
      // from a cut-out that is no longer meant to exist.
      modeRef.current = mode;
      if (mode === "compress") {
        requestedRef.current.clear();
        itemsRef.current = itemsRef.current.map((i) => ({ ...i, cutout: undefined }));
      }
      dispatch({ type: "set-mode", mode });
      scheduleSweep();
    },
    [scheduleSweep],
  );

  // Cut-out mode is a standing instruction, not a one-off press: it applies to
  // the rows already queued when it is switched on AND to every file dropped
  // afterwards, which is why this is an effect over the items rather than
  // something setMode does once. Passthrough sources are skipped — an SVG is
  // never decoded, so there is nothing to matte.
  useEffect(() => {
    if (state.mode !== "cutout") return;
    for (const item of state.items) {
      if (requestedRef.current.has(item.id)) continue;
      if (isPassthrough(item.source.type)) continue;
      if (item.cutout || item.matting) continue;
      requestedRef.current.add(item.id);
      cutOut(item);
    }
  }, [state.mode, state.items, cutOut]);

  const restoreBackground = useCallback(
    (item: QueueItem) => {
      // See cutOut's comment on itemsRef above — same reasoning applies,
      // and again only `cutout` (the field runAll reads) is mirrored.
      itemsRef.current = itemsRef.current.map((i) => (i.id === item.id ? { ...i, cutout: undefined } : i));
      dispatch({ type: "matte-clear", id: item.id });
      scheduleSweep();
    },
    [scheduleSweep],
  );

  return {
    ...state,
    totals,
    pending,
    dispatch,
    downloadOne,
    downloadAll,
    removeItem,
    reset,
    cutOut,
    restoreBackground,
    setMode,
  };
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
