import { Pencil } from "lucide-react";
import { useState } from "react";
import { NameField } from "./SessionsSection";
import type { SessionsHandle } from "./useSessions";

/** The open session's name in the top bar. Select it to rename it in place. */
export function SessionName({ sessions }: { sessions: SessionsHandle }) {
  const [editing, setEditing] = useState(false);
  const current = sessions.sessions.find((s) => s.id === sessions.currentId);
  if (!current) return null;
  if (editing) {
    return (
      <NameField
        value={current.name}
        label="Session name"
        onSave={(name) => void sessions.rename(current.id, name)}
        onDone={() => setEditing(false)}
        className="w-56 max-w-full"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Rename this session"
      aria-label={`Session ${current.name}. Rename`}
      className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium outline-none hover:bg-secondary/60 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="truncate">{current.name}</span>
      <Pencil
        className="size-3.5 flex-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden="true"
      />
    </button>
  );
}
