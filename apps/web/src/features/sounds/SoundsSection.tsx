import { DRUM_PARTS } from "@jam/shared";
import { Check, ChevronRight, Copy, Play, Search, TextCursorInput } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { searchCatalog, type Catalog, type DrumMachine, type SoundItem } from "./catalog";
import { setDraggedSound, SOUND_MIME } from "./dragState";
import { fullSnippet } from "./snippet";
import { previewSound } from "./strudelSounds";
import type { CatalogSource } from "./useSoundCatalog";

interface Props {
  catalog: Catalog;
  source: CatalogSource;
  /** Inserts a sound at the editor's cursor. False when the editor is not ready. */
  onInsert: (item: SoundItem) => boolean;
}

/** Rows rendered per group before "Show more": the full lists run to hundreds of rows. */
export const PAGE = 40;
/** A search opens the machines it matched by part, when there are at most this many. */
const AUTO_OPEN = 6;

type GroupId = "machines" | "samples" | "instruments" | "synths" | "yours";

const GROUPS: { id: Exclude<GroupId, "machines">; title: string }[] = [
  { id: "samples", title: "Samples" },
  { id: "instruments", title: "Instruments" },
  { id: "synths", title: "Synths" },
  { id: "yours", title: "Yours" },
];

const NAV = "[data-sound-nav]";

const variantsFact = (n?: number) => (n && n > 1 ? `${n} variants` : undefined);

function factOf(item: SoundItem): string | undefined {
  if (item.kind === "drum") return DRUM_PARTS[item.name];
  if (item.kind === "instrument") return "plays c3";
  if (item.kind === "yours") return "your sample";
  return variantsFact(item.variants);
}

function SoundRow({
  item,
  active,
  onPreview,
  onInsert,
}: {
  item: SoundItem;
  active: boolean;
  onPreview: () => void;
  onInsert: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const snippet = fullSnippet(item);
  const fact = factOf(item);
  const copy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(SOUND_MIME, JSON.stringify(item));
        e.dataTransfer.setData("text/plain", snippet);
        e.dataTransfer.effectAllowed = "copy";
        setDraggedSound(item);
      }}
      onDragEnd={() => setDraggedSound(null)}
      className="group flex cursor-grab items-center gap-1 border-b border-hairline last:border-0 active:cursor-grabbing"
    >
      <button
        type="button"
        data-sound-nav
        onClick={onPreview}
        title={`Preview, or drag into the editor: ${snippet}`}
        aria-label={`Preview ${item.machine ? `${item.machine} ${item.name}` : item.name}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Play
          className={cn(
            "size-3 flex-none fill-current text-gutter transition-colors group-hover:text-muted-foreground",
            active && "text-oil group-hover:text-oil",
          )}
          aria-hidden="true"
        />
        <span className={cn("truncate font-mono text-sm", active && "text-oil")}>{item.name}</span>
        {fact && <span className="truncate text-xs text-muted-foreground">{fact}</span>}
      </button>
      <span className="flex flex-none items-center text-muted-foreground transition-colors group-focus-within:text-foreground group-hover:text-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onInsert} aria-label={`Insert ${snippet} at cursor`}>
              <TextCursorInput />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Insert at cursor</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={copied ? "Copied" : `Copy ${snippet}`}>
              {copied ? <Check className="text-water" /> : <Copy />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied" : "Copy the code"}</TooltipContent>
        </Tooltip>
      </span>
    </li>
  );
}

function GroupHeading({
  title,
  count,
  open,
  onToggle,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-sound-nav
      aria-expanded={open}
      aria-label={`${title}, ${count}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open)) {
          e.preventDefault();
          onToggle();
        }
      }}
      className="flex w-full items-center gap-2 rounded-sm py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <ChevronRight
        className={cn("size-3.5 flex-none text-muted-foreground transition-transform", open && "rotate-90")}
        aria-hidden="true"
      />
      <span className="flex-1 text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
    </button>
  );
}

function More({ left, onMore }: { left: number; onMore: () => void }) {
  if (left <= 0) return null;
  return (
    <button
      type="button"
      onClick={onMore}
      className="rounded-sm py-1.5 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      Show {Math.min(PAGE, left)} more ({left.toLocaleString()} left)
    </button>
  );
}

function MachineRow({
  machine,
  open,
  onToggle,
  row,
  matched,
}: {
  machine: DrumMachine;
  open: boolean;
  onToggle: () => void;
  row: (item: SoundItem) => ReactNode;
  /** A search matched only some parts: their names show in the fact line, so a closed row shows the hit. */
  matched: boolean;
}) {
  const n = machine.parts.length;
  const parts = matched ? machine.parts.map((p) => p.name).join(" ") : `${n} ${n === 1 ? "part" : "parts"}`;
  const fact = [machine.alias, parts].filter(Boolean).join(" · ");
  return (
    <li className="border-b border-hairline last:border-0">
      <button
        type="button"
        data-sound-nav
        aria-expanded={open}
        aria-label={`${machine.name}, ${fact}`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open)) {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex w-full items-center gap-2.5 rounded-sm py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronRight
          className={cn("size-3 flex-none text-muted-foreground transition-transform", open && "rotate-90 text-oil")}
          aria-hidden="true"
        />
        <span className="truncate font-mono text-sm">{machine.name}</span>
        <span className="min-w-0 shrink-[4] truncate text-xs text-muted-foreground">{fact}</span>
      </button>
      {open && (
        <ul className="mb-1.5 ml-1.5 border-l border-hairline pl-3" aria-label={`${machine.name} parts`}>
          {machine.parts.map(row)}
        </ul>
      )}
    </li>
  );
}

export function SoundsSection({ catalog, source, onInsert }: Props) {
  const [query, setQuery] = useState("");
  // Group and machine toggles hold for one query; a new query opens whatever it finds.
  const [toggles, setToggles] = useState<{ query: string; open: Record<string, boolean> }>({ query: "", open: {} });
  const [shown, setShown] = useState<Record<string, number>>({});
  const [active, setActive] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const found = useMemo(() => searchCatalog(catalog, query), [catalog, query]);
  const searching = query.trim() !== "";
  const toggled = toggles.query === query ? toggles.open : {};
  const isOpen = (id: string, byDefault: boolean) => toggled[id] ?? byDefault;
  const toggle = (id: string, byDefault: boolean) =>
    setToggles({ query, open: { ...toggled, [id]: !isOpen(id, byDefault) } });
  const limit = (id: string) => shown[id] ?? PAGE;
  const more = (id: string) => setShown((s) => ({ ...s, [id]: limit(id) + PAGE }));

  const preview = (item: SoundItem) => {
    setActive(item.key);
    setTimeout(() => setActive((k) => (k === item.key ? null : k)), 600);
    previewSound(item)
      .then((ok) => ok || toast("Strudel is still loading. Try again in a moment."))
      .catch((err: unknown) => console.error(err));
  };
  const insert = (item: SoundItem) => {
    if (!onInsert(item)) toast("The editor is still loading. Try again in a moment.");
  };
  const row = (item: SoundItem) => (
    <SoundRow
      key={item.key}
      item={item}
      active={active === item.key}
      onPreview={() => preview(item)}
      onInsert={() => insert(item)}
    />
  );

  // Arrow keys move between rows and group headings; Enter on a row previews it (a native button click).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(list.current?.querySelectorAll<HTMLElement>(NAV) ?? [])];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? Math.min(items.length - 1, at + 1) : at - 1;
    e.preventDefault();
    if (next < 0) document.getElementById("sound-search")?.focus();
    else items[next]?.focus();
  };

  const groups: { id: GroupId; title: string; count: number; body: () => ReactNode }[] = [
    {
      id: "machines",
      title: "Drum machines",
      count: found.machines.length,
      body: () => (
        <>
          <ul aria-label="Drum machines">
            {found.machines.slice(0, limit("machines")).map((m) => {
              // A search that picks parts out of a few machines opens them; "kick" across 70 machines does not,
              // but each closed row names the parts it matched.
              const matched = searching && m.parts.length < catalogParts(catalog, m.name);
              const byDefault = matched && found.machines.length <= AUTO_OPEN;
              return (
                <MachineRow
                  key={m.name}
                  machine={m}
                  open={isOpen(`m:${m.name}`, byDefault)}
                  onToggle={() => toggle(`m:${m.name}`, byDefault)}
                  row={row}
                  matched={matched}
                />
              );
            })}
          </ul>
          <More left={found.machines.length - limit("machines")} onMore={() => more("machines")} />
        </>
      ),
    },
    ...GROUPS.map(({ id, title }) => ({
      id,
      title,
      count: found[id].length,
      body: () => (
        <>
          <ul aria-label={title}>{found[id].slice(0, limit(id)).map(row)}</ul>
          <More left={found[id].length - limit(id)} onMore={() => more(id)} />
        </>
      ),
    })),
  ];
  // "Yours" shows only when the user has samples; while searching, empty groups hide.
  const visible = groups.filter((g) => (searching ? g.count > 0 : g.id !== "yours" || g.count > 0));

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="sound-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              list.current?.querySelector<HTMLElement>(NAV)?.focus();
            }
          }}
          placeholder="kick, 909, piano, saw"
          aria-label="Search sounds"
          className="pl-8"
        />
      </div>
      {source === "loading" && <p className="text-sm text-muted-foreground">Loading Strudel's sounds...</p>}
      {source === "none" && <p className="text-sm text-muted-foreground">The sound list did not load.</p>}
      {searching && visible.length === 0 && (
        <p className="py-1 text-sm text-muted-foreground">No sound matches "{query.trim()}".</p>
      )}
      <div ref={list} onKeyDown={onKeyDown} className="flex flex-col">
        {visible.map((g) => {
          const open = isOpen(g.id, searching);
          return (
            <div key={g.id} className="border-b border-hairline last:border-0">
              <GroupHeading title={g.title} count={g.count} open={open} onToggle={() => toggle(g.id, searching)} />
              {open && <div className="flex flex-col pb-2 pl-5.5">{g.body()}</div>}
            </div>
          );
        })}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground max-md:hidden">
        Click to hear a sound. Drag it into your code, or use the cursor button.
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground md:hidden">
        Tap a sound to hear it. The cursor button puts it in your code, the copy button copies it.
      </p>
    </div>
  );
}

const catalogParts = (c: Catalog, machine: string) => c.machines.find((m) => m.name === machine)?.parts.length ?? 0;
