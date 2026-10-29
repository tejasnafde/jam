// Dev-only fixture for the consent page (?preview=signed-out|signed-in|error). Never bundled in production.
import { ConsentView, type ConsentViewProps } from "./ConsentView";

const base: ConsentViewProps = {
  info: { clientName: "Claude", redirectHost: "claude.ai", scopes: ["jam"], expiresAt: "" },
  error: null,
  profile: null,
  authReady: true,
  busy: false,
  leavingTo: null,
  onSignIn: () => {},
  onSignOut: () => {},
  onDecide: () => {},
};

export function ConsentPreview({ state }: { state: string | null }) {
  if (state === "signed-in") {
    return <ConsentView {...base} profile={{ name: "Tejas", email: "tejas@example.com", photoUrl: null }} />;
  }
  if (state === "error") {
    return <ConsentView {...base} info={null} error="This request has expired or was already answered." />;
  }
  return <ConsentView {...base} />;
}
