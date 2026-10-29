import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Profile } from "./authContext";

export function UserAvatar({ profile, className }: { profile: Profile; className?: string }) {
  return (
    <Avatar className={className}>
      {profile.photoUrl && <AvatarImage src={profile.photoUrl} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback className="bg-secondary font-bold text-water">
        {profile.name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
