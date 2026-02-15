/**
 * DemoRadicadoSection — "Prueba ATENIA" on landing page
 *
 * Input for radicado + triggers demo lookup + opens full-screen modal.
 * All state is ephemeral (React only). No DB writes, no localStorage.
 */

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, AlertCircle, Sparkles, ShieldCheck, Eye, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DemoResultModal } from "./DemoResultModal";
import { AndroMouthFrame } from "./AndroMouthFrame";
import type { DemoResult, DemoError } from "./demo-types";

type DemoState = "IDLE" | "LOADING" | "RESULT" | "ERROR";

export function DemoRadicadoSection() {
  const [state, setState] = useState<DemoState>("IDLE");
  const [radicado, setRadicado] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [demoData, setDemoData] = useState<DemoResult | null>(null);
  const [error, setError] = useState<DemoError | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalizedDigits = radicado.replace(/\D/g, "");
  const isValid = normalizedDigits.length === 23;

  const handleLookup = useCallback(
    async (overrideRadicado?: string) => {
      const digits = (overrideRadicado ?? normalizedDigits).replace(/\D/g, "");
      if (digits.length !== 23) {
        setInputError(
          digits.length === 0
            ? "Ingresa el número de radicado."
            : `El radicado debe tener 23 dígitos. Tienes ${digits.length}.`
        );
        inputRef.current?.focus();
        return;
      }

      setState("LOADING");
      setError(null);
      setInputError(null);

      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          "demo-radicado-lookup",
          { body: { radicado: digits } }
        );

        if (fnError) throw new Error(fnError.message || "Error de conexión");

        if (data?.error) {
          if (data.error === "RATE_LIMITED") {
            setError({
              type: "RATE_LIMITED",
              message: data.message,
              retryAfter: data.retry_after_seconds,
            });
          } else if (data.error === "NOT_FOUND") {
            setError({
              type: "NOT_FOUND",
              message: data.message || "No se encontraron datos para este radicado.",
            });
          } else {
            setError({ type: data.error, message: data.message || "Error desconocido" });
          }
          setState("ERROR");
          return;
        }

        setDemoData(data);
        setModalOpen(true);
        setState("RESULT");
      } catch (err) {
        setError({
          type: "NETWORK",
          message: "No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.",
        });
        setState("ERROR");
      }
    },
    [normalizedDigits]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading) handleLookup();
  };

  const handleReset = () => {
    setState("IDLE");
    setError(null);
    setInputError(null);
  };

  const handleTryExample = () => {
    const example = "05001233300020240115300";
    setRadicado(example);
    handleLookup(example);
  };

  const isLoading = state === "LOADING";

  // Format digits for display readability
  const formatForDisplay = (digits: string): string => {
    const parts = [
      digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7),
      digits.slice(7, 9), digits.slice(9, 12), digits.slice(12, 16),
      digits.slice(16, 21), digits.slice(21, 23),
    ].filter((p) => p.length > 0);
    return parts.join(" ");
  };

  return (
    <>
      <section
        id="demo"
        className="py-20 md:py-28 bg-gradient-to-b from-muted/30 via-muted/50 to-muted/30"
      >
        <AndroMouthFrame>
          {/* Header */}
          <div className="text-center space-y-2 mb-4">
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
                  ref={inputRef}
                  value={radicado}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 23);
                    setRadicado(digits);
                    setInputError(null);
                    if (state === "ERROR") handleReset();
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Ej: 05001400300220250105400"
                  className="h-10 text-sm font-mono pr-16"
                  maxLength={30}
                  disabled={isLoading}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums">
                  {normalizedDigits.length}/23
                </span>
              </div>
              <Button
                size="sm"
                className="h-10 px-4"
                onClick={() => handleLookup()}
                disabled={isLoading}
              >
                {isLoading ? (
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
                  {isLoading ? "Buscando..." : "Buscar con Andro IA"}
                </span>
              </Button>
            </div>

            {/* Loading state */}
            {isLoading && (
              <div className="flex items-center justify-center gap-3 py-6">
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
            {inputError && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{inputError}</span>
              </div>
            )}

            {/* API error */}
            {state === "ERROR" && error && (
              <div className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error.message}</span>
                </div>
                {error.type === "NOT_FOUND" && (
                  <p className="text-xs text-muted-foreground">
                    Verifica que el radicado tenga 23 dígitos y corresponda a un proceso activo
                    en la Rama Judicial colombiana.
                  </p>
                )}
                {error.type === "RATE_LIMITED" && error.retryAfter && (
                  <p className="text-xs text-muted-foreground">
                    Puedes intentar de nuevo en {Math.ceil(error.retryAfter / 60)} minuto(s).
                  </p>
                )}
                <button
                  onClick={handleReset}
                  className="text-sm text-primary hover:underline"
                >
                  ← Intentar de nuevo
                </button>
              </div>
            )}

            {/* Try example link */}
            {state !== "LOADING" && (
              <div className="text-center">
                <button
                  onClick={handleTryExample}
                  className="text-sm text-primary hover:underline"
                  disabled={isLoading}
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
          </div>
        </AndroMouthFrame>
      </section>

      <DemoResultModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        data={demoData}
      />
    </>
  );
}
