import type { CoachEvent, Session } from "@jam/shared";
import { z } from "zod";
import type { Store } from "../../store/types.js";
import { READ_ONLY, type ToolRegistrar } from "../context.js";
import { jsonResult } from "../result.js";

export const WAIT_DEFAULT_SEC = 300;
export const WAIT_MAX_SEC = 900;
/** How often a waiting coach renews the "Coach listening" heartbeat. */
const HEARTBEAT_MS = 30_000;

/** Resolves on a change in the thread, after `ms`, or when the client goes away. Always stops the listener. */
function nextChange(store: Store, uid: string, sessionId: string, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let stop = () => {};
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, ms));
    signal.addEventListener("abort", finish);
    const unsubscribe = store.watchCoachEvents(uid, sessionId, finish);
    if (done) unsubscribe();
    else stop = unsubscribe;
    if (signal.aborted) finish();
  });
}

const MEANING: Record<CoachEvent["kind"], (e: CoachEvent) => string> = {
  ask: (e) =>
    e.text
      ? "The user typed this question on the page. Answer it."
      : 'The user pressed "Check my music" on the page. Listen to where they are and react.',
  checkin: (e) =>
    e.reason === "runs"
      ? "An automatic check-in: the user ran their code 15 times since the last one. Notice what changed."
      : "An automatic check-in: 10 minutes of playing since the last one. Notice what changed.",
  note: () => "A coach note.",
};

/** What the coach needs to answer an event, in one result. */
async function snapshot(store: Store, uid: string, session: Session, event: CoachEvent) {
  const [version, audio, plan] = await Promise.all([
    store.latestVersion(uid, session.id),
    store.listAudio(uid, 1),
    store.currentPlan(uid, session.id),
  ]);
  const stage = plan ? plan.stages[plan.currentStage] : undefined;
  return {
    event: {
      id: event.id,
      kind: event.kind,
      text: event.text,
      ...(event.reason ? { reason: event.reason } : {}),
      createdAt: event.createdAt,
      meaning: MEANING[event.kind](event),
    },
    session: session.name,
    code: version
      ? { code: version.code, evaluatedAt: version.evaluatedAt, evalCount: version.evalCount }
      : "The user has not evaluated any code in this session yet.",
    lastError: session.lastError ?? null,
    audio: audio[0] ?? null,
    plan: plan
      ? {
          destination: plan.destination,
          currentStage: plan.currentStage,
          stageCount: plan.stages.length,
          ...(stage ? { stage } : { finished: true }),
        }
      : null,
    next: "Answer with say: short, one hint at most, a question. Then call wait_for_change again.",
  };
}

export const registerWaitForChange: ToolRegistrar = (server, { uid, store, coach }) => {
  server.registerTool(
    "wait_for_change",
    {
      title: "Wait for the user",
      description:
        'Live coaching. Waits until the user asks something on the page, presses "Check my music", or an automatic check-in is due, in the session they have open. Returns that event with the current code, lastError, the latest audio snapshot and the plan stage, and marks the event taken. On timeout returns {"event": null}: then call it again and say nothing. It reads the music and never changes it. A long wait needs a long client tool timeout (Claude Code: MCP_TOOL_TIMEOUT in ms).',
      inputSchema: {
        maxWaitSec: z
          .number()
          .int()
          .min(1)
          .max(WAIT_MAX_SEC)
          .default(WAIT_DEFAULT_SEC)
          .describe(
            `Seconds to wait before returning {"event": null}. Default ${WAIT_DEFAULT_SEC}, max ${WAIT_MAX_SEC}.`,
          ),
      },
      // It marks events taken and renews a heartbeat. The music stays read-only.
      annotations: { ...READ_ONLY, idempotentHint: false },
    },
    async ({ maxWaitSec }, extra) => {
      const deadline = coach.now() + maxWaitSec * 1000;
      let beat = -Infinity;
      for (;;) {
        const at = coach.now();
        if (at - beat >= HEARTBEAT_MS) {
          await store.touchCoachListening(uid, at);
          beat = at;
        }
        // Read each time: the user may open another session while the coach waits.
        const session = await store.currentSession(uid);
        await store.tickCoach(uid, session.id, at, false);
        const event = await store.takeCoachEvent(uid, session.id, at);
        if (event) return jsonResult(await snapshot(store, uid, session, event));
        if (at >= deadline || extra.signal.aborted) return jsonResult({ event: null });
        await nextChange(store, uid, session.id, Math.min(coach.pollMs, deadline - at), extra.signal);
      }
    },
  );
};
