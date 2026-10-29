import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App, type PanelOverride } from "./App";
import { AuthProvider } from "./features/auth/AuthProvider";
import "./index.css";

async function devPreview(): Promise<PanelOverride | undefined> {
  if (!import.meta.env.DEV || !new URLSearchParams(location.search).has("preview")) return undefined;
  return (await import("./preview")).PREVIEW_PANEL;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing");

void devPreview().then((panelOverride) =>
  createRoot(root).render(
    <StrictMode>
      <AuthProvider>
        <TooltipProvider>
          <App panelOverride={panelOverride} />
          <Toaster position="bottom-left" />
        </TooltipProvider>
      </AuthProvider>
    </StrictMode>,
  ),
);
