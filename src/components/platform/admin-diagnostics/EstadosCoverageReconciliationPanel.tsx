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
  derivado?: string | null;
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

interface CoverageSummary extends Record<string, number | string | null> {
  scope_portfolio?: string;
  scope_provider_census?: string;
  provider_census_orphans?: number;
  censored_edge_orphans?: number;
  genuine_window_orphans?: number;
  remision_orphans?: number;
  unexplained_orphans?: number;
  alertable_unexplained_orphans?: number;
}

export function EstadosCoverageReconciliationPanel() {
  const [ingesting, setIngesting] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["estados-coverage-reconciliation"],
    queryFn: async () => {
      const [rec, sum, samai] = await Promise.all([
        supabase.rpc("estados_coverage_reconciliation" as never),
        supabase.rpc("estados_coverage_summary" as never),
        supabase.rpc("samai_zero_actuaciones_report" as never),
      ]);
      return {
        reconciliation: (rec.data ?? null) as unknown as Reconciliation | null,
        summary: (sum.data ?? null) as unknown as CoverageSummary | null,
        samai: (samai.data ?? null) as unknown as {
          cpaca_monitoreados?: number;
          ciegos?: number;
          detalle?: Array<{ radicado: string | null; despacho: string | null; corridas_30d: number }>;
        } | null,
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
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Portafolio · huérfanos: {String(data.summary.huerfanos_totales ?? 0)}</Badge>
              <Badge variant="outline">Censo despacho completo · huérfanos: {String(data.summary.provider_census_orphans ?? 0)}</Badge>
            </div>
            <p className="text-muted-foreground">
              Son alcances distintos: Andromeda cuenta únicamente radicados activos monitoreados; el censo cubre todo el despacho.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Bordes censurados: {String(data.summary.censored_edge_orphans ?? 0)}</Badge>
              <Badge variant="outline" className="border-sky-500/50 text-sky-600">Ventana genuina: {String(data.summary.genuine_window_orphans ?? 0)}</Badge>
              <Badge variant="outline" className="border-violet-500/50 text-violet-600">Remisiones: {String(data.summary.remision_orphans ?? 0)}</Badge>
              <Badge variant="outline" className="border-amber-500/60 text-amber-600">Sin explicar: {String(data.summary.unexplained_orphans ?? 0)} · alertables {String(data.summary.alertable_unexplained_orphans ?? 0)}</Badge>
            </div>
          </div>
        )}

        {data?.samai && (
          <p className="text-xs text-muted-foreground">
            CPACA monitoreados: {data.samai.cpaca_monitoreados ?? 0} · sin actuaciones ni estados (posible
            ceguera de la fuente): <span className={(data.samai.ciegos ?? 0) > 0 ? "text-amber-600" : ""}>
              {data.samai.ciegos ?? 0}
            </span>
          </p>
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
                  <th className="py-1 text-left font-medium">Derivado</th>
                  <th className="py-1 text-right font-medium">Portafolio</th>
                  <th className="py-1 text-right font-medium">Despacho completo</th>
                  <th className="py-1 text-right font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 25).map((f) => (
                  <tr key={f.despacho ?? Math.random()} className="border-b last:border-0">
                    <td className="py-1">{f.etiqueta || f.despacho || "sin identificar"}</td>
                    <td className="py-1 text-muted-foreground tabular-nums">
                      {f.derivado && f.derivado !== f.despacho ? `${f.derivado} → ${f.despacho}` : (f.despacho ?? "—")}
                    </td>
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