import { createContext, useContext } from "react";
import type { Api } from "@/lib/api";

export interface Profile {
  name: string;
  email: string;
  photoUrl: string | null;
}

export interface AuthState {
  ready: boolean;
  profile: Profile | null;
  /** Present only when signed in. */
  api: Api | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth needs an AuthProvider");
  return ctx;
}
