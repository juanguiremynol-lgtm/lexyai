/**
 * WorkItemCoveragePanel — iteration 14.
 *
 * Monitoring is a derived property, not a user decision. What the lawyer needs
 * to see is not "is monitoring on" but "is this matter genuinely covered, and
 * if a source is silent, why". Known-silent despachos (El Retiro, the
 * Barranquilla CGP pattern) are modelled in `despacho_coverage`, so expected
 * silence reads as explained rather than alarming.
 *
 * Suspension is an explicit act with a stored reason, available only here.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Activity, AlertTriangle, Info, Mail, PauseCircle, Play, Radar } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { isProviderMonitoredWorkflow, providerChainFor } from "@/lib/monitoring-matrix";
import {
  ESTADOS_SIGNAL_EXPLANATION,
  ESTADOS_SIGNAL_LABEL,
  estadosSignalTone,
  type EstadosSignal,
} from "@/lib/estados-coverage-signal";

interface CoverageRow {
  provider_key: string;
  scope: string;
  provider_label: string;
  last_ok_run: string | null;
  last_ingest: string | null;
  // Iteration 23: "SIN_RESPUESTA" is reserved for a provider that genuinely
  // never completes. Failures on our own side surface as "EN_VERIFICACION" and
  // are never stated as a fact about the matter.
  status_code: "CUBIERTO" | "SILENCIO_CONOCIDO" | "SIN_RESPUESTA" | "EN_VERIFICACION" | "SIN_FILAS";
  status_label: string;
}

interface Props {
  workItemId: string;
  workflowType: string;
  radicado?: string | null;
  monitoringEnabled?: boolean;
  monitoringDisabledReason?: string | null;
  onChanged?: () => void;
}

function statusTone(code: CoverageRow["status_code"]) {
  switch (code) {
    case "CUBIERTO":
      return "border-emerald-500/50 text-emerald-600";
    case "SILENCIO_CONOCIDO":
      return "border-sky-500/50 text-sky-600";
    case "SIN_RESPUESTA":
      return "border-amber-500/50 text-amber-600";
    case "EN_VERIFICACION":
      return "border-slate-400/50 text-slate-500";
    default:
      return "border-muted-foreground/40 text-muted-foreground";
  }
}

export function WorkItemCoveragePanel({
  workItemId,
  workflowType,
  radicado,
  monitoringEnabled = true,
  monitoringDisabledReason,
  onChanged,
}: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const eligible = isProviderMonitoredWorkflow(workflowType);

  const { data, isLoading } = useQuery({
    queryKey: ["work-item-coverage", workItemId],
    enabled: eligible,
    queryFn: async (): Promise<CoverageRow[]> => {
      const { data, error } = await (supabase as any).rpc("get_work_item_coverage", {
        p_work_item_id: workItemId,
      });
      if (error) throw error;
      return (data ?? []) as CoverageRow[];
    },
  });

  // Iteration 33 — cross-provider check: actuaciones without estados.
  const { data: estadosSignal } = useQuery({
    queryKey: ["work-item-estados-signal", workItemId],
    enabled: eligible,
    queryFn: async (): Promise<EstadosSignal | null> => {
      const { data, error } = await (supabase as any).rpc("classify_work_item_estados_signal", {
        p_work_item_id: workItemId,
      });
      if (error) throw error;
      return (data ?? null) as EstadosSignal | null;
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["work-item-coverage", workItemId] });
    qc.invalidateQueries({ queryKey: ["work-item-estados-signal", workItemId] });
    qc.invalidateQueries({ queryKey: ["work-item-detail", workItemId] });
    onChanged?.();
  }

  async function suspend() {
    setSaving(true);
    const { error } = await (supabase as any).rpc("suspend_work_item_monitoring", {
      p_work_item_id: workItemId,
      p_reason: reason.trim(),
    });
    setSaving(false);
    setOpen(false);
    if (error) {
      toast.error("No fue posible suspender el monitoreo");
      return;
    }
    setReason("");
    toast.success("Monitoreo suspendido con razón registrada");
    refresh();
  }

  async function resume() {
    setSaving(true);
    const { error } = await (supabase as any).rpc("resume_work_item_monitoring", {
      p_work_item_id: workItemId,
    });
    setSaving(false);
    if (error) {
      toast.error("No fue posible reanudar el monitoreo");
      return;
    }
    toast.success("Monitoreo reanudado");
    refresh();
  }

  // Non-judicial categories: this is the designed state, not a defect.
  if (!eligible) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            Sin proveedores judiciales — seguimiento por correo
          </CardTitle>
          <CardDescription>
            Esta categoría no se consulta en proveedores judiciales porque no publican
            información sobre ella. Su inteligencia proviene exclusivamente de la
            integración de correo.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radar className="h-4 w-4" />
          Cobertura de fuentes
        </CardTitle>
        <CardDescription>
          Cadena según la matriz de enrutamiento: {providerChainFor(workflowType).join(" · ")}.
          El monitoreo se activa solo, sin intervención suya.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!radicado && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Este asunto aún no tiene radicado: los proveedores no pueden consultarse.
          </p>
        )}

        {!monitoringEnabled && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
              <PauseCircle className="h-4 w-4" />
              Monitoreo oculto (se sigue leyendo)
            </div>
            {monitoringDisabledReason && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Razón: {monitoringDisabledReason}
              </p>
            )}
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={resume} disabled={saving}>
              <Play className="h-3.5 w-3.5" />
              Reanudar monitoreo
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {(data ?? []).map((row) => (
              <div key={row.provider_key} className="rounded-md border p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{row.provider_label}</span>
                  <Badge variant="outline" className={`gap-1 text-[10px] ${statusTone(row.status_code)}`}>
                    {row.status_code === "CUBIERTO" ? (
                      <Activity className="h-3 w-3" />
                    ) : row.status_code === "SILENCIO_CONOCIDO" || row.status_code === "EN_VERIFICACION" ? (
                      <Info className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {row.status_code === "CUBIERTO"
                      ? "Cubierto"
                      : row.status_code === "SILENCIO_CONOCIDO"
                        ? "Silencio esperado"
                        : row.status_code === "EN_VERIFICACION"
                          ? "Verificación en curso"
                          : row.status_code === "SIN_RESPUESTA"
                            ? "Sin respuesta"
                            : "Sin filas"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{row.status_label}</p>
                <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                  <span>
                    Última consulta exitosa:{" "}
                    {row.last_ok_run
                      ? formatDistanceToNow(new Date(row.last_ok_run), { addSuffix: true, locale: es })
                      : "nunca"}
                  </span>
                  <span>
                    Última fila recibida:{" "}
                    {row.last_ingest
                      ? formatDistanceToNow(new Date(row.last_ingest), { addSuffix: true, locale: es })
                      : "nunca"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {estadosSignal && (
          <div className="rounded-md border p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Actuaciones frente a estados</span>
              <Badge
                variant="outline"
                className={`gap-1 text-[10px] ${estadosSignalTone(estadosSignal.signal_class)}`}
              >
                {estadosSignal.signal_class === "ESTADOS_ESPERADOS_AUSENTES" ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : estadosSignal.signal_class === "CUBIERTO" ? (
                  <Activity className="h-3 w-3" />
                ) : (
                  <Info className="h-3 w-3" />
                )}
                {ESTADOS_SIGNAL_LABEL[estadosSignal.signal_class]}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {ESTADOS_SIGNAL_EXPLANATION[estadosSignal.signal_class]}
            </p>
            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              <span>Actuaciones: {estadosSignal.acts_count}</span>
              <span>Estados recibidos: {estadosSignal.pubs_count}</span>
              <span>Fijaciones en actuaciones: {estadosSignal.fijacion_count}</span>
              {estadosSignal.estados_provider && (
                <span>
                  Fuente de estados:{" "}
                  {estadosSignal.estados_provider === "samai_estados"
                    ? "Samai Estados"
                    : "Publicaciones Procesales"}
                </span>
              )}
              {estadosSignal.last_fijacion_date && (
                <span>Última fijación: {estadosSignal.last_fijacion_date}</span>
              )}
            </div>
            {/* ITER63 — an inconclusive read is information: the question is
                open. It must not render like a matter nobody asked about. */}
            {estadosSignal.signal_class === "LECTURA_NO_CONCLUYENTE" && (
              <div className="mt-1 rounded-md border border-slate-400/50 bg-muted/40 p-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span className="font-medium">Pregunta abierta:</span> la última lectura de la
                fuente de estados no se completó, de modo que no hay veredicto de cobertura para
                este expediente. Se reintenta automáticamente; no es silencio del despacho ni
                ausencia confirmada.
              </div>
            )}
            {estadosSignal.signal_class === "ESTADOS_ESPERADOS_AUSENTES" &&
              (estadosSignal.evidence?.unmatched_fijaciones?.length ?? 0) > 0 && (
                <ul className="mt-1 space-y-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                  {estadosSignal.evidence.unmatched_fijaciones!.slice(0, 5).map((f) => (
                    <li key={f.act_id}>
                      Fijación del {f.act_date ?? "fecha no informada"} sin estado publicado
                    </li>
                  ))}
                </ul>
              )}
            {(estadosSignal.evidence?.estados_sin_documento?.length ?? 0) > 0 && (
              <ul className="mt-1 space-y-0.5 text-[10px] text-indigo-700 dark:text-indigo-400">
                {estadosSignal.evidence.estados_sin_documento!.slice(0, 5).map((f) => (
                  <li key={f.act_id}>
                    Estado del {f.act_date ?? "fecha no informada"} fijado sin documento publicado por
                    el despacho — el término corre.
                  </li>
                ))}
              </ul>
            )}
            {(estadosSignal.evidence?.fuera_de_ventana?.length ?? 0) > 0 && (
              <ul className="mt-1 space-y-0.5 text-[10px] text-sky-700 dark:text-sky-400">
                {estadosSignal.evidence.fuera_de_ventana!.slice(0, 5).map((f) => (
                  <li key={f.act_id}>
                    Fijación del {f.act_date ?? "fecha no informada"} fuera de la ventana de
                    publicación conocida del despacho.
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {monitoringEnabled && (
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => setOpen(true)}>
            <PauseCircle className="h-3.5 w-3.5" />
            Suspender monitoreo (archivado, terminado o duplicado)
          </Button>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Suspender monitoreo</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              El monitoreo se activa automáticamente para todo asunto judicial con radicado.
              Suspéndalo solo si el asunto está archivado, terminado o duplicado. La razón
              queda registrada.
            </p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Razón de la suspensión"
              rows={3}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={suspend} disabled={saving || !reason.trim()}>
                Suspender
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
