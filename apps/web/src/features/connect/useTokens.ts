import type { TokenInfo } from "@jam/shared";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import type { Api } from "@/lib/api";

export function useTokens(api: Api | null) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  // The plaintext of a just-created token. It exists only in memory, and only
  // for the account that created it.
  const [fresh, setFresh] = useState<{ api: Api; token: string } | null>(null);

  const refresh = useCallback(async () => {
    if (api) setTokens(await api.listTokens());
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let live = true;
    api
      .listTokens()
      .then((list) => live && setTokens(list))
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [api]);

  const create = useCallback(
    async (label: string) => {
      if (!api) return;
      try {
        const created = await api.createToken({ label: label.trim() || "assistant" });
        setFresh({ api, token: created.token });
        track("assistant_connected", { kind: "key" });
        await refresh();
      } catch (err) {
        toast.error("Could not create a key", { description: err instanceof Error ? err.message : String(err) });
      }
    },
    [api, refresh],
  );

  const revoke = useCallback(
    async (id: string) => {
      if (!api) return;
      await api.revokeToken(id);
      toast.success("Key revoked");
      await refresh();
    },
    [api, refresh],
  );

  return { tokens: api ? tokens : [], fresh: fresh?.api === api ? fresh.token : null, create, revoke };
}
