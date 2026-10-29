import type { GrantInfo } from "@jam/shared";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Api } from "@/lib/api";

/** Apps connected through OAuth (claude.ai, ChatGPT), with revoke. */
export function useGrants(api: Api | null) {
  const [grants, setGrants] = useState<GrantInfo[]>([]);

  useEffect(() => {
    if (!api) return;
    let live = true;
    api
      .listGrants()
      .then((list) => live && setGrants(list))
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [api]);

  const revoke = useCallback(
    async (id: string) => {
      if (!api) return;
      try {
        await api.revokeGrant(id);
        toast.success("App disconnected");
        setGrants(await api.listGrants());
      } catch (err) {
        toast.error("Could not disconnect", { description: err instanceof Error ? err.message : String(err) });
      }
    },
    [api],
  );

  return { grants: api ? grants : [], revoke };
}
