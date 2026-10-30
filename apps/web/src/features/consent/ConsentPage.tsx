import type { ConsentRequestInfo } from "@jam/shared";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/authContext";
import { track } from "@/lib/analytics";
import { fetchConsentRequest } from "@/lib/api";
import { ConsentView } from "./ConsentView";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** /authorize?request=<id>: loads the pending request, then sends the browser back with the answer. */
export function ConsentPage({ requestId }: { requestId: string }) {
  const auth = useAuth();
  const [info, setInfo] = useState<ConsentRequestInfo | null>(null);
  const [error, setError] = useState<string | null>(requestId ? null : "The link has no request in it.");
  const [busy, setBusy] = useState(false);
  const [leavingTo, setLeavingTo] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) return;
    let live = true;
    fetchConsentRequest(requestId)
      .then((next) => live && setInfo(next))
      .catch((err: unknown) => live && setError(message(err)));
    return () => {
      live = false;
    };
  }, [requestId]);

  const decide = async (allow: boolean) => {
    if (!auth.api || busy) return;
    setBusy(true);
    try {
      const { redirectTo } = await auth.api.decideConsent(requestId, allow);
      if (allow) track("assistant_connected", { kind: "oauth" });
      setLeavingTo(new URL(redirectTo).host);
      window.location.assign(redirectTo);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <ConsentView
      info={info}
      error={error}
      profile={auth.profile}
      authReady={auth.ready}
      busy={busy}
      leavingTo={leavingTo}
      onSignIn={() => void auth.signIn()}
      onSignOut={() => void auth.signOut()}
      onDecide={(allow) => void decide(allow)}
    />
  );
}
