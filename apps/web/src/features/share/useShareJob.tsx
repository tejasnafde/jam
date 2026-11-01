import type { Share } from "@jam/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Api } from "@/lib/api";
import { measure } from "@/lib/audio";
import { sharesApi } from "@/lib/share-api";
import { ShareCancelled, ShareProblem, runOfflineShare, type OfflineShareDeps, type ShareDraft } from "./offlineShare";
import { renderInFrame } from "./render/protocol";
import { ShareErrorToast } from "./ShareStatus";

export type ShareJob =
  | { kind: "idle" }
  | { kind: "preparing"; title: string; fraction: number }
  | { kind: "ready"; title: string; url: string }
  | { kind: "failed"; title: string; message: string; offerRealtime: boolean };

interface Options {
  api: Api | null;
  sampleMap: Record<string, string | string[]>;
  onCreated: (share: Share) => void;
  /** Opens the dialog to record the same share in real time (the old path). */
  onRealtime: (draft: ShareDraft) => void;
  /** Stand-in for the frame render, for the dev preview. */
  render?: OfflineShareDeps["render"];
}

/** The page's music is audible when its analyser reads anything above the noise floor. */
const liveAudible = async () => (await measure(400)) !== null;

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  } catch {
    toast.error("Could not copy. Open the link and copy it from the address bar.");
  }
}

/**
 * One share made in the background at a time. The dialog hands over a draft and closes; the top
 * bar shows this job's state, and a toast says when the link is ready or failed.
 */
export function useShareJob({ api, sampleMap, onCreated, onRealtime, render = renderInFrame }: Options) {
  const [job, setJob] = useState<ShareJob>({ kind: "idle" });
  const draft = useRef<ShareDraft | null>(null);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef({ api, sampleMap, onCreated, onRealtime, render });
  // The toast's Retry starts the same draft again.
  const startRef = useRef<(d: ShareDraft) => void>(() => {});
  useEffect(() => {
    latest.current = { api, sampleMap, onCreated, onRealtime, render };
  });
  useEffect(() => () => abort.current?.abort(), []);

  const realtime = useCallback(() => {
    if (!draft.current) return;
    setJob({ kind: "idle" });
    latest.current.onRealtime(draft.current);
  }, []);

  const start = useCallback(
    (next: ShareDraft) => {
      const { api: currentApi, sampleMap: map, render: renderer } = latest.current;
      if (!currentApi) return;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      draft.current = next;
      const title = next.title;
      setJob({ kind: "preparing", title, fraction: 0 });
      const deps: OfflineShareDeps = {
        client: sharesApi(currentApi),
        render: renderer,
        liveAudible,
        sampleMap: map,
      };
      const onProgress = (fraction: number) => {
        if (abort.current === controller) setJob({ kind: "preparing", title, fraction });
      };
      runOfflineShare(next, deps, onProgress, controller.signal)
        .then(({ share, url }) => {
          if (abort.current !== controller) return;
          latest.current.onCreated(share);
          setJob({ kind: "ready", title, url });
          toast.success("Link ready", {
            description: title,
            action: { label: "Copy link", onClick: () => void copyLink(url) },
          });
        })
        .catch((err: unknown) => {
          if (abort.current !== controller || err instanceof ShareCancelled) return;
          const problem = err instanceof ShareProblem ? err : new ShareProblem(String(err), false);
          setJob({ kind: "failed", title, message: problem.message, offerRealtime: problem.offerRealtime });
          toast.custom(
            (id) => (
              <ShareErrorToast
                message={problem.message}
                offerRealtime={problem.offerRealtime}
                onRetry={() => {
                  toast.dismiss(id);
                  startRef.current(next);
                }}
                onRealtime={() => {
                  toast.dismiss(id);
                  realtime();
                }}
                onClose={() => toast.dismiss(id)}
              />
            ),
            { duration: 20_000 },
          );
        });
    },
    [realtime],
  );

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const retry = useCallback(() => {
    if (draft.current) start(draft.current);
  }, [start]);

  const dismiss = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setJob({ kind: "idle" });
  }, []);

  return { job, start, retry, realtime, dismiss };
}

export type ShareJobHandle = ReturnType<typeof useShareJob>;
