import { SampleName } from "@jam/shared";
import { Headphones, Loader2, Mic, Play, Save, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/features/auth/authContext";
import { toSampleName } from "@/features/library/sampleFile";
import type { useSamples } from "@/features/library/useSamples";
import { cn } from "@/lib/utils";
import { DRY, needsPitch, opsFor, pitchInWorker, preset, renderTake, type Effects, type PresetName } from "./effects";
import { EffectsPanel } from "./EffectsPanel";
import { saveTake } from "./saveTake";
import { Scope } from "./Scope";
import { useRecorder, type Take } from "./useRecorder";

const PRESETS: PresetName[] = ["dry", "far away", "hard tune", "dark double"];
const COUNT_INS = { off: 0, "1 bar": 4, "2 bars": 8 } as const;
type CountIn = keyof typeof COUNT_INS;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const defaultName = () => {
  const d = new Date();
  return `take_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
};

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="font-mono text-base font-medium tabular-nums text-oil">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>
  );
}

/**
 * The vocal booth: record from the mic, shape the take with effects, preview it,
 * and save it to the sample library so Strudel can play it with s("name").
 */
export function Booth({ getCps, library }: { getCps: () => number | null; library: ReturnType<typeof useSamples> }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [take, setTake] = useState<Take | null>(null);
  const [fx, setFx] = useState<Effects>(DRY);
  const [bpm, setBpm] = useState(120);
  const [bpmFromStrudel, setBpmFromStrudel] = useState(false);
  const [countIn, setCountIn] = useState<CountIn>("1 bar");
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState<"render" | "save" | null>(null);
  const [playing, setPlaying] = useState(false);
  const rendered = useRef<{ key: string; take: Take; audio: AudioBuffer } | null>(null);
  const tracks = useRef(new WeakMap<Take, Float32Array>()); // pitch track per take
  const freeName = (base: string, also: string[] = []) =>
    toSampleName(base, new Set([...library.samples.map((s) => s.name), ...also]));
  const player = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode | null } | null>(null);
  const mic = useRecorder((t) => {
    setTake(t);
    setName(freeName(defaultName()));
  });

  const stopPreview = () => {
    const p = player.current;
    if (p?.src) {
      p.src.onended = null;
      p.src.stop();
      p.src = null;
    }
    setPlaying(false);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      const cps = getCps();
      if (cps && cps > 0) setBpm(Math.round(cps * 240));
      setBpmFromStrudel(Boolean(cps));
    } else {
      stopPreview();
      mic.release();
    }
  };

  /** Renders the take with the current settings, reusing the last render if nothing changed. */
  async function render(): Promise<AudioBuffer | null> {
    if (!take) return null;
    const key = JSON.stringify({ fx, bpm });
    const last = rendered.current;
    if (last && last.key === key && last.take === take) return last.audio;
    setBusy("render");
    try {
      let x = take.data;
      if (needsPitch(fx)) {
        const job = { dry: take.data, sampleRate: take.sampleRate, fx, track: tracks.current.get(take) };
        const done = await pitchInWorker(job);
        tracks.current.set(take, done.track);
        x = done.x;
      }
      const audio = await renderTake(x, take.sampleRate, fx, bpm);
      rendered.current = { key, take, audio };
      return audio;
    } finally {
      setBusy(null);
    }
  }

  async function togglePreview() {
    if (playing) return stopPreview();
    try {
      const audio = await render();
      if (!audio) return;
      player.current ??= { ctx: new AudioContext(), src: null };
      const p = player.current;
      await p.ctx.resume();
      const src = new AudioBufferSourceNode(p.ctx, { buffer: audio });
      src.connect(p.ctx.destination);
      src.onended = () => setPlaying(false);
      src.start();
      p.src = src;
      setPlaying(true);
    } catch (err) {
      toast.error("The preview did not play", { description: message(err) });
    }
  }

  const nameOk = SampleName.safeParse(name).success;

  async function save() {
    const client = library.client;
    if (!client) return;
    try {
      const audio = await render();
      if (!audio) return;
      setBusy("save");
      const a = fx.autotune;
      await saveTake(client, audio, {
        name,
        ops: opsFor(fx, bpm),
        bpm: bpmFromStrudel || countIn !== "off" ? bpm : undefined,
        key: a.on ? `${a.key} ${a.scale}` : undefined,
      });
      // Registers the new sample with Strudel before the toast says it plays.
      await library.refresh().catch(console.error);
      toast.success(`Saved "${name}"`, { description: `Play it with s("${name}")` });
      setName(freeName(name, [name])); // the next save of this take gets a new name
    } catch (err) {
      toast.error("The take did not save", { description: message(err) });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => () => void player.current?.ctx.close(), []);

  const recording = mic.phase === "recording" || mic.phase === "counting";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Vocal booth"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <Mic className="size-4" />
          <span className="max-sm:hidden">Booth</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="gap-1 px-5 pt-5 pb-0">
          <SheetTitle className="text-xl font-semibold tracking-tight">Vocal booth</SheetTitle>
          <SheetDescription className="leading-relaxed">
            Record a take, shape it, and save it as a sample for Strudel.
          </SheetDescription>
          <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Headphones className="mt-0.5 size-3.5 flex-none text-water" aria-hidden="true" />
            <span>Wear headphones. Speakers leak into the mic, and the count-in clicks get on the take.</span>
          </p>
        </SheetHeader>

        <div className="space-y-6 p-5">
          <section className="space-y-3">
            <Scope analyser={recording || !take ? mic.analyser : null} take={take?.data ?? null} hot={recording} />
            {mic.phase === "off" || mic.phase === "asking" || mic.phase === "denied" ? (
              <div className="space-y-2">
                <Button
                  onClick={() => void mic.enable()}
                  disabled={mic.phase === "asking"}
                  size="lg"
                  className="w-full rounded-full font-bold"
                >
                  {mic.phase === "asking" ? <Loader2 className="animate-spin" /> : <Mic />}
                  {mic.phase === "asking" ? "Waiting for permission" : "Allow microphone"}
                </Button>
                {mic.phase === "denied" && (
                  <p className="text-sm text-destructive" role="alert">
                    The microphone is blocked. Allow it in the site settings of your browser, then try again.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => (recording ? mic.stop() : mic.record(COUNT_INS[countIn], bpm))}
                  variant={recording ? "default" : "outline"}
                  size="lg"
                  className={cn("min-w-28 rounded-full font-bold", recording && "jam-breathe")}
                  aria-label={recording ? "Stop recording" : "Record"}
                >
                  {recording ? <Square className="fill-current" /> : <span className="size-3 rounded-full bg-oil" />}
                  {mic.phase === "counting" ? "Count-in" : recording ? "Stop" : "Record"}
                </Button>
                {mic.phase === "recording" && <Elapsed since={mic.startedAt} />}
                <div className="ml-auto flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Count-in</Label>
                  <Select value={countIn} onValueChange={(v) => setCountIn(v as CountIn)} disabled={recording}>
                    <SelectTrigger size="sm" aria-label="Count-in" className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(COUNT_INS).map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Label htmlFor="booth-bpm" className="text-xs text-muted-foreground">
                Tempo
              </Label>
              <Input
                id="booth-bpm"
                type="number"
                min={40}
                max={220}
                value={bpm}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 40 && v <= 220) setBpm(v);
                  setBpmFromStrudel(false);
                }}
                className="h-7 w-20 font-mono"
                disabled={recording}
              />
              <span>bpm{bpmFromStrudel ? ", from Strudel" : ""}</span>
              <span className="basis-full">The count-in and the delay follow it.</span>
            </div>
          </section>

          {take && !recording && (
            <>
              <section className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-semibold tracking-tight">Effects</h3>
                  <span className="text-xs text-muted-foreground">Presets</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <Button
                      key={p}
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => setFx(preset(p, fx))}
                    >
                      {p}
                    </Button>
                  ))}
                </div>
                <EffectsPanel fx={fx} onChange={setFx} />
              </section>

              <section className="sticky bottom-0 -mx-5 space-y-3 border-t border-hairline bg-background p-5">
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => void togglePreview()} disabled={busy !== null}>
                    {busy === "render" ? <Loader2 className="animate-spin" /> : playing ? <Square /> : <Play />}
                    {playing ? "Stop" : "Preview"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {take.data.length / take.sampleRate < 1
                      ? ""
                      : `${(take.data.length / take.sampleRate).toFixed(1)} s take`}
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <Input
                      aria-label="Sample name"
                      value={name}
                      onChange={(e) => setName(e.target.value.toLowerCase())}
                      aria-invalid={!nameOk}
                      className="font-mono"
                    />
                    <p className={cn("text-xs", nameOk ? "text-muted-foreground" : "text-destructive")}>
                      {nameOk ? `Plays with s("${name}")` : "2 to 40 characters: a-z first, then a-z, 0-9 or _"}
                    </p>
                  </div>
                  <Button
                    onClick={() => void save()}
                    disabled={!nameOk || busy !== null || !profile || !library.client}
                  >
                    {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
                    Save
                  </Button>
                </div>
                {!profile && <p className="text-xs text-muted-foreground">Sign in to save takes to your library.</p>}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
