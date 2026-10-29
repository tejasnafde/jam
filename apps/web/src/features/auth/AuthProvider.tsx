import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User } from "firebase/auth";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { createApi } from "@/lib/api";
import { auth, googleProvider } from "@/lib/firebase";
import { AuthContext, type AuthState } from "./authContext";

const QUIET_ERRORS = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(auth, (next) => {
        setUser(next);
        setReady(true);
      }),
    [],
  );

  const value = useMemo<AuthState>(() => {
    const signIn = async () => {
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (err) {
        const code = (err as { code?: string }).code ?? "";
        if (!QUIET_ERRORS.has(code)) toast.error("Sign-in did not work", { description: String(err) });
      }
    };
    const profile = user
      ? { name: user.displayName ?? user.email ?? "You", email: user.email ?? "", photoUrl: user.photoURL }
      : null;
    return {
      ready,
      profile,
      api: user ? createApi(() => user.getIdToken()) : null,
      signIn,
      signOut: () => fbSignOut(auth),
    };
  }, [user, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
