import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PanelOverride } from "./App";
import { AuthProvider } from "./features/auth/AuthProvider";
import "./index.css";

const params = new URLSearchParams(location.search);

async function devPreview(): Promise<PanelOverride | undefined> {
  if (!import.meta.env.DEV || !params.has("preview")) return undefined;
  return (await import("./preview")).previewPanel(params.get("preview"));
}

/**
 * /authorize is the OAuth consent page (the server sends it with a request id).
 * Both pages load lazily, so the consent page does not download Strudel.
 */
async function page(): Promise<ReactNode> {
  if (location.pathname === "/authorize") {
    if (import.meta.env.DEV && params.has("preview")) {
      const { ConsentPreview } = await import("./features/consent/preview");
      return <ConsentPreview state={params.get("preview")} />;
    }
    const { ConsentPage } = await import("./features/consent/ConsentPage");
    return <ConsentPage requestId={params.get("request") ?? ""} />;
  }
  const [{ App }, panelOverride] = await Promise.all([import("./App"), devPreview()]);
  return <App panelOverride={panelOverride} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing");

void page().then((content) =>
  createRoot(root).render(
    <StrictMode>
      <AuthProvider>
        <TooltipProvider>
          {content}
          <Toaster position="bottom-left" />
        </TooltipProvider>
      </AuthProvider>
    </StrictMode>,
  ),
);
