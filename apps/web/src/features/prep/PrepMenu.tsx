import type { PrepOps, Sample } from "@jam/shared";
import { AlertCircle, Check, Gauge, LoaderCircle, Music2, Split, Wand2 } from "lucide-react";
import { useState, type FormEvent } from "react";
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
          <Button variant="ghost" size="sm" disabled={busy} aria-label={`Prep ${sample.name}`}>
            <Wand2 aria-hidden="true" />
            Prep
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
      <TempoDialog sample={sample} open={asking === "tempo"} onClose={() => setAsking(null)} onRun={run} />
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

function TempoDialog({ sample, open, onClose, onRun }: AskProps) {
  const [tempo, setTempo] = useState(String(Math.round(sample.bpm ?? 120)));
  const value = Number(tempo);
  const valid = Number.isFinite(value) && value >= 40 && value <= 220;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onRun({ tempo: value });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Match tempo</DialogTitle>
            <DialogDescription>
              {sample.bpm ? `${sample.name} is about ${Math.round(sample.bpm)} BPM. ` : ""}
              The pitch stays the same. {NEW_SAMPLES}
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-3 text-sm">
            Target
            <Input
              type="number"
              inputMode="numeric"
              min={40}
              max={220}
              step={1}
              value={tempo}
              onChange={(e) => setTempo(e.target.value)}
              className="w-24 font-mono"
              aria-invalid={!valid}
              autoFocus
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
