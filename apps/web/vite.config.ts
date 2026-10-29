import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": src("./src"),
      // Bundled from source: the web app only needs the schemas, not a build of the package.
      "@jam/shared": src("../../packages/shared/src/index.ts"),
    },
  },
  build: { chunkSizeWarningLimit: 6000 },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8080", "/mcp": "http://localhost:8080" },
  },
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
