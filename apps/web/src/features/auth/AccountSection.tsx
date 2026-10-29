import { Button } from "@/components/ui/button";
import type { Profile } from "./authContext";
import { GoogleIcon } from "./GoogleIcon";
import { UserAvatar } from "./UserAvatar";

interface Props {
  profile: Profile | null;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function AccountSection({ profile, onSignIn, onSignOut }: Props) {
  if (!profile) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Sign in to save every version you play and let a coach listen along.
        </p>
        <Button size="lg" variant="secondary" onClick={onSignIn}>
          <GoogleIcon />
          Sign in with Google
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar profile={profile} className="size-9" />
        <div className="min-w-0">
          <p className="truncate font-medium">{profile.name}</p>
          <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onSignOut}>
        Sign out
      </Button>
    </div>
  );
}
