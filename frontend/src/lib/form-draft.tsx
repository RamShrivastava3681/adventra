import { useCallback, useEffect, useRef, useState } from "react";

// ─── Form draft auto-save (Tier A: browser, Tier B: server) ────────────────
// Every create/edit modal keeps its state in local useState (`f` + `lines`).
// This hook mirrors that state to localStorage (debounced) so a closed tab,
// a dead browser, or an accidental modal close never loses in-progress work.
// When the buffered state is already submittable, the hook ALSO fires a
// fire-and-forget server draft (status "draft") on unmount/pagehide so the
// interrupted work shows up as a real draft row in the list on any device.
//
// Contract per modal (minimal touch):
//   const draft = useFormDraft({
//     key: isEdit ? `so:${so.id}` : "so:new",
//     data: { f, lines, docs },
//     isEmpty: (d) => isFormEmpty(d.f) && d.lines.length === 0,
//     getServerPayload,   // () => payload | null (null = not yet valid, skip)
//     createServerDraft,  // (payload) => api.goodsSalesOrders.create(payload)
//     serverEnabled: !isEdit, // never auto-create server rows for edits
//   });
//   <DraftResumeBanner draft={draft} onApply={(d) => { setF(d.f); setLines(d.lines); ... }} />
//   // on manual save success: draft.clear()

const PREFIX = "adventra:draft:v1:";
const DEBOUNCE_MS = 800;

type StoredDraft<T> = {
  data: T;
  updatedAt: string;
};

function readStored<T>(key: string): StoredDraft<T> | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export type UseFormDraftOptions<T> = {
  /** Unique per form, e.g. `so:new` for creates, `so:<id>` for edits. */
  key: string;
  /** The live form state to mirror (plain JSON only). */
  data: T;
  /** True when the form is pristine/empty — nothing worth persisting. */
  isEmpty?: (data: T) => boolean;
  /** Return a server-ready payload, or null when not yet valid (server skipped). */
  getServerPayload?: () => any | null;
  /** Create the server draft row, e.g. (p) => api.goodsSalesOrders.create(p). */
  createServerDraft?: (payload: any) => Promise<unknown>;
  /** Gate the server tier (pass false for edit mode — never duplicate rows). */
  serverEnabled?: boolean;
  /** Gate the debounced live mirror (e.g. inline page form, only while open). */
  enabled?: boolean;
  debounceMs?: number;
};

export type FormDraftApi<T> = {
  hasDraft: boolean;
  updatedAt: string | null;
  resume: () => T | null;
  discard: () => void;
  clear: () => void;
  persistNow: (opts?: { server?: boolean }) => void;
};

export function useFormDraft<T extends Record<string, any>>(
  opts: UseFormDraftOptions<T>,
): FormDraftApi<T> {
  const {
    key,
    data,
    isEmpty,
    getServerPayload,
    createServerDraft,
    serverEnabled = false,
    enabled = true,
    debounceMs = DEBOUNCE_MS,
  } = opts;

  const [stored, setStored] = useState<StoredDraft<T> | null>(() => readStored<T>(key));
  const [dismissed, setDismissed] = useState(false);
  const [resumed, setResumed] = useState(false);

  // Re-read when the key changes (e.g. an inline page form switching between
  // "new" and "edit:<id>" without unmounting).
  useEffect(() => {
    setStored(readStored<T>(key));
    setDismissed(false);
    setResumed(false);
    clearedRef.current = false;
    serverTriedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const dataRef = useRef(data);
  dataRef.current = data;
  const clearedRef = useRef(false);
  const serverTriedRef = useRef(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;
  const getPayloadRef = useRef(getServerPayload);
  getPayloadRef.current = getServerPayload;
  const createRef = useRef(createServerDraft);
  createRef.current = createServerDraft;
  const serverEnabledRef = useRef(serverEnabled);
  serverEnabledRef.current = serverEnabled;

  const writeLocal = useCallback((value: T) => {
    try {
      window.localStorage.setItem(
        PREFIX + keyRef.current,
        JSON.stringify({ data: value, updatedAt: new Date().toISOString() } satisfies StoredDraft<T>),
      );
    } catch {
      // Quota / private-mode failures must never break the form.
    }
  }, []);

  const removeLocal = useCallback(() => {
    try {
      window.localStorage.removeItem(PREFIX + keyRef.current);
    } catch {
      // ignore
    }
  }, []);

  const tryServerSave = useCallback(() => {
    if (!serverEnabledRef.current || serverTriedRef.current) return;
    const build = getPayloadRef.current;
    const create = createRef.current;
    if (!build || !create) return;
    serverTriedRef.current = true;
    let payload: any = null;
    try {
      payload = build();
    } catch {
      payload = null;
    }
    if (!payload) return;
    // Fire-and-forget: the tab may be closing; never block or toast here.
    // keepalive lets the request survive pagehide in supporting browsers.
    try {
      const r = create(payload) as Promise<unknown>;
      if (r && typeof (r as Promise<unknown>).catch === "function") {
        (r as Promise<unknown>).catch(() => {});
      }
    } catch {
      // ignore — the browser draft still preserves the work
    }
  }, []);

  const persistNow = useCallback(
    (po?: { server?: boolean }) => {
      if (clearedRef.current) return;
      const cur = dataRef.current;
      const empty = isEmptyRef.current ? isEmptyRef.current(cur) : false;
      if (empty) return;
      writeLocal(cur);
      if (po?.server) tryServerSave();
    },
    [tryServerSave, writeLocal],
  );

  // Debounced mirror of live state. While a resume banner is still pending
  // (stored draft, user hasn't chosen yet) we do NOT overwrite it.
  const sig = (() => {
    try {
      return JSON.stringify(data);
    } catch {
      return null;
    }
  })();
  const bannerPending = !!stored && !dismissed && !resumed;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => {
    if (!sig || bannerPending || clearedRef.current || !enabledRef.current) return;
    const cur = dataRef.current;
    const t = window.setTimeout(() => {
      const empty = isEmptyRef.current ? isEmptyRef.current(cur) : false;
      if (empty) {
        removeLocal();
        return;
      }
      writeLocal(cur);
    }, debounceMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, bannerPending, debounceMs]);

  // Window/tab close + in-app modal close (unmount): flush synchronously.
  useEffect(() => {
    const onPageHide = () => persistNow({ server: true });
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      // Modal closed without saving (or route switched): keep browser copy,
      // and attempt one server draft when the data is already valid.
      persistNow({ server: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resume = useCallback(() => {
    const s = readStored<T>(keyRef.current);
    if (!s) return null;
    setResumed(true);
    return s.data;
  }, []);

  const discard = useCallback(() => {
    clearedRef.current = true;
    removeLocal();
    setStored(null);
    setDismissed(true);
  }, [removeLocal]);

  const clear = useCallback(() => {
    // Manual save succeeded — nothing left to preserve.
    clearedRef.current = true;
    removeLocal();
    setStored(null);
    setDismissed(true);
  }, [removeLocal]);

  return {
    hasDraft: bannerPending,
    updatedAt: stored?.updatedAt ?? null,
    resume,
    discard,
    clear,
    persistNow,
  };
}

// ─── Resume banner (render at the top of the modal, below the title) ───────
export function DraftResumeBanner<T>({
  draft,
  label = "Unsaved work found",
  onApply,
}: {
  draft: FormDraftApi<T>;
  label?: string;
  onApply: (data: T) => void;
}) {
  if (!draft.hasDraft) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
      <span>
        <span className="font-semibold">{label}</span>
        <span className="text-muted-foreground">
          {" "}
          — {draft.updatedAt ? `last edited ${new Date(draft.updatedAt).toLocaleString()}` : "from your last session"}.
          Resume it or discard it.
        </span>
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            const d = draft.resume();
            if (d) onApply(d);
          }}
          className="rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground"
        >
          Resume draft
        </button>
        <button
          type="button"
          onClick={() => draft.discard()}
          className="rounded-md border border-border px-2.5 py-1 text-muted-foreground"
        >
          Discard
        </button>
      </span>
    </div>
  );
}
