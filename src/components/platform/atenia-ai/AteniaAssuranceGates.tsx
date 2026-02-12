/**
 * AteniaAssuranceGates — Shows the 6 assurance invariants with live status.
 *
 * Gates:
 *   A) DAILY_ENQUEUE proof exists for today
 *   B) WATCHDOG alive within 15 min
 *   C) Sync coverage >= 80%
 *   D) Queue bounded (pending <= 500)
 *   E) No OMITIDO backlog
 *   F) HEARTBEAT alive within 35 min
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface Gate {
  ok: boolean;
  [key: string]: unknown;
}

interface AssuranceResult {
  computed_at: string;
  all_ok: boolean;
  gates: {
    A_daily_enqueue: Gate;
    B_watchdog_liveness: Gate;
    C_coverage: Gate;
    D_queue_bounded: Gate;
    E_omitido_backlog: Gate;
    F_heartbeat_liveness: Gate;
  };
}

const GATE_META: Record<string, { label: string; description: string }> = {
  A_daily_enqueue: {
    label: "Enqueue Diario",
    description: "DAILY_ENQUEUE completado para hoy (día Bogotá)",
  },
  B_watchdog_liveness: {
    label: "Watchdog Vivo",
    description: "Watchdog OK en últimos 15 min",
  },
  C_coverage: {
    label: "Cobertura Sync",
    description: "≥80% de items monitoreados con sync en 24h",
  },
  D_queue_bounded: {
    label: "Cola Acotada",
    description: "≤500 tareas pendientes en la cola",
  },
  E_omitido_backlog: {
    label: "Sin Omitidos",
    description: "No hay items con scraping_initiated estancado",
  },
  F_heartbeat_liveness: {
    label: "Heartbeat Vivo",
    description: "Heartbeat OK en últimos 35 min",
  },
};

export function AteniaAssuranceGates() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["atenia-assurance-gates"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("atenia_assurance_gates" as any);
      if (error) throw error;
      return data as AssuranceResult;
    },
    refetchInterval: 60_000,
  });

  const gates = data?.gates;
  const allOk = data?.all_ok;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {allOk ? (
              <ShieldCheck className="h-4 w-4 text-green-500" />
            ) : allOk === false ? (
              <ShieldAlert className="h-4 w-4 text-destructive" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            )}
            Assurance Gates
          </CardTitle>
          {data?.computed_at && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(data.computed_at), { addSuffix: true, locale: es })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-xs text-destructive">Error cargando gates: {(error as Error).message}</p>
        ) : gates ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(gates).map(([key, gate]) => {
              const meta = GATE_META[key];
              const gateTyped = gate as Gate;

              return (
                <div
                  key={key}
                  className={`flex items-start gap-2 p-3 rounded-lg border ${
                    gateTyped.ok ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/30" : "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30"
                  }`}
                >
                  {gateTyped.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{meta?.label ?? key}</p>
                    <p className="text-[10px] text-muted-foreground">{meta?.description}</p>
                    {/* Extra details per gate */}
                    {key === "C_coverage" && (gateTyped as any).coverage_pct !== undefined && (
                      <Badge variant={gateTyped.ok ? "default" : "destructive"} className="text-[10px] mt-1">
                        {(gateTyped as any).coverage_pct}% — {(gateTyped as any).missing} sin sync
                      </Badge>
                    )}
                    {key === "D_queue_bounded" && (gateTyped as any).pending !== undefined && (
                      <Badge variant={gateTyped.ok ? "outline" : "destructive"} className="text-[10px] mt-1">
                        {(gateTyped as any).pending} pendientes
                      </Badge>
                    )}
                    {key === "E_omitido_backlog" && !gateTyped.ok && (
                      <Badge variant="destructive" className="text-[10px] mt-1">
                        {(gateTyped as any).count} omitidos
                      </Badge>
                    )}
                    {(key === "B_watchdog_liveness" || key === "F_heartbeat_liveness") && (gateTyped as any).gap_minutes != null && (
                      <Badge variant={gateTyped.ok ? "outline" : "destructive"} className="text-[10px] mt-1">
                        hace {(gateTyped as any).gap_minutes} min
                      </Badge>
                    )}
                    {key === "A_daily_enqueue" && (
                      <Badge variant={gateTyped.ok ? "default" : "secondary"} className="text-[10px] mt-1">
                        {(gateTyped as any).status}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sin datos</p>
        )}

        {allOk === true && (
          <div className="flex items-center gap-2 text-xs text-green-600 mt-3">
            <CheckCircle2 className="h-4 w-4" />
            Todas las 6 invariantes verificadas. Sistema operando correctamente.
          </div>
        )}
        {allOk === false && (
          <div className="flex items-center gap-2 text-xs text-destructive mt-3">
            <ShieldAlert className="h-4 w-4" />
            Una o más invariantes fallaron. Revise los gates rojos arriba.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
