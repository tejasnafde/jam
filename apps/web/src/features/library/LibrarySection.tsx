import type { SampleWithUrl } from "@jam/shared";
import { Check, Copy, Loader2, Play, Square, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sampleFacts } from "./sampleFile";

interface Props {
  signedIn: boolean;
  samples: SampleWithUrl[];
  uploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
}

function SampleRow({
  sample,
  playing,
  onTogglePlay,
  onDelete,
}: {
  sample: SampleWithUrl;
  playing: boolean;
  onTogglePlay: () => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const usage = `s("${sample.name}")`;
  const copy = async () => {
    await navigator.clipboard.writeText(usage);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <li className="flex items-center gap-1.5 rounded-lg bg-background py-2 pr-1 pl-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onTogglePlay}
        aria-label={playing ? `Stop ${sample.name}` : `Preview ${sample.name}`}
      >
        {playing ? <Square className="text-oil" /> : <Play />}
      </Button>
      <div className="w-0 flex-1">
        <p className="truncate font-mono text-sm" title={sample.name}>
          {sample.name}
        </p>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[11px] text-muted-foreground">
            {sample.kind}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">{sampleFacts(sample)}</span>
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={copied ? "Copied" : `Copy ${usage}`}>
        {copied ? <Check className="text-water" /> : <Copy />}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete ${sample.name}`}>
        <Trash2 />
      </Button>
    </li>
  );
}

export function LibrarySection({ signedIn, samples, uploading, onUpload, onDelete }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  if (!signedIn) {
    return <p className="text-sm text-muted-foreground">Sign in to keep your own samples. They stay private to you.</p>;
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
        <p className="text-sm text-muted-foreground">
          No samples yet. Upload a song or a sound, then play it in your code with{" "}
          <code className="font-mono">s("name")</code>.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Your samples">
          {samples.map((s) => (
            <SampleRow
              key={s.id}
              sample={s}
              playing={playingId === s.id}
              onTogglePlay={() => togglePlay(s)}
              onDelete={() => remove(s)}
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
        <span className="text-xs text-muted-foreground">mp3 or wav, max 50 MB</span>
      </div>
    </div>
  );
}
