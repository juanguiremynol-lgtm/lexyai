/**
 * useDemoLookup — Reusable hook for demo radicado lookup logic.
 * Extracts state machine for reuse in widgets.
 * Includes analytics instrumentation (no PII).
 */

import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics/wrapper";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import type { DemoResult, DemoError } from "@/components/demo/demo-types";

export type DemoState = "IDLE" | "LOADING" | "RESULT" | "ERROR";

interface UseDemoLookupOptions {
  initialRadicado?: string;
  onComplete?: (result: DemoResult) => void;
}

function toLatencyBucket(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 3000) return "1-3s";
  if (ms < 5000) return "3-5s";
  if (ms < 10000) return "5-10s";
  return ">10s";
}

export function useDemoLookup(options: UseDemoLookupOptions = {}) {
  const [state, setState] = useState<DemoState>("IDLE");
  const [radicado, setRadicado] = useState(options.initialRadicado ?? "");
  const [inputError, setInputError] = useState<string | null>(null);
  const [demoData, setDemoData] = useState<DemoResult | null>(null);
  const [error, setError] = useState<DemoError | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalizedDigits = radicado.replace(/\D/g, "");
  const isValid = normalizedDigits.length === 23;
  const isLoading = state === "LOADING";

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

      // Analytics: lookup submitted (no PII — only length)
      track(ANALYTICS_EVENTS.DEMO_LOOKUP_SUBMITTED, {
        radicado_length: digits.length,
        category: "AUTO",
      });

      setState("LOADING");
      setError(null);
      setInputError(null);
      const startTime = Date.now();

      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          "demo-radicado-lookup",
          { body: { radicado: digits } }
        );

        const latencyMs = Date.now() - startTime;

        if (fnError) throw new Error(fnError.message || "Error de conexión");

        if (data?.error) {
          const errorType = data.error;
          if (errorType === "RATE_LIMITED") {
            setError({ type: "RATE_LIMITED", message: data.message, retryAfter: data.retry_after_seconds });
          } else if (errorType === "NOT_FOUND") {
            setError({ type: "NOT_FOUND", message: data.message || "No se encontraron datos para este radicado." });
          } else {
            setError({ type: errorType, message: data.message || "Error desconocido" });
          }
          track(ANALYTICS_EVENTS.DEMO_LOOKUP_RESULT, {
            outcome: errorType === "NOT_FOUND" ? "NOT_FOUND" : "ERROR",
            providers_with_data: 0,
            latency_bucket: toLatencyBucket(latencyMs),
          });
          setState("ERROR");
          return;
        }

        // Analytics: success
        const providersWithData = data.meta?.providers_with_data || data.meta?.sources?.length || 0;
        const outcome = providersWithData > 0
          ? (data.meta?.providers_checked === providersWithData ? "FOUND_COMPLETE" : "FOUND_PARTIAL")
          : "NOT_FOUND";
        track(ANALYTICS_EVENTS.DEMO_LOOKUP_RESULT, {
          outcome,
          providers_with_data: providersWithData,
          latency_bucket: toLatencyBucket(latencyMs),
        });

        setDemoData(data);
        setModalOpen(true);
        setState("RESULT");
        options.onComplete?.(data);
      } catch (err) {
        track(ANALYTICS_EVENTS.DEMO_LOOKUP_RESULT, {
          outcome: "ERROR",
          providers_with_data: 0,
          latency_bucket: toLatencyBucket(Date.now() - startTime),
        });
        setError({
          type: "NETWORK",
          message: "No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.",
        });
        setState("ERROR");
      }
    },
    [normalizedDigits, options.onComplete]
  );

  const handleReset = useCallback(() => {
    setState("IDLE");
    setError(null);
    setInputError(null);
  }, []);

  const handleTryExample = useCallback(() => {
    const example = "05001233300020240115300";
    setRadicado(example);
    handleLookup(example);
  }, [handleLookup]);

  const handleInputChange = useCallback((value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 23);
    setRadicado(digits);
    setInputError(null);
    if (state === "ERROR") {
      setState("IDLE");
      setError(null);
      setInputError(null);
    }
  }, [state]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading) handleLookup();
  }, [handleLookup, isLoading]);

  return {
    state,
    radicado,
    normalizedDigits,
    isValid,
    isLoading,
    inputError,
    demoData,
    error,
    modalOpen,
    inputRef,
    setModalOpen,
    setRadicado,
    handleLookup,
    handleReset,
    handleTryExample,
    handleInputChange,
    handleKeyDown,
  };
}
