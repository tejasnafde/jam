import type { SampleWithUrl } from "@jam/shared";
import { Check, Copy, Loader2, Play, Square, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PrepMenu, PrepStatusBadge } from "@/features/prep/PrepMenu";
import { isPrepActive, type PrepHandle } from "@/features/prep/usePrep";
import { cn } from "@/lib/utils";
import { sampleFacts } from "./sampleFile";

interface Props {
  signedIn: boolean;
  samples: SampleWithUrl[];
  uploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  /** Prep jobs (split, tempo, key). Leave out to hide the Prep menu. */
  prep?: PrepHandle;
}

const KIND_COLOR: Record<SampleWithUrl["kind"], string> = {
  take: "text-oil",
  upload: "text-muted-foreground",
  stem: "text-water",
  prepared: "text-water",
};

const KIND_BAR: Record<SampleWithUrl["kind"], string> = {
  take: "bg-oil-deep",
  upload: "bg-gutter",
  stem: "bg-water-deep",
  prepared: "bg-water-deep",
};

/** A length line: a one-shot take reads short, a whole song reads long (log scale to 5 minutes). */
function Length({ sample }: { sample: SampleWithUrl }) {
  const share = Math.min(1, Math.log1p(sample.durationSec) / Math.log1p(300));
  return (
    <span className="flex h-[3px] w-full overflow-hidden rounded-full bg-secondary" aria-hidden="true">
      <span
        className={cn("h-full rounded-full", KIND_BAR[sample.kind])}
        style={{ width: `${Math.max(4, Math.round(share * 100))}%` }}
      />
    </span>
  );
}

function SampleRow({
  sample,
  playing,
  onTogglePlay,
  onDelete,
  prep,
}: {
  sample: SampleWithUrl;
  playing: boolean;
  onTogglePlay: () => void;
  onDelete: () => void;
  prep?: PrepHandle;
}) {
  const prepState = prep?.jobs[sample.id];
  // The worker reads the source while it runs, so the source stays until the job ends.
  const preparing = !!prepState && isPrepActive(prepState);
  const [copied, setCopied] = useState(false);
  const usage = `s("${sample.name}")`;
  const copy = async () => {
    await navigator.clipboard.writeText(usage);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <li className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-b border-hairline py-2.5 last:border-0">
      <Button
        variant="outline"
        size="icon-sm"
        className={cn("rounded-full", playing && "border-oil text-oil")}
        onClick={onTogglePlay}
        aria-label={playing ? `Stop ${sample.name}` : `Preview ${sample.name}`}
      >
        {playing ? <Square className="fill-current" /> : <Play className="fill-current" />}
      </Button>
      <p className="truncate font-mono text-sm" title={sample.name}>
        {sample.name}
      </p>
      <div className="flex items-center text-muted-foreground transition-colors group-focus-within:text-foreground group-hover:text-foreground">
        {prep && <PrepMenu sample={sample} prep={prep} />}
        <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={copied ? "Copied" : `Copy ${usage}`}>
          {copied ? <Check className="text-water" /> : <Copy />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          disabled={preparing}
          aria-label={`Delete ${sample.name}`}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="col-span-2 col-start-2 flex min-w-0 flex-col gap-1.5">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("shrink-0 font-medium", KIND_COLOR[sample.kind])}>{sample.kind}</span>
          <span className="truncate">{sampleFacts(sample)}</span>
          {prepState && (
            <span className="ml-auto shrink-0">
              <PrepStatusBadge state={prepState} />
            </span>
          )}
        </p>
        <Length sample={sample} />
      </div>
    </li>
  );
}

export function LibrarySection({ signedIn, samples, uploading, onUpload, onDelete, prep }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  if (!signedIn) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        Sign in to keep your own samples. They stay private to you.
      </p>
    );
  }

  const stop = () => {
    audio.current?.pause();
    setPlayingId(null);
  };

  const togglePlay = (s: SampleWithUrl) => {
    const same = playingId === s.id;
    stop();
    if (same) return;
    const el = new Audio(s.url);
    el.onended = () => setPlayingId(null);
    audio.current = el;
    setPlayingId(s.id);
    el.play().catch(() => setPlayingId(null));
  };

  const remove = (s: SampleWithUrl) => {
    if (!window.confirm(`Delete ${s.name}? This cannot be undone.`)) return;
    if (playingId === s.id) stop();
    onDelete(s.id);
  };

  return (
    <div className="flex flex-col gap-3">
      {samples.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Nothing here yet. Upload a song or a sound, then play it with{" "}
          <code className="rounded-sm bg-well px-1 py-0.5 font-mono text-xs text-foreground">s("name")</code>.
        </p>
      ) : (
        <ul className="flex flex-col" aria-label="Your samples">
          {samples.map((s) => (
            <SampleRow
              key={s.id}
              sample={s}
              playing={playingId === s.id}
              onTogglePlay={() => togglePlay(s)}
              onDelete={() => remove(s)}
              prep={prep}
            />
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        accept=".mp3,.wav,audio/mpeg,audio/wav"
        className="hidden"
        aria-label="Audio file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onUpload(file);
        }}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="secondary" size="lg" disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
          {uploading ? "Uploading" : "Upload audio"}
        </Button>
        <span className="text-xs text-muted-foreground">mp3 or wav, up to 50 MB</span>
      </div>
    </div>
  );
}
