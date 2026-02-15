/**
 * DemoPartnerSnippet — Copyable partner link snippet for embedding.
 * Shows a pre-built URL that partners can share or embed as a link card.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toPublicUrl } from "@/lib/urls";

interface DemoPartnerSnippetProps {
  variant?: "compact" | "full";
  frame?: "androMouth" | "none";
  className?: string;
}

export function DemoPartnerSnippet({
  variant = "compact",
  frame = "androMouth",
  className = "",
}: DemoPartnerSnippetProps) {
  const [copied, setCopied] = useState(false);

  const url = toPublicUrl("/demo", { variant, frame });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <p className="text-sm font-medium text-foreground">Enlace compartible para demo</p>
      <div className="flex gap-2">
        <Input
          value={url}
          readOnly
          className="text-xs font-mono bg-muted"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <Button size="sm" variant="outline" onClick={handleCopy} className="shrink-0">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Comparte este enlace en redes sociales, WhatsApp, o email. Los usuarios verán la demo directamente.
      </p>

      {/* HTML snippet for partner websites */}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Código HTML para sitios web de socios
        </summary>
        <pre className="mt-2 p-3 rounded-md bg-muted text-muted-foreground overflow-x-auto">
{`<a href="${url}" 
   target="_blank" 
   rel="noopener noreferrer"
   style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;
          background:#0ea5e9;color:white;border-radius:8px;
          font-family:system-ui;font-size:14px;text-decoration:none;">
  Prueba Andro IA con tu radicado
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M7 17L17 7M17 7H7M17 7V17"/>
  </svg>
</a>`}
        </pre>
      </details>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        Abrir demo en nueva pestaña
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
