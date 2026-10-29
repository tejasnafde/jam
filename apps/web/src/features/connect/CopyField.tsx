import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-start gap-1 rounded-md bg-well py-1 pr-1 pl-2.5">
      <code className="min-w-0 flex-1 py-1 font-mono text-xs leading-relaxed break-all text-foreground/90">
        {value}
      </code>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        onClick={copy}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
      >
        {copied ? <Check className="text-water" /> : <Copy />}
      </Button>
    </div>
  );
}
