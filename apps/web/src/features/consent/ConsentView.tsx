import type { ConsentRequestInfo } from "@jam/shared";
import { Ban, Check } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/features/auth/authContext";
import { GoogleIcon } from "@/features/auth/GoogleIcon";

export interface ConsentViewProps {
  info: ConsentRequestInfo | null;
  error: string | null;
  profile: Profile | null;
  authReady: boolean;
  busy: boolean;
  /** Set once a decision is made: the host the browser is going back to. */
  leavingTo: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onDecide: (allow: boolean) => void;
}

const CAN = [
  "Read your code and its history",
  "Read the sound summary of what you play",
  "Look up Strudel sounds",
  "Write the session plan in your side panel",
];

function Body(props: ConsentViewProps) {
  const { info, error, profile, authReady, busy, leavingTo } = props;
  if (leavingTo) {
    return <p className="text-sm text-muted-foreground">Sending you back to {leavingTo}.</p>;
  }
  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">This request cannot continue</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{error}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">Go back to the app and connect jam again.</p>
      </div>
    );
  }
  if (!info) return <p className="text-sm text-muted-foreground">Loading the request.</p>;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">Connect {info.clientName} to jam?</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          After you answer, you go back to <span className="font-mono text-foreground">{info.redirectHost}</span>.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-water">It can</p>
        <ul className="flex flex-col gap-2" aria-label="It can">
          {CAN.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-sm">
              <Check className="mt-0.5 size-4 flex-none text-water" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
        <p className="pt-2 text-sm font-semibold text-oil">It can never</p>
        <p className="flex items-start gap-2.5 text-sm">
          <Ban className="mt-0.5 size-4 flex-none text-oil" aria-hidden="true" />
          Change your music. jam has no tool that writes code.
        </p>
      </div>

      <div className="border-t border-hairline pt-5">
        {profile ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Signed in as <span className="text-foreground">{profile.email || profile.name}</span>.{" "}
              <button
                type="button"
                className="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={props.onSignOut}
              >
                Use another account
              </button>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="lg" disabled={busy} onClick={() => props.onDecide(false)}>
                Deny
              </Button>
              <Button size="lg" className="min-w-24 font-bold" disabled={busy} onClick={() => props.onDecide(true)}>
                Allow
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Sign in to choose which jam account to connect.
            </p>
            <Button size="lg" variant="secondary" disabled={!authReady} onClick={props.onSignIn}>
              <GoogleIcon />
              Sign in with Google
            </Button>
          </div>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        You can disconnect it at any time on the jam page, under Connect an assistant.
      </p>
    </div>
  );
}

/** The OAuth consent page. Pure: ConsentPage supplies the data and the actions. */
export function ConsentView(props: ConsentViewProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-5 py-10 sm:py-16">
        <a
          href="/"
          className="flex w-fit items-center gap-2 rounded-md text-[22px] font-bold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="jam home"
        >
          <Logo className="size-8" />
          <span>jam</span>
        </a>
        <Body {...props} />
      </main>
    </div>
  );
}
