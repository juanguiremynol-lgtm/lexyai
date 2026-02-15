/**
 * DemoShareButton — Share popover for the demo widget.
 * Generates a canonical /demo URL preserving widget state.
 */

import { useState } from "react";
import { Share2, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { track } from "@/lib/analytics/wrapper";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

interface DemoShareButtonProps {
  variant: "full" | "compact";
  frame: "androMouth" | "none";
  radicado: string;
  hasResults: boolean;
  /** Icon-only mode for compact layouts */
  iconOnly?: boolean;
}

/** Build a canonical /demo share URL with current widget state */
export function buildDemoShareUrl({
  baseUrl,
  variant,
  frame,
  radicado,
  autorun,
}: {
  baseUrl: string;
  variant: string;
  frame: string;
  radicado?: string;
  autorun: "0" | "1";
}): string {
  const url = new URL("/demo", baseUrl);
  url.searchParams.set("variant", variant);
  url.searchParams.set("frame", frame);
  if (radicado && radicado.length === 23) {
    url.searchParams.set("radicado", radicado);
    url.searchParams.set("autorun", autorun);
  } else {
    url.searchParams.set("autorun", "0");
  }
  return url.toString();
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export function DemoShareButton({
  variant,
  frame,
  radicado,
  hasResults,
  iconOnly = false,
}: DemoShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const hasNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  const normalizedRadicado = radicado.replace(/\D/g, "");
  const shareUrl = buildDemoShareUrl({
    baseUrl: window.location.origin,
    variant,
    frame,
    radicado: normalizedRadicado.length === 23 ? normalizedRadicado : undefined,
    autorun: hasResults && normalizedRadicado.length === 23 ? "1" : "0",
  });

  const trackShare = (method: "copy" | "native" | "open") => {
    track(ANALYTICS_EVENTS.DEMO_SHARE_CLICKED, {
      variant,
      frame,
      has_radicado: normalizedRadicado.length === 23,
      method,
    });
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setCopied(true);
      toast({ title: "Enlace copiado ✅", duration: 2000 });
      trackShare("copy");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title: "Prueba Andro IA — Demo en vivo",
        text: "Pega un radicado y mira actuaciones, estados y pipeline Kanban.",
        url: shareUrl,
      });
      trackShare("native");
    } catch {
      // User cancelled — no action needed
    }
  };

  const handleOpenTab = () => {
    window.open(shareUrl, "_blank", "noopener");
    trackShare("open");
  };

  const trigger = iconOnly ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Share2 className="h-4 w-4" />
            <span className="sr-only">Compartir</span>
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>Copiar enlace para compartir esta demo</TooltipContent>
    </Tooltip>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
            <Share2 className="h-3.5 w-3.5" />
            Compartir
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>Copiar enlace para compartir esta demo</TooltipContent>
    </Tooltip>
  );

  return (
    <Popover>
      {trigger}
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="text-sm font-medium">Compartir demo</p>
        <Input
          readOnly
          value={shareUrl}
          className="text-xs font-mono h-8"
          onFocus={(e) => e.target.select()}
        />
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-8 text-xs" onClick={handleCopy}>
            {copied ? (
              <Check className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <Copy className="h-3.5 w-3.5 mr-1.5" />
            )}
            {copied ? "Copiado" : "Copiar enlace"}
          </Button>
          {hasNativeShare && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={handleNativeShare}
            >
              <Share2 className="h-3.5 w-3.5 mr-1.5" />
              Compartir…
            </Button>
          )}
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 flex-shrink-0"
            onClick={handleOpenTab}
            title="Abrir en nueva pestaña"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
