/**
 * DemoLookupWidget — Reusable, embeddable demo lookup component.
 *
 * Supports two variants (full / compact) and optional Andro mouth frame.
 * All demo logic is in useDemoLookup hook.
 */

import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Sparkles, ShieldCheck, Eye, Zap, ArrowRight, Activity, LayoutGrid, Building2 } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDemoLookup } from "@/hooks/useDemoLookup";
import { DemoResultModal } from "./DemoResultModal";
import { AndroMouthFrame } from "./AndroMouthFrame";
import { track } from "@/lib/analytics/wrapper";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { trackDemoView, trackDemoCtaClicked } from "@/lib/demo-telemetry";
import { DemoShareButton } from "./DemoShareButton";
import type { DemoResult } from "./demo-types";

export interface DemoLookupWidgetProps {
  /** "full" = lookup + full result modal; "compact" = lookup + short summary */
  variant?: "full" | "compact";
  /** Whether to wrap in the Andro mouth PNG frame */
  frame?: "androMouth" | "none";
  /** Pre-fill radicado input */
  initialRadicado?: string;
  /** Auto-run lookup if initialRadicado is valid */
  autoRun?: boolean;
  /** Callback when lookup completes */
  onComplete?: (result: DemoResult) => void;
  /** CTA mode at the bottom */
  ctaMode?: "signup" | "requestDemo" | "none";
  /** Additional class names */
  className?: string;
}

export function DemoLookupWidget({
  variant = "full",
  frame = "none",
  initialRadicado,
  autoRun = false,
  onComplete,
  ctaMode = "none",
  className = "",
}: DemoLookupWidgetProps) {
  const demo = useDemoLookup({ initialRadicado, onComplete });

  // Track demo view + auto-run on mount
  useEffect(() => {
    trackDemoView({
      variant,
      frame,
      has_radicado: !!(initialRadicado && initialRadicado.replace(/\D/g, "").length === 23),
    });
    if (autoRun && initialRadicado && initialRadicado.replace(/\D/g, "").length === 23) {
      demo.handleLookup(initialRadicado);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCtaClick = (ctaType: string) => {
    track(ANALYTICS_EVENTS.DEMO_CTA_CLICKED, { cta_type: ctaType });
    trackDemoCtaClicked(ctaType);
  };

  const content = (
    <TooltipProvider>
    <div className={className}>
      {/* Header */}
      <div className="text-center space-y-2 mb-4 relative">
        {/* Share button — top-right */}
        <div className="absolute right-0 top-0">
          <DemoShareButton
            variant={variant}
            frame={frame}
            radicado={demo.radicado}
            hasResults={demo.state === "RESULT"}
            iconOnly={variant === "compact"}
          />
        </div>
        <Badge variant="outline" className="text-xs px-3 py-1">
          <Sparkles className="h-3 w-3 mr-1" />
          Prueba en vivo
        </Badge>
        <h2 className="text-xl md:text-2xl font-bold tracking-tight">
          Prueba Andro IA con tu{" "}
          <span className="text-primary">radicado real</span>
        </h2>
        <p className="text-black text-sm max-w-lg mx-auto">
          Ingresa un número de radicado y mira en segundos cómo Andro IA
          organiza las actuaciones, estados, y gestiona tu caso.
        </p>
      </div>

      {/* Input area */}
      <div className="max-w-md mx-auto space-y-3">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Input
              ref={demo.inputRef}
              value={demo.radicado}
              onChange={(e) => demo.handleInputChange(e.target.value)}
              onKeyDown={demo.handleKeyDown}
              placeholder="Ej: 05001400300220250105400"
              className="h-10 text-sm font-mono pr-16"
              maxLength={30}
              disabled={demo.isLoading}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums">
              {demo.normalizedDigits.length}/23
            </span>
          </div>
          <Button
            size="sm"
            className="h-10 px-4"
            onClick={() => demo.handleLookup()}
            disabled={demo.isLoading}
          >
            {demo.isLoading ? (
              <svg viewBox="0 0 48 48" className="h-5 w-5 animate-spin" aria-hidden="true">
                <circle cx="24" cy="3" r="2" fill="currentColor" />
                <line x1="24" y1="4" x2="24" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <rect x="8" y="10" width="32" height="28" rx="8" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2" />
                <circle cx="17" cy="24" r="4" fill="currentColor" />
                <circle cx="31" cy="24" r="4" fill="currentColor" />
                <ellipse cx="24" cy="33" rx="4" ry="2" fill="currentColor" opacity="0.6" />
              </svg>
            ) : (
              <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
                <circle cx="24" cy="3" r="2" fill="currentColor" />
                <line x1="24" y1="4" x2="24" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <rect x="8" y="10" width="32" height="28" rx="8" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2" />
                <circle cx="17" cy="24" r="3" fill="currentColor" />
                <circle cx="31" cy="24" r="3" fill="currentColor" />
                <line x1="18" y1="33" x2="30" y2="33" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
            <span className="ml-2 hidden sm:inline">
              {demo.isLoading ? "Buscando..." : "Buscar con Andro IA"}
            </span>
          </Button>
        </div>

        {/* Loading state */}
        {demo.isLoading && (
          <div className="flex items-center justify-center gap-3 py-4">
            <svg viewBox="0 0 48 48" className="h-6 w-6 animate-spin text-primary" aria-hidden="true">
              <circle cx="24" cy="3" r="2" fill="currentColor" />
              <line x1="24" y1="4" x2="24" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <rect x="8" y="10" width="32" height="28" rx="8" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="2" />
              <circle cx="17" cy="24" r="4" fill="currentColor" />
              <circle cx="31" cy="24" r="4" fill="currentColor" />
              <ellipse cx="24" cy="33" rx="4" ry="2" fill="currentColor" opacity="0.6" />
            </svg>
            <div className="text-center">
              <p className="text-sm font-medium">Espera, Andro IA está buscando tu proceso...</p>
              <p className="text-xs text-muted-foreground">
                CPNU · SAMAI · Publicaciones · Tutelas · SAMAI Estados
              </p>
            </div>
          </div>
        )}

        {/* Input validation error */}
        {demo.inputError && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{demo.inputError}</span>
          </div>
        )}

        {/* API error */}
        {demo.state === "ERROR" && demo.error && (
          <div className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{demo.error.message}</span>
            </div>
            {demo.error.type === "NOT_FOUND" && (
              <p className="text-xs text-muted-foreground">
                Verifica que el radicado tenga 23 dígitos y corresponda a un proceso activo
                en la Rama Judicial colombiana.
              </p>
            )}
            {demo.error.type === "RATE_LIMITED" && demo.error.retryAfter && (
              <p className="text-xs text-muted-foreground">
                Puedes intentar de nuevo en {Math.ceil(demo.error.retryAfter / 60)} minuto(s).
              </p>
            )}
            <button onClick={demo.handleReset} className="text-sm text-primary hover:underline">
              ← Intentar de nuevo
            </button>
          </div>
        )}

        {/* Compact: show summary after result */}
        {variant === "compact" && demo.state === "RESULT" && demo.demoData && (
          <CompactResultSummary data={demo.demoData} radicado={demo.normalizedDigits} />
        )}

        {/* Try example link */}
        {!demo.isLoading && (
          <div className="text-center">
            <button
              onClick={demo.handleTryExample}
              className="text-sm text-primary hover:underline"
              disabled={demo.isLoading}
            >
              Probar con un radicado de ejemplo →
            </button>
          </div>
        )}

        {/* Trust badges */}
        <div className="flex flex-wrap justify-center gap-3 pt-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Datos no almacenados
          </span>
          <span className="flex items-center gap-1.5">
            <Eye className="h-3.5 w-3.5" />
            Información personal redactada
          </span>
          <span className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            Consulta en tiempo real
          </span>
        </div>

        {/* CTA */}
        {ctaMode === "signup" && (
          <div className="text-center pt-3">
            <Button asChild size="sm" onClick={() => handleCtaClick("signup")}>
              <Link to="/auth?signup=true">
                Crear cuenta gratis
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
        {ctaMode === "requestDemo" && (
          <div className="text-center pt-3">
            <Button asChild size="sm" variant="outline" onClick={() => handleCtaClick("request_demo")}>
              <Link to="/auth?signup=true">
                Solicitar demo personalizada
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Full variant: result modal */}
      {variant === "full" && (
        <DemoResultModal
          open={demo.modalOpen}
          onOpenChange={demo.setModalOpen}
          data={demo.demoData}
        />
      )}
    </div>
    </TooltipProvider>
  );

  if (frame === "androMouth") {
    return <AndroMouthFrame>{content}</AndroMouthFrame>;
  }

  return content;
}

/** Compact result summary shown inline after lookup — preserves query params */
function CompactResultSummary({ data, radicado }: { data: DemoResult; radicado: string }) {
  const { resumen } = data;
  // Preserve current frame param when navigating to full view
  let [searchParams] = useSearchParams();
  const frame = searchParams.get("frame") || "androMouth";

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      {resumen.despacho && (
        <p className="text-sm flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          {resumen.despacho}
        </p>
      )}
      {(resumen.demandante || resumen.demandado) && (
        <p className="text-xs text-muted-foreground">
          {[resumen.demandante, resumen.demandado].filter(Boolean).join(" vs ")}
        </p>
      )}
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Activity className="h-3 w-3" />
          {resumen.total_actuaciones} actuaciones
        </span>
        {resumen.total_estados > 0 && (
          <span className="flex items-center gap-1">
            <LayoutGrid className="h-3 w-3" />
            {resumen.total_estados} estados
          </span>
        )}
      </div>
      <Button asChild size="sm" variant="outline" className="w-full text-xs">
        <Link to={`/demo?radicado=${radicado}&variant=full&frame=${frame}&autorun=1`}>
          Ver timeline completo →
        </Link>
      </Button>
    </div>
  );
}
