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
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 rounded-md bg-card px-2 py-1.5 font-mono text-xs break-all">{value}</code>
      <Button variant="outline" size="icon-sm" onClick={copy} aria-label={copied ? `${label} copied` : `Copy ${label}`}>
        {copied ? <Check className="text-water" /> : <Copy />}
      </Button>
    </div>
  );
}
