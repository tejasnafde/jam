import { defineConfig } from "vitest/config";

// One workspace config per app; the root runs them all.
export default defineConfig({
  test: { projects: ["apps/server", "apps/web"] },
});
