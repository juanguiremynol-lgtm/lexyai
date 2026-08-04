/**
 * BridgeIntegrityPanel — iteration 20.
 *
 * Shows what the provider says exists versus what actually landed. A gap here
 * is a transfer defect, never "no news", so the panel reports the age of every
 * open gap and the per-source health signals emitted upstream.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, PlugZap, RefreshCw, ScanEye } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

interface GapRow {
  work_item_id: string;
  radicado: string;
  provider_key: string;
  row_kind: string;
  provider_count: number;
  local_count: number;
  missing_count: number;
  transfer_state: string;
  hours_open: number;
  last_error: string | null;
}

interface HealthRow {
  radicado: string;
  provider_key: string;
  terminal_state: string | null;
  coverage_suspect: boolean;
  coverage_suspect_note: string | null;
  parse_mismatch_count: number;
  consecutive_empty_runs: number;
  last_row_emitted_at: string | null;
}

const STATE_LABEL: Record<string, string> = {
  GAP: "Filas no transferidas",
  TRANSFER_FAILED: "Reintento fallido",
  PROVIDER_UNAVAILABLE: "Proveedor sin respuesta",
  PROVIDER_INVENTORY_SUSPECT: "Inventario sospechoso (0 en fuente con filas locales)",
  INFRA_FAILURE: "Falla de nuestra infraestructura",
  PROVIDER_JOB_ABORTED: "Trabajo del proveedor abortado",
  PROVIDER_NEVER_COMPLETES: "El proveedor nunca completa",
  PROVIDER_NO_ROWS: "Fuente vacía (confirmada)",
};

const TERMINAL_LABEL: Record<string, string> = {
  PROVIDER_JOB_FAILED: "Trabajo del proveedor falló",
  PROVIDER_NEVER_COMPLETES: "El proveedor nunca completa",
  PROVIDER_UNKNOWN_PROCESS: "Proceso no reconocido por el proveedor",
  PROVIDER_JOB_ABORTED: "Trabajo abortado (limitador, cancelación u OOM)",
  INFRA_FAILURE: "Falla de infraestructura (nuestra)",
};

/**
 * ITERATION 23 item 5 — infrastructure metrics reported by the provider
 * services. These are OUR operational signals: they never describe a matter.
 */
interface ProviderInfra {
  provider: string;
  ok: boolean;
  service_status?: string;
  degraded?: boolean;
  latencyMs?: number;
  metrics?: Record<string, unknown>;
}

const METRIC_LABEL: Record<string, string> = {
  rate_limiter: "Limitador",
  job_store: "Cola de trabajos",
  ocr_cache: "Caché OCR",
  temp_pdfs: "PDF temporales",
  retencion_jobs: "Retención de trabajos",
};

function summarizeMetric(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" · ");
  }
  return String(value);
}

export function BridgeIntegrityPanel() {
  const [running, setRunning] = useState(false);

  const gaps = useQuery({
    queryKey: ["bridge-gap-summary"],
    queryFn: async (): Promise<GapRow[]> => {
      const { data, error } = await (supabase as any).rpc("bridge_gap_summary", { _min_hours: 24 });
      if (error) throw error;
      return (data ?? []) as GapRow[];
    },
  });

  const health = useQuery({
    queryKey: ["provider-source-health"],
    queryFn: async (): Promise<HealthRow[]> => {
      const { data, error } = await (supabase as any)
        .from("provider_source_health")
        .select("radicado, provider_key, terminal_state, coverage_suspect, coverage_suspect_note, parse_mismatch_count, consecutive_empty_runs, last_row_emitted_at")
        .or("coverage_suspect.eq.true,terminal_state.not.is.null,parse_mismatch_count.gt.0")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as HealthRow[];
    },
  });

  const infra = useQuery({
    queryKey: ["gcp-provider-infra"],
    staleTime: 60_000,
    queryFn: async (): Promise<ProviderInfra[]> => {
      const { data, error } = await supabase.functions.invoke("integration-health", {
        body: { provider_health: true },
      });
      if (error) throw error;
      const ph = ((data as any)?.provider_health ?? {}) as Record<string, any>;
      return Object.entries(ph).map(([provider, v]) => ({
        provider,
        ok: !!v?.connectivity?.ok,
        service_status: v?.connectivity?.service_status,
        degraded: !!v?.connectivity?.degraded,
        latencyMs: v?.connectivity?.latencyMs,
        metrics: v?.connectivity?.metrics ?? {},
      }));
    },
  });

  async function runReconcile() {
    setRunning(true);
    const { error } = await supabase.functions.invoke("bridge-reconcile", { body: { limit: 25 } });
    setRunning(false);
    if (error) {
      toast.error("No fue posible ejecutar la reconciliación");
      return;
    }
    toast.success("Reconciliación ejecutada");
    gaps.refetch();
    health.refetch();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <PlugZap className="h-4 w-4" />
              Integridad del puente proveedor → Andromeda
            </CardTitle>
            <CardDescription>
              El inventario del proveedor es la referencia. Una fila que el proveedor tiene y
              nosotros no es un defecto de transferencia, nunca "sin novedades".
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={runReconcile} disabled={running}>
            <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
            Reconciliar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-2">
          <h4 className="text-sm font-medium">Brechas abiertas hace más de 24 horas</h4>
          {gaps.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (gaps.data ?? []).length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Sin brechas persistentes.
            </p>
          ) : (
            <div className="space-y-2">
              {(gaps.data ?? []).map((g) => (
                <div key={`${g.work_item_id}-${g.provider_key}-${g.row_kind}`} className="rounded-md border p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{g.radicado}</span>
                    <Badge variant="outline" className="gap-1 border-amber-500/50 text-[10px] text-amber-600">
                      <AlertTriangle className="h-3 w-3" />
                      {STATE_LABEL[g.transfer_state] ?? g.transfer_state}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {g.provider_key} · {g.row_kind === "PUB" ? "estados" : "actuaciones"} — proveedor {g.provider_count},
                    local {g.local_count}, faltan {g.missing_count} · abierta hace {g.hours_open} h
                  </p>
                  {g.last_error && <p className="text-[10px] text-muted-foreground">{g.last_error}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <ScanEye className="h-4 w-4" /> Salud por fuente
          </h4>
        </section>

        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <PlugZap className="h-4 w-4" /> Infraestructura de los servicios de proveedor
          </h4>
          <p className="text-[10px] text-muted-foreground">
            Señales operativas nuestras. Nunca se presentan como un hecho del expediente.
          </p>
          {infra.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (infra.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin métricas disponibles.</p>
          ) : (
            <div className="space-y-2">
              {(infra.data ?? []).map((s) => (
                <div key={s.provider} className="rounded-md border p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase">{s.provider}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        s.degraded
                          ? "border-amber-500/50 text-amber-600"
                          : s.ok
                            ? "border-emerald-500/50 text-emerald-600"
                            : "border-destructive/50 text-destructive"
                      }`}
                    >
                      {s.degraded ? "Degradado" : s.ok ? "Operativo" : "Sin conexión"}
                      {s.service_status ? ` · ${s.service_status}` : ""}
                      {typeof s.latencyMs === "number" ? ` · ${s.latencyMs} ms` : ""}
                    </Badge>
                  </div>
                  <div className="space-y-0.5">
                    {Object.entries(METRIC_LABEL).map(([key, label]) => (
                      <p key={key} className="text-[10px] text-muted-foreground">
                        <span className="font-medium">{label}:</span>{" "}
                        {summarizeMetric((s.metrics ?? {})[key])}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <ScanEye className="h-4 w-4" /> Detalle por fuente
          </h4>
          {health.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (health.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin señales adversas por fuente.</p>
          ) : (
            <div className="space-y-2">
              {(health.data ?? []).map((h) => (
                <div key={`${h.radicado}-${h.provider_key}`} className="rounded-md border p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{h.radicado}</span>
                    <span className="text-[10px] uppercase text-muted-foreground">{h.provider_key}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {h.terminal_state && (
                      <Badge variant="outline" className="border-destructive/50 text-[10px] text-destructive">
                        {TERMINAL_LABEL[h.terminal_state] ?? h.terminal_state}
                      </Badge>
                    )}
                    {h.coverage_suspect && (
                      <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-600">
                        Cobertura sospechosa
                      </Badge>
                    )}
                    {h.parse_mismatch_count > 0 && (
                      <Badge variant="outline" className="border-sky-500/50 text-[10px] text-sky-600">
                        {h.parse_mismatch_count} estado(s) ilegibles
                      </Badge>
                    )}
                    {h.consecutive_empty_runs > 0 && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {h.consecutive_empty_runs} corridas vacías seguidas
                      </Badge>
                    )}
                  </div>
                  {h.coverage_suspect_note && (
                    <p className="text-[10px] text-muted-foreground">{h.coverage_suspect_note}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
