import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    // Tests read the shared package from source, so they do not need a build first.
    alias: { "@jam/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)) },
  },
  test: { name: "server", include: ["test/**/*.test.ts"], environment: "node" },
});
