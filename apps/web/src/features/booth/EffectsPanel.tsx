import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { KEYS, SCALES, type Key, type Scale } from "./dsp/pitch";
import { DELAY_DIVISIONS, type DelayDivision, type Effects } from "./effects";

type Name = keyof Effects;

const TITLES: Record<Name, string> = {
  autotune: "Pitch correction",
  octave: "Octave layer",
  highpass: "High-pass",
  lowpass: "Low-pass",
  distortion: "Distortion",
  delay: "Delay",
  reverb: "Reverb",
};

function Knob(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-[88px_1fr_56px] items-center gap-3">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <Slider
        aria-label={props.label}
        value={[props.value]}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={props.disabled}
        onValueChange={([v]) => v !== undefined && props.onChange(v)}
      />
      <span className="text-right font-mono text-xs tabular-nums">{props.show(props.value)}</span>
    </div>
  );
}

function Pick<T extends string>(props: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <Select value={props.value} onValueChange={(v) => props.onChange(v as T)} disabled={props.disabled}>
      <SelectTrigger size="sm" aria-label={props.label} className="min-w-0 flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** One card per effect: a bypass switch and its controls. */
export function EffectsPanel({ fx, onChange }: { fx: Effects; onChange: (fx: Effects) => void }) {
  const set = <N extends Name>(name: N, patch: Partial<Effects[N]>) =>
    onChange({ ...fx, [name]: { ...fx[name], ...patch } });

  const card = (name: Name, body: ReactNode) => {
    const on = fx[name].on;
    const id = `fx-${name}`;
    return (
      <section
        key={name}
        className={cn(
          "space-y-3 rounded-lg border border-border p-3 transition-colors",
          on && "border-oil/40 bg-oil/5",
        )}
      >
        <div className="flex items-center justify-between">
          <Label htmlFor={id} className={cn("text-sm", !on && "text-muted-foreground")}>
            {TITLES[name]}
          </Label>
          <Switch id={id} checked={on} onCheckedChange={(v) => set(name, { on: v })} />
        </div>
        {on && body}
      </section>
    );
  };

  const a = fx.autotune;
  return (
    <div className="space-y-2">
      {card(
        "autotune",
        <>
          <div className="flex gap-2">
            <Pick
              label="Key"
              value={a.key}
              options={KEYS}
              onChange={(key: Key) => set("autotune", { key })}
              disabled={!a.on}
            />
            <Pick
              label="Scale"
              value={a.scale}
              options={Object.keys(SCALES) as Scale[]}
              onChange={(scale: Scale) => set("autotune", { scale })}
              disabled={!a.on}
            />
          </div>
          <Knob
            label="Retune"
            value={a.speed}
            min={0}
            max={1}
            step={0.01}
            show={(v) => (v >= 0.8 ? "hard" : v <= 0.2 ? "natural" : pct(v))}
            onChange={(speed) => set("autotune", { speed })}
            disabled={!a.on}
          />
        </>,
      )}
      {card(
        "octave",
        <>
          <div className="flex gap-2">
            <Pick
              label="Octave"
              value={fx.octave.shift > 0 ? "+12 (up)" : "-12 (down)"}
              options={["-12 (down)", "+12 (up)"] as const}
              onChange={(v) => set("octave", { shift: v.startsWith("+") ? 12 : -12 })}
              disabled={!fx.octave.on}
            />
          </div>
          <Knob
            label="Level"
            value={fx.octave.level}
            min={0}
            max={1}
            step={0.01}
            show={pct}
            onChange={(level) => set("octave", { level })}
            disabled={!fx.octave.on}
          />
        </>,
      )}
      {card(
        "highpass",
        <Knob
          label="Cutoff Hz"
          value={fx.highpass.hz}
          min={40}
          max={2000}
          step={10}
          show={hz}
          onChange={(v) => set("highpass", { hz: v })}
          disabled={!fx.highpass.on}
        />,
      )}
      {card(
        "lowpass",
        <Knob
          label="Cutoff Hz"
          value={fx.lowpass.hz}
          min={500}
          max={16000}
          step={100}
          show={hz}
          onChange={(v) => set("lowpass", { hz: v })}
          disabled={!fx.lowpass.on}
        />,
      )}
      {card(
        "distortion",
        <Knob
          label="Drive"
          value={fx.distortion.drive}
          min={0}
          max={1}
          step={0.01}
          show={pct}
          onChange={(drive) => set("distortion", { drive })}
          disabled={!fx.distortion.on}
        />,
      )}
      {card(
        "delay",
        <>
          <div className="flex items-center gap-2">
            <span className="w-[88px] text-xs text-muted-foreground">Time</span>
            <Pick
              label="Delay time"
              value={fx.delay.division}
              options={Object.keys(DELAY_DIVISIONS) as DelayDivision[]}
              onChange={(division: DelayDivision) => set("delay", { division })}
              disabled={!fx.delay.on}
            />
          </div>
          <Knob
            label="Feedback"
            value={fx.delay.feedback}
            min={0}
            max={0.9}
            step={0.01}
            show={pct}
            onChange={(feedback) => set("delay", { feedback })}
            disabled={!fx.delay.on}
          />
          <Knob
            label="Mix"
            value={fx.delay.mix}
            min={0}
            max={1}
            step={0.01}
            show={pct}
            onChange={(mix) => set("delay", { mix })}
            disabled={!fx.delay.on}
          />
        </>,
      )}
      {card(
        "reverb",
        <>
          <Knob
            label="Size"
            value={fx.reverb.seconds}
            min={0.3}
            max={6}
            step={0.1}
            show={(v) => `${v.toFixed(1)} s`}
            onChange={(seconds) => set("reverb", { seconds })}
            disabled={!fx.reverb.on}
          />
          <Knob
            label="Mix"
            value={fx.reverb.mix}
            min={0}
            max={1}
            step={0.01}
            show={pct}
            onChange={(mix) => set("reverb", { mix })}
            disabled={!fx.reverb.on}
          />
        </>,
      )}
    </div>
  );
}
