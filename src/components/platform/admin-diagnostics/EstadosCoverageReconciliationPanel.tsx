/**
 * Iteration 34, item 6 — reconcile our own per-despacho orphan count against
 * the provider census published under source='PP_COVERAGE'. The two detectors
 * must agree; a divergence is itself the finding and is shown as such.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface ReconciliationRow {
  despacho: string | null;
  etiqueta: string | null;
  andromeda: number;
  proveedor: number | null;
  coincide: boolean;
}

interface Reconciliation {
  provider_census_rows: number;
  provider_census_fetched_at: string | null;
  filas: ReconciliationRow[];
}

export function EstadosCoverageReconciliationPanel() {
  const [ingesting, setIngesting] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["estados-coverage-reconciliation"],
    queryFn: async () => {
      const [rec, sum] = await Promise.all([
        supabase.rpc("estados_coverage_reconciliation" as never),
        supabase.rpc("estados_coverage_summary" as never),
      ]);
      return {
        reconciliation: (rec.data ?? null) as unknown as Reconciliation | null,
        summary: (sum.data ?? null) as unknown as Record<string, number | string | null> | null,
      };
    },
  });

  const ingest = async () => {
    setIngesting(true);
    const { data: res, error } = await supabase.functions.invoke("ingest-pp-coverage-census");
    setIngesting(false);
    if (error) {
      toast.error("No se pudo consultar el censo del proveedor");
      return;
    }
    if ((res as any)?.ok) {
      toast.success(`Censo ingerido: ${(res as any).ingested} despacho(s)`);
    } else {
      toast.warning(
        `El proveedor no entregó el censo (${(res as any)?.status ?? "sin estado"}). ` +
          "La reconciliación se muestra solo con nuestros datos.",
      );
    }
    refetch();
  };

  const filas = data?.reconciliation?.filas ?? [];
  const divergentes = filas.filter((f) => !f.coincide);
  const censusRows = data?.reconciliation?.provider_census_rows ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Cobertura de estados · reconciliación con el proveedor</CardTitle>
        <Button variant="outline" size="sm" onClick={ingest} disabled={ingesting} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${ingesting ? "animate-spin" : ""}`} />
          Traer censo PP_COVERAGE
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.summary && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">Cubiertos: {String(data.summary.cubierto ?? 0)}</Badge>
            <Badge variant="outline" className="border-amber-500/60 text-amber-600">
              Estados ausentes: {String(data.summary.estados_esperados_ausentes ?? 0)} (accionables{" "}
              {String(data.summary.estados_ausentes_accionables ?? 0)})
            </Badge>
            <Badge variant="outline" className="border-sky-500/50 text-sky-600">
              Fuera de ventana: {String(data.summary.sin_cobertura_en_esa_fecha ?? 0)}
            </Badge>
            <Badge variant="outline" className="border-indigo-500/50 text-indigo-600">
              Estado sin documento: {String(data.summary.estado_sin_documento ?? 0)}
            </Badge>
            <Badge variant="outline">Huérfanos totales: {String(data.summary.huerfanos_totales ?? 0)}</Badge>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Cargando reconciliación…</p>
        ) : censusRows === 0 ? (
          <p className="text-xs text-muted-foreground">
            El proveedor aún no publica el censo por despacho (source=PP_COVERAGE). Se muestran solo
            nuestros conteos; la comparación queda pendiente de su publicación.
          </p>
        ) : (
          <div className="flex items-center gap-2 text-xs">
            {divergentes.length === 0 ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>Ambos detectores coinciden en {filas.length} despacho(s).</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span>
                  {divergentes.length} despacho(s) con conteos divergentes — la divergencia es en sí
                  misma el hallazgo.
                </span>
              </>
            )}
          </div>
        )}

        {filas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1 text-left font-medium">Despacho</th>
                  <th className="py-1 text-right font-medium">Andromeda</th>
                  <th className="py-1 text-right font-medium">Proveedor</th>
                  <th className="py-1 text-right font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 25).map((f) => (
                  <tr key={f.despacho ?? Math.random()} className="border-b last:border-0">
                    <td className="py-1">{f.etiqueta || f.despacho || "sin identificar"}</td>
                    <td className="py-1 text-right tabular-nums">{f.andromeda}</td>
                    <td className="py-1 text-right tabular-nums">
                      {f.proveedor == null ? "—" : f.proveedor}
                    </td>
                    <td className="py-1 text-right">
                      {f.proveedor == null ? (
                        <span className="text-muted-foreground">sin censo</span>
                      ) : f.coincide ? (
                        <span className="text-emerald-600">coincide</span>
                      ) : (
                        <span className="text-amber-600">diverge</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}