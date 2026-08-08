/**
 * DetalleExposicionPanel — ITERATION 44.
 *
 * Reserva sumarial is a lawful state, not an incident, so it gets its own
 * readout instead of polluting coverage alerts. What IS alertable here is a
 * reserva nobody has revalidated within its TTL: an unrefreshed reservation is
 * indistinguishable from a matter we simply stopped reading.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Lock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { claseMotivoLabel } from "@/lib/clase-motivo";

interface ReservaRow {
  work_item_id: string;
  radicado: string | null;
  workflow_type: string | null;
  motivo: string | null;
  desde: string | null;
  ultima_verificacion: string | null;
  ttl_dias: number | null;
  vencida: boolean;
}

interface ReservaReport {
  reservados: number;
  reservados_sin_revalidar: number;
  detalle: ReservaRow[];
}

const fmt = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function DetalleExposicionPanel() {
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["detalle-exposicion-report"],
    queryFn: async () => {
      const { data: rep } = await supabase.rpc("detalle_exposicion_report" as never);
      return (rep ?? null) as unknown as ReservaReport | null;
    },
  });

  const sync = async () => {
    setSyncing(true);
    const { data: res, error } = await supabase.functions.invoke("sync-detalle-exposicion");
    setSyncing(false);
    if (error) {
      toast.error("No se pudo consultar el estado de exposición en el proveedor");
      return;
    }
    const r = res as { evaluados?: number; cambios?: number; lecturas_fallidas?: number };
    toast.success(
      `Exposición revisada en ${r?.evaluados ?? 0} expediente(s) · ${r?.cambios ?? 0} cambio(s)` +
        (r?.lecturas_fallidas ? ` · ${r.lecturas_fallidas} lectura(s) fallida(s)` : ""),
    );
    refetch();
  };

  const rows = data?.detalle ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Lock className="h-4 w-4" />
          Exposición del detalle · estado y revalidación
        </CardTitle>
        <Button variant="outline" size="sm" onClick={sync} disabled={syncing} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          Revalidar con el proveedor
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">Detalle no expuesto: {data?.reservados ?? 0}</Badge>
          <Badge
            variant="outline"
            className={(data?.reservados_sin_revalidar ?? 0) > 0 ? "border-amber-500/60 text-amber-600" : ""}
          >
            Sin revalidar dentro del TTL: {data?.reservados_sin_revalidar ?? 0}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Un proceso en reserva no genera alertas de cobertura: el silencio del proveedor es legítimo.
          Lo que sí se vigila es la revalidación: una reserva sin verificar es indistinguible de un
          expediente que dejamos de leer.
        </p>

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Cargando estado de reservas…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Ningún expediente con el detalle no expuesto.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1 text-left font-medium">Radicado</th>
                  <th className="py-1 text-left font-medium">Área</th>
                  <th className="py-1 text-left font-medium">Motivo</th>
                  <th className="py-1 text-left font-medium">Desde</th>
                  <th className="py-1 text-left font-medium">Última verificación</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 25).map((r) => (
                  <tr key={r.work_item_id} className="border-b last:border-0">
                    <td className="py-1 font-mono">{r.radicado ?? "—"}</td>
                    <td className="py-1">{r.workflow_type ?? "—"}</td>
                    <td className="py-1">{claseMotivoLabel(r.motivo)}</td>
                    <td className="py-1">{fmt(r.desde)}</td>
                    <td className="py-1">
                      {r.vencida ? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3" />
                          {fmt(r.ultima_verificacion)} · vencida ({r.ttl_dias ?? 7} d)
                        </span>
                      ) : (
                        fmt(r.ultima_verificacion)
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
