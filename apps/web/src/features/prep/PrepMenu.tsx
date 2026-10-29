import type { PrepOps, Sample } from "@jam/shared";
import { AlertCircle, Check, Gauge, LoaderCircle, Music2, Split, Wand2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shiftKey } from "./keys";
import { isPrepActive, type PrepHandle, type PrepState } from "./usePrep";

export type PrepSample = Pick<Sample, "id" | "name" | "bpm" | "key">;

const NEW_SAMPLES = "The result is a new sample in your library. The original stays as it is.";

export function PrepStatusBadge({ state }: { state: PrepState | undefined }) {
  if (!state) return null;
  if (isPrepActive(state)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-oil" role="status">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        {state.status === "running" ? "Preparing" : "Queued"}
      </span>
    );
  }
  if (state.status === "done") {
    const n = state.sampleIds?.length ?? 0;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-water" role="status">
        <Check className="size-3.5" aria-hidden="true" />
        {n === 1 ? "1 new sample" : `${n} new samples`}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-xs text-destructive" role="status" tabIndex={0}>
          <AlertCircle className="size-3.5" aria-hidden="true" />
          Prep failed
        </span>
      </TooltipTrigger>
      <TooltipContent>{"error" in state && state.error ? state.error : "Prep failed."}</TooltipContent>
    </Tooltip>
  );
}

type Asking = "tempo" | "key" | null;

/** "Prep" actions for one sample: split stems, match tempo, shift key. */
export function PrepMenu({ sample, prep }: { sample: PrepSample; prep: PrepHandle }) {
  const [asking, setAsking] = useState<Asking>(null);
  const state = prep.jobs[sample.id];
  const busy = !!state && isPrepActive(state);
  const run = (ops: PrepOps) => {
    setAsking(null);
    void prep.start(sample.id, ops);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Prep ${sample.name}`} title="Prep">
            <Wand2 aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Make new samples from it</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => run({ split: true })}>
            <Split aria-hidden="true" />
            Split stems
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAsking("tempo")}>
            <Gauge aria-hidden="true" />
            Match tempo...
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAsking("key")}>
            <Music2 aria-hidden="true" />
            Shift key...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Mounted per open, so it starts from the sample's latest detected BPM. */}
      {asking === "tempo" && <TempoDialog sample={sample} open onClose={() => setAsking(null)} onRun={run} />}
      <KeyDialog sample={sample} open={asking === "key"} onClose={() => setAsking(null)} onRun={run} />
    </>
  );
}

interface AskProps {
  sample: PrepSample;
  open: boolean;
  onClose: () => void;
  onRun: (ops: PrepOps) => void;
}

const SOURCE_MIN = 30;
const SOURCE_MAX = 300;
const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
const tidy = (n: number) => String(Math.round(n * 10) / 10);

function TempoDialog({ sample, open, onClose, onRun }: AskProps) {
  const [tempo, setTempo] = useState(String(Math.round(sample.bpm ?? 120)));
  // The detector folds into 70-180 BPM, so a 60 BPM ballad reads as 120. The user can halve or double it.
  const [source, setSource] = useState(sample.bpm ? tidy(sample.bpm) : "");
  const target = useRef<HTMLInputElement>(null);
  const value = Number(tempo);
  const from = Number(source);
  const validTempo = inRange(value, 40, 220);
  const validSource = source === "" || inRange(from, SOURCE_MIN, SOURCE_MAX);
  const valid = validTempo && validSource;
  const scale = (by: number) => setSource(tidy(from * by));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onRun(source === "" ? { tempo: value } : { tempo: value, sourceBpm: from });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-sm"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          target.current?.select();
        }}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Match tempo</DialogTitle>
            <DialogDescription>The pitch stays the same. {NEW_SAMPLES}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-3 text-sm">
              <span className="w-12">From</span>
              <Input
                type="number"
                inputMode="decimal"
                min={SOURCE_MIN}
                max={SOURCE_MAX}
                step="any"
                value={source}
                placeholder="auto"
                onChange={(e) => setSource(e.target.value)}
                className="w-24 font-mono"
                aria-label="Source tempo"
                aria-invalid={!validSource}
              />
              BPM
              <span className="ml-auto flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-mono"
                  disabled={source === "" || !inRange(from / 2, SOURCE_MIN, SOURCE_MAX)}
                  onClick={() => scale(0.5)}
                  aria-label="Halve the source tempo"
                >
                  /2
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-mono"
                  disabled={source === "" || !inRange(from * 2, SOURCE_MIN, SOURCE_MAX)}
                  onClick={() => scale(2)}
                  aria-label="Double the source tempo"
                >
                  x2
                </Button>
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              {sample.bpm
                ? `Detected ${tidy(sample.bpm)} BPM. Detection can be half or double the real tempo.`
                : "Not detected yet. Enter it, or leave it empty to detect it."}
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-12">To</span>
            <Input
              type="number"
              inputMode="numeric"
              min={40}
              max={220}
              step={1}
              value={tempo}
              onChange={(e) => setTempo(e.target.value)}
              className="w-24 font-mono"
              ref={target}
              aria-label="Target tempo"
              aria-invalid={!validTempo}
            />
            BPM
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Match tempo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KeyDialog({ sample, open, onClose, onRun }: AskProps) {
  const [semitones, setSemitones] = useState(0);
  const target = shiftKey(sample.key, semitones);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (semitones !== 0) onRun({ semitones });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Shift key</DialogTitle>
            <DialogDescription>
              {sample.key ? `${sample.name} is in ${sample.key}. ` : ""}
              The tempo stays the same. {NEW_SAMPLES}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={semitones}
              onChange={(e) => setSemitones(Number(e.target.value))}
              className="w-full accent-oil"
              aria-label="Semitones"
              autoFocus
            />
            <p className="flex justify-between text-sm">
              <span className="font-mono">
                {semitones > 0 ? "+" : ""}
                {semitones} semitones
              </span>
              {target && <span className="text-muted-foreground">to {target}</span>}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={semitones === 0}>
              Shift key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
