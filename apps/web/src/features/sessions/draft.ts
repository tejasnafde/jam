import type { Session } from "@jam/shared";
import { DEFAULT_CODE, LOCAL_CODE_KEY } from "@/features/editor/defaultCode";

/** Which session the editor text in localStorage belongs to, and when the user last typed in it. */
export interface DraftMeta {
  sessionId: string | null;
  editedAt: number;
}

const META_KEY = "jam:code-meta";

export function readDraft(): { code: string | null; meta: DraftMeta | null } {
  const code = localStorage.getItem(LOCAL_CODE_KEY);
  try {
    const raw = JSON.parse(localStorage.getItem(META_KEY) ?? "null") as Partial<DraftMeta> | null;
    const meta =
      raw && typeof raw.editedAt === "number" && (typeof raw.sessionId === "string" || raw.sessionId === null)
        ? { sessionId: raw.sessionId, editedAt: raw.editedAt }
        : null;
    return { code, meta };
  } catch {
    return { code, meta: null };
  }
}

export function writeDraftMeta(meta: DraftMeta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

/**
 * On sign-in: the code to put in the editor, or null to keep what this browser has.
 * The browser's text wins when it is newer than the session's last save, or when it
 * was written before sessions existed (or signed out) and is the user's own.
 */
export function startCode(session: Session, local: { code: string | null; meta: DraftMeta | null }): string | null {
  if (!session.lastCode || local.code === session.lastCode) return null;
  const { code, meta } = local;
  const own = !!code && code !== DEFAULT_CODE;
  if (!meta || meta.sessionId === null) return own ? null : session.lastCode;
  if (meta.sessionId === session.id && own && meta.editedAt >= Date.parse(session.updatedAt)) return null;
  return session.lastCode;
}

/** "just now", "4 min ago", "3 h ago", "2 d ago", then a date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const minutes = Math.round((now - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** A time of day for a version row: "14:05", with the day when it is not today. */
export function versionTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

/** "Untitled", then "Untitled 2", "Untitled 3": the first name not in use. */
export function freshName(sessions: Pick<Session, "name">[], base = "Untitled"): string {
  const taken = new Set(sessions.map((s) => s.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** The text a new session starts with. */
export const NEW_SESSION_CODE = `// A new piece. Ctrl+Enter plays, Ctrl+. stops.
setcpm(90/4)

`;
