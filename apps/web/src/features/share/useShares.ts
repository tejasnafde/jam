import type { Share } from "@jam/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Api } from "@/lib/api";
import { sharesApi } from "@/lib/share-api";

export interface SharesHandle {
  /** Newest first. */
  shares: Share[];
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** Puts a share the dialog just made at the top of the list. */
  added(share: Share): void;
}

/** The signed-in user's share links, for the Sessions section. */
export function useShares(api: Api | null): SharesHandle {
  const client = useMemo(() => (api ? sharesApi(api) : null), [api]);
  // Tagged with the client it was loaded for, so a sign-out never shows stale links.
  const [state, setState] = useState<{ client: ReturnType<typeof sharesApi>; shares: Share[] } | null>(null);
  const shares = state && state.client === client ? state.shares : [];

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .list()
      .then((list) => !cancelled && setState({ client, shares: list }))
      .catch((err: unknown) => console.error(err));
    return () => {
      cancelled = true;
    };
  }, [client]);

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      if (!client) return;
      try {
        const share = await client.update(id, { enabled });
        setState((s) => s && { ...s, shares: s.shares.map((x) => (x.id === id ? share : x)) });
        toast(enabled ? "The link works again." : "The link is off. The page and its audio stop working.");
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Could not change the link.");
      }
    },
    [client],
  );

  const added = useCallback(
    (share: Share) => {
      if (!client) return;
      setState((s) => ({
        client,
        shares: [share, ...(s && s.client === client ? s.shares.filter((x) => x.id !== share.id) : [])],
      }));
    },
    [client],
  );

  return { shares, setEnabled, added };
}
