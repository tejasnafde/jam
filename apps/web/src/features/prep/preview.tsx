// Dev-only fixture page for prep-preview.html. Rows stand in for the Library list.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PanelCard } from "@/components/PanelCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/index.css";
import { PrepMenu, PrepStatusBadge, type PrepSample } from "./PrepMenu";
import { usePrep, type PrepState } from "./usePrep";

const SAMPLES: (PrepSample & { fixed?: PrepState })[] = [
  { id: "a", name: "rainy_loop", bpm: 92, key: "A minor" },
  { id: "b", name: "street_song", bpm: 128, key: "F# minor", fixed: { status: "running", jobId: "j" } },
  { id: "c", name: "tone_click", bpm: 120, key: "C major", fixed: { status: "done", sampleIds: ["1", "2", "3", "4"] } },
  { id: "d", name: "old_take", fixed: { status: "failed", error: "The source is longer than 10 minutes." } },
];

const fakeApi = {
  startPrep: async () => ({ jobId: "demo" }),
  prepStatus: async () => ({ status: "running" as const }),
};

// eslint-disable-next-line react-refresh/only-export-components -- a page entry, not a module
function Preview() {
  const prep = usePrep(fakeApi);
  return (
    <div className="mx-auto max-w-[320px] p-4">
      <PanelCard title="Library">
        <ul className="flex flex-col gap-2">
          {SAMPLES.map((s) => {
            const handle = s.fixed ? { ...prep, jobs: { ...prep.jobs, [s.id]: s.fixed } } : prep;
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-background py-2 pr-1 pl-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[s.bpm && `${s.bpm} BPM`, s.key].filter(Boolean).join(" · ") || "not analysed"}
                  </p>
                  <PrepStatusBadge state={handle.jobs[s.id]} />
                </div>
                <PrepMenu sample={s} prep={handle} />
              </li>
            );
          })}
        </ul>
      </PanelCard>
    </div>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider>
        <Preview />
      </TooltipProvider>
    </StrictMode>,
  );
