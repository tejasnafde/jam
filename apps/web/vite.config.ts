import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const API = "http://localhost:8080";
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
  build: {
    chunkSizeWarningLimit: 6000,
    // render.html is the hidden frame that renders a share offline, with its own Strudel.
    rolldownOptions: { input: { main: src("./index.html"), render: src("./render.html") } },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": API,
      "/mcp": API,
      "/.well-known": API,
      "/register": API,
      "/token": API,
      "/revoke": API,
      // The server handles /authorize?client_id=...; the consent page (/authorize?request=...) is this app,
      // and so is its dev-only fixture (/authorize?preview=...).
      "/authorize": {
        target: API,
        bypass: (req) => {
          const params = new URL(req.url ?? "/", "http://x").searchParams;
          return params.has("request") || params.has("preview") ? "/index.html" : undefined;
        },
      },
    },
  },
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
