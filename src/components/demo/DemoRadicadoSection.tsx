/**
 * DemoRadicadoSection — "Prueba ATENIA" on landing page
 * 
 * Input for radicado + triggers demo lookup + opens full-screen modal with results.
 * All state is ephemeral (React only). No DB writes, no localStorage.
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DemoResultModal } from "./DemoResultModal";

interface DemoData {
  resumen: {
    radicado_display: string;
    despacho: string | null;
    ciudad: string | null;
    departamento: string | null;
    jurisdiccion: string | null;
    tipo_proceso: string | null;
    fecha_radicacion: string | null;
    ultima_actuacion_fecha: string | null;
    ultima_actuacion_tipo: string | null;
    total_actuaciones: number;
    total_estados: number;
  };
  actuaciones: Array<{
    fecha: string;
    tipo: string | null;
    descripcion: string;
    anotacion: string | null;
  }>;
  estados: Array<{
    tipo: string;
    fecha: string;
    descripcion: string | null;
  }>;
  meta: {
    radicado_masked: string;
    actuaciones_count: number;
    estados_count: number;
    fetched_at: string;
    demo: boolean;
  };
}

export function DemoRadicadoSection() {
  const [radicado, setRadicado] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoData, setDemoData] = useState<DemoData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const normalizedDigits = radicado.replace(/\D/g, "");
  const isValid = normalizedDigits.length === 23;

  const handleLookup = useCallback(async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "demo-radicado-lookup",
        { body: { radicado: normalizedDigits } }
      );

      if (fnError) {
        throw new Error(fnError.message || "Error de conexión");
      }

      if (data?.error) {
        if (data.error === "RATE_LIMITED") {
          setError("Has alcanzado el límite de consultas. Intenta de nuevo en unos minutos.");
        } else if (data.error === "NOT_FOUND") {
          setError("No se encontraron datos para este radicado. Verifica que sea correcto.");
        } else {
          setError(data.message || "Error desconocido");
        }
        return;
      }

      setDemoData(data);
      setModalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setLoading(false);
    }
  }, [normalizedDigits, isValid]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && isValid && !loading) handleLookup();
  };

  return (
    <>
      <section
        id="demo"
        className="py-20 md:py-28 bg-gradient-to-b from-muted/30 via-muted/50 to-muted/30"
      >
        <div className="container max-w-4xl mx-auto px-4">
          <div className="text-center space-y-4 mb-10">
            <Badge variant="outline" className="text-sm px-4 py-1.5">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Prueba en vivo
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Prueba ATENIA con tu{" "}
              <span className="text-primary">radicado real</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Ingresa un radicado de 23 dígitos y visualiza cómo ATENIA 
              organiza y presenta la información de tu proceso judicial.
            </p>
          </div>

          <div className="max-w-xl mx-auto space-y-4">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Input
                  value={radicado}
                  onChange={(e) => {
                    setRadicado(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Ej: 05001400300220250105400"
                  className="h-12 text-base font-mono pr-20"
                  maxLength={30}
                  disabled={loading}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums">
                  {normalizedDigits.length}/23
                </span>
              </div>
              <Button
                size="lg"
                className="h-12 px-6"
                onClick={handleLookup}
                disabled={!isValid || loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                <span className="ml-2 hidden sm:inline">
                  {loading ? "Consultando..." : "Buscar"}
                </span>
              </Button>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <p className="text-xs text-muted-foreground text-center">
              Los datos se consultan en tiempo real desde fuentes judiciales públicas.
              No se almacena ninguna información. La información personal es redactada automáticamente.
            </p>
          </div>
        </div>
      </section>

      <DemoResultModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        data={demoData}
      />
    </>
  );
}
