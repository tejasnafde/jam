import type { Session, VersionPage } from "@jam/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Api } from "@/lib/api";
import { freshName, NEW_SESSION_CODE, readDraft, startCode, writeDraftMeta } from "./draft";

/** What the sessions need from the editor. None of it evaluates code. */
export interface EditorBridge {
  /** The text in the editor now, or null before the editor loads. */
  getCode(): string | null;
  /** Puts code in the editor as an edit. Never evaluates, and Live mode does not pick it up. */
  replaceCode(code: string): void;
  /** Saves a Live version that waits for its window now, so it lands in the session it was made in. */
  flushVersions(): void;
}

export interface SessionsHandle {
  sessions: Session[];
  /** The open session. Null while signed out or loading. */
  currentId: string | null;
  create(): Promise<void>;
  open(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Puts an older version's code in the editor as a new edit (opening its session first). Never evaluates. */
  restore(sessionId: string, code: string): Promise<void>;
  loadVersions(id: string, before?: string | null): Promise<VersionPage>;
}

/** How long the editor text waits after the last keystroke before it is saved as the session's lastCode. */
export const DRAFT_SAVE_MS = 3000;

const byEdit = (list: Session[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const fail = (what: string) => (err: unknown) => {
  console.error(err);
  toast.error(`Could not ${what}. ${err instanceof Error ? err.message : ""}`.trim());
};

/**
 * Named sessions. The open one gets every version, its own plan, and a saved draft of the
 * editor text, so a piece can be picked up later on any computer. Switching saves the text
 * of the session the user leaves; opening never evaluates.
 */
export function useSessions(api: Api | null, editor: EditorBridge) {
  // Tagged with the account it was loaded for, so a sign-out never shows stale sessions.
  const [state, setState] = useState<{ api: Api; sessions: Session[]; currentId: string } | null>(null);
  const live = state && state.api === api ? state : null;
  const stateRef = useRef(live);
  useLayoutEffect(() => {
    stateRef.current = live;
  });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<{ id: string; code: string } | null>(null);

  const patchLocal = useCallback((id: string, patch: Partial<Session>) => {
    setState((s) =>
      s ? { ...s, sessions: byEdit(s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x))) } : s,
    );
  }, []);

  const saveDraftNow = useCallback(async () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    const draft = pendingDraft.current;
    pendingDraft.current = null;
    if (!api || !draft) return;
    const known = stateRef.current?.sessions.find((x) => x.id === draft.id);
    if (!known || known.lastCode === draft.code) return;
    const saved = await api.updateSession(draft.id, { lastCode: draft.code });
    patchLocal(saved.id, saved);
  }, [api, patchLocal]);

  const scheduleDraft = useCallback(
    (id: string, code: string) => {
      pendingDraft.current = { id, code };
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => void saveDraftNow().catch(console.error), DRAFT_SAVE_MS);
    },
    [saveDraftNow],
  );

  // Sign-in: load the sessions, then decide whether the editor shows this browser's text or the session's.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      const { sessions, currentId } = await api.listSessions();
      if (cancelled) return;
      const local = readDraft();
      // Text this browser wrote for another session, and never saved, is saved there first.
      const other = local.meta?.sessionId ? sessions.find((x) => x.id === local.meta?.sessionId) : undefined;
      if (other && other.id !== currentId && local.code && local.code !== other.lastCode) {
        if ((local.meta?.editedAt ?? 0) > Date.parse(other.updatedAt)) {
          await api.updateSession(other.id, { lastCode: local.code }).catch(console.error);
        }
      }
      if (cancelled) return;
      setState({ api, sessions: byEdit(sessions), currentId });
      const current = sessions.find((x) => x.id === currentId);
      if (!current) return;
      const code = startCode(current, local);
      if (code !== null) {
        editor.replaceCode(code);
        writeDraftMeta({ sessionId: currentId, editedAt: Date.parse(current.updatedAt) });
      } else if (local.code && local.code !== current.lastCode) {
        writeDraftMeta({ sessionId: currentId, editedAt: Date.now() });
        pendingDraft.current = { id: currentId, code: local.code };
        await saveDraftNow().catch(console.error);
      }
    })().catch(fail("load your sessions"));
    return () => {
      cancelled = true;
    };
  }, [api, editor, saveDraftNow]);

  // Leaving the page: the last keystrokes still go to the server.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void saveDraftNow().catch(console.error);
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [saveDraftNow]);

  /** Every edit in the editor. Saved locally at once, and on the server after a pause. */
  const onEdit = useCallback(
    (code: string) => {
      const id = stateRef.current?.currentId ?? null;
      writeDraftMeta({ sessionId: id, editedAt: Date.now() });
      if (id) scheduleDraft(id, code);
    },
    [scheduleDraft],
  );

  /** A version was saved: its session's count and lastCode changed on the server. */
  const refresh = useCallback(async () => {
    if (!api) return;
    const { sessions } = await api.listSessions();
    setState((s) => (s && s.api === api ? { ...s, sessions: byEdit(sessions) } : s));
  }, [api]);

  const open = useCallback(
    async (id: string) => {
      const s = stateRef.current;
      if (!api || !s || s.currentId === id) return;
      // A waiting Live version belongs to the session the user leaves.
      editor.flushVersions();
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = null;
      pendingDraft.current = null;
      const code = editor.getCode();
      const previous = code === null ? undefined : { id: s.currentId, lastCode: code };
      const { session } = await api.openSession(id, previous);
      setState((st) => {
        if (!st) return st;
        const sessions = st.sessions.map((x) => {
          if (x.id === session.id) return session;
          if (previous && x.id === previous.id && x.lastCode !== previous.lastCode) {
            return { ...x, lastCode: previous.lastCode, updatedAt: new Date().toISOString() };
          }
          return x;
        });
        return { ...st, sessions: byEdit(sessions), currentId: session.id };
      });
      stateRef.current = { ...s, currentId: session.id };
      editor.replaceCode(session.lastCode);
      writeDraftMeta({ sessionId: session.id, editedAt: Date.parse(session.updatedAt) });
    },
    [api, editor],
  );

  const create = useCallback(async () => {
    const s = stateRef.current;
    if (!api || !s) return;
    const made = await api.createSession(freshName(s.sessions), NEW_SESSION_CODE);
    setState((st) => (st ? { ...st, sessions: [made, ...st.sessions] } : st));
    stateRef.current = { ...s, sessions: [made, ...s.sessions] };
    await open(made.id);
  }, [api, open]);

  const rename = useCallback(
    async (id: string, name: string) => {
      if (!api) return;
      patchLocal(id, await api.updateSession(id, { name }));
    },
    [api, patchLocal],
  );

  const duplicate = useCallback(
    async (id: string) => {
      const s = stateRef.current;
      if (!api || !s) return;
      // The copy takes the text in the editor now, not the last saved draft.
      if (id === s.currentId) {
        const code = editor.getCode();
        if (code !== null) pendingDraft.current = { id, code };
        await saveDraftNow();
      }
      const copy = await api.duplicateSession(id);
      setState((st) => (st ? { ...st, sessions: byEdit([copy, ...st.sessions]) } : st));
    },
    [api, editor, saveDraftNow],
  );

  const remove = useCallback(
    async (id: string) => {
      const s = stateRef.current;
      if (!api || !s) return;
      const wasOpen = id === s.currentId;
      if (wasOpen) {
        editor.flushVersions();
        if (draftTimer.current) clearTimeout(draftTimer.current);
        draftTimer.current = null;
        pendingDraft.current = null;
      }
      await api.deleteSession(id);
      // The server picks the next session (or makes a new Untitled one).
      const { sessions, currentId } = await api.listSessions();
      setState({ api, sessions: byEdit(sessions), currentId: wasOpen ? currentId : s.currentId });
      if (!wasOpen) return;
      const next = sessions.find((x) => x.id === currentId);
      editor.replaceCode(next?.lastCode ?? "");
      writeDraftMeta({ sessionId: currentId, editedAt: next ? Date.parse(next.updatedAt) : Date.now() });
    },
    [api, editor],
  );

  const restore = useCallback(
    async (sessionId: string, code: string) => {
      if (stateRef.current?.currentId !== sessionId) await open(sessionId);
      if (stateRef.current?.currentId !== sessionId) return;
      editor.replaceCode(code);
      // A new edit: saved as the session's text like any other, and never evaluated.
      writeDraftMeta({ sessionId, editedAt: Date.now() });
      scheduleDraft(sessionId, code);
    },
    [editor, open, scheduleDraft],
  );

  const loadVersions = useCallback(
    async (id: string, before?: string | null) => {
      if (!api) throw new Error("Sign in to see versions.");
      return api.sessionVersions(id, before);
    },
    [api],
  );

  const handle: SessionsHandle = useMemo(
    () => ({
      sessions: live?.sessions ?? [],
      currentId: live?.currentId ?? null,
      create: () => create().catch(fail("make a session")),
      open: (id) => open(id).catch(fail("open that session")),
      rename: (id, name) => rename(id, name).catch(fail("rename that session")),
      duplicate: (id) => duplicate(id).catch(fail("duplicate that session")),
      remove: (id) => remove(id).catch(fail("delete that session")),
      restore: (id, code) => restore(id, code).catch(fail("restore that version")),
      loadVersions,
    }),
    [live, create, open, rename, duplicate, remove, restore, loadVersions],
  );

  /** For the editor: the session a version goes to, read when the version is saved. */
  const getSessionId = useCallback(() => stateRef.current?.currentId ?? null, []);

  return { handle, onEdit, refresh, getSessionId };
}
