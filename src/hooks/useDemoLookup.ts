/**
 * useDemoLookup — Reusable hook for demo radicado lookup logic.
 * Extracts state machine from DemoRadicadoSection for reuse in widgets.
 */

import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DemoResult, DemoError } from "@/components/demo/demo-types";

export type DemoState = "IDLE" | "LOADING" | "RESULT" | "ERROR";

interface UseDemoLookupOptions {
  initialRadicado?: string;
  onComplete?: (result: DemoResult) => void;
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
            setError({ type: "RATE_LIMITED", message: data.message, retryAfter: data.retry_after_seconds });
          } else if (data.error === "NOT_FOUND") {
            setError({ type: "NOT_FOUND", message: data.message || "No se encontraron datos para este radicado." });
          } else {
            setError({ type: data.error, message: data.message || "Error desconocido" });
          }
          setState("ERROR");
          return;
        }

        setDemoData(data);
        setModalOpen(true);
        setState("RESULT");
        options.onComplete?.(data);
      } catch (err) {
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
