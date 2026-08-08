/**
 * DetalleExposicionPanel — ITERATION 46.
 *
 * The provider names this condition itself: "--- [ PROCESO PRIVADO ] ---" in
 * search, and "No se puede ver el detalle de un proceso privado" on detail. We
 * adopt the provider's term and ATTRIBUTE it, instead of coining a vocabulary
 * ("reserva sumarial", then "detalle no expuesto") the user cannot match
 * against the portal.
 *
 * A private matter is not an incident and never raises a coverage alarm. What
 * IS watched is revalidation: the mark is mutable and per-matter, so an
 * unrefreshed reading is indistinguishable from a matter we stopped reading.
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
import {
  type DespachoPrivacyRate,
  privacyRateCopy,
  resolvePrivacyRate,
} from "@/lib/despacho-privacy-rate";

interface PrivadoRow {
  work_item_id: string;
  radicado: string | null;
  estado: string | null;
  motivo: string | null;
  desde: string | null;
  ultima_verificacion: string | null;
  ttl_dias: number | null;
  vencida: boolean;
}

interface ExposicionReport {
  privados: number;
  expuestos: number;
  desconocidos: number;
  revalidacion_vencida: number;
  items: PrivadoRow[];
}

const fmt = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function DetalleExposicionPanel() {
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["detalle-exposicion-report"],
    queryFn: async () => {
      const { data: rep } = await supabase.rpc("detalle_exposicion_report" as never);
      return (rep ?? null) as unknown as ExposicionReport | null;
    },
  });

  const { data: rates } = useQuery({
    queryKey: ["despacho-privacy-rate"],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("despacho_privacy_rate" as never)
        .select("scope, scope_key, scope_label, flagged, total, despacho_distribution, measured_at, notes");
      return (rows ?? []) as unknown as DespachoPrivacyRate[];
    },
  });

  const sync = async () => {
    setSyncing(true);
    const { data: res, error } = await supabase.functions.invoke("sync-detalle-exposicion");
    setSyncing(false);
    if (error) {
      toast.error("No se pudo revalidar la marca de proceso privado con el proveedor");
      return;
    }
    const r = res as { evaluados?: number; cambios?: number; lecturas_fallidas?: number };
    toast.success(
      `Marca revisada en ${r?.evaluados ?? 0} expediente(s) · ${r?.cambios ?? 0} cambio(s)` +
        (r?.lecturas_fallidas ? ` · ${r.lecturas_fallidas} lectura(s) fallida(s)` : ""),
    );
    refetch();
  };

  const rows = data?.items ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Lock className="h-4 w-4" />
          Procesos marcados como privados por el proveedor
        </CardTitle>
        <Button variant="outline" size="sm" onClick={sync} disabled={syncing} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          Revalidar con el proveedor
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">Privados: {data?.privados ?? 0}</Badge>
          <Badge variant="outline">Con detalle expuesto: {data?.expuestos ?? 0}</Badge>
          <Badge variant="outline">Sin leer: {data?.desconocidos ?? 0}</Badge>
          <Badge
            variant="outline"
            className={(data?.revalidacion_vencida ?? 0) > 0 ? "border-amber-500/60 text-amber-600" : ""}
          >
            Sin revalidar dentro del TTL: {data?.revalidacion_vencida ?? 0}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          La Rama Judicial marca estos procesos como privados y no expone su detalle. El proveedor no
          declara la causa y nosotros no la interpretamos. Es una marca <strong>por proceso</strong> y{" "}
          <strong>mutable</strong>: puede cambiar de un día para otro, por eso se revalida a diario y
          nunca se deduce del despacho ni del distrito.
        </p>

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Cargando estado de exposición…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Ningún expediente de la cartera está marcado como privado en este momento.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1 text-left font-medium">Radicado</th>
                  <th className="py-1 text-left font-medium">Motivo declarado</th>
                  <th className="py-1 text-left font-medium">Desde</th>
                  <th className="py-1 text-left font-medium">Última verificación</th>
                  <th className="py-1 text-left font-medium">Frecuencia observada</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 25).map((r) => {
                  const rate = resolvePrivacyRate(r.radicado, rates ?? []);
                  return (
                    <tr key={r.work_item_id} className="border-b last:border-0 align-top">
                      <td className="py-1 font-mono">{r.radicado ?? "—"}</td>
                      <td className="py-1">{claseMotivoLabel(r.motivo)}</td>
                      <td className="py-1">{fmt(r.desde)}</td>
                      <td className="py-1">
                        {r.vencida ? (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            {fmt(r.ultima_verificacion)} · vencida ({r.ttl_dias ?? 1} d)
                          </span>
                        ) : (
                          fmt(r.ultima_verificacion)
                        )}
                      </td>
                      <td className="py-1 text-muted-foreground max-w-[22rem]">
                        {privacyRateCopy(rate) ?? "Sin medición para esta zona."}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          La frecuencia observada sirve para interpretar la marca, no para deducirla: en los despachos
          medidos conviven procesos marcados y no marcados, de modo que ningún despacho es «privado» y
          la tasa nunca silencia una alarma de cobertura.
        </p>
      </CardContent>
    </Card>
  );
}
