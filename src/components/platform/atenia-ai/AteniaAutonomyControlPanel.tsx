/**
 * AteniaAutonomyControlPanel — Toggle autonomy on/off, view allowed actions, budgets.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Bot, Zap, Shield, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { runAutonomyCycle } from "@/lib/services/atenia-ai-autonomy-engine";

interface Props {
  organizationId: string;
}

const ACTION_LABELS: Record<string, string> = {
  RETRY_ENQUEUE: "Reintentar sincronizaciones",
  MARK_STUCK: "Marcar fuentes atascadas",
  SUSPEND_MONITORING: "Suspender monitoreo",
  DAILY_CONTINUATION: "Continuación de sync diario",
  TRIGGER_CORRECTIVE_SYNC: "Sync correctivo",
  SPLIT_HEAVY_SYNC: "Dividir sync pesado",
  DEMOTE_PROVIDER_ROUTE: "Degradar ruta de proveedor",
  REACTIVATE_MONITORING_BATCH: "Reactivación masiva",
  ESCALATE_TO_LLM: "Escalar a LLM",
};

export function AteniaAutonomyControlPanel({ organizationId }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const { data: policy, isLoading } = useQuery({
    queryKey: ["autonomy-policy"],
    queryFn: async () => {
      const { data } = await (supabase
        .from("atenia_ai_autonomy_policy") as any)
        .select("*")
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });

  const handleToggle = async (enabled: boolean) => {
    if (!policy?.id) return;
    setIsSaving(true);
    try {
      await (supabase
        .from("atenia_ai_autonomy_policy") as any)
        .update({ is_enabled: enabled, updated_at: new Date().toISOString() })
        .eq("id", policy.id);
      toast.success(enabled ? "Autonomía activada" : "Autonomía desactivada");
      queryClient.invalidateQueries({ queryKey: ["autonomy-policy"] });
    } catch {
      toast.error("Error al guardar");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunCycle = async () => {
    setIsRunning(true);
    try {
      const result = await runAutonomyCycle(organizationId);
      const executed = result.plans.filter(p => p.status === "EXECUTED").length;
      const planned = result.plans.filter(p => p.status === "PLANNED").length;
      const skipped = result.plans.filter(p => p.status === "SKIPPED").length;
      toast.success(
        `Ciclo completado: ${executed} ejecutadas, ${planned} pendientes, ${skipped} omitidas (${result.duration_ms}ms)`,
      );
      queryClient.invalidateQueries({ queryKey: ["atenia-actions"] });
    } catch (err: any) {
      toast.error("Error: " + (err.message || "desconocido"));
    } finally {
      setIsRunning(false);
    }
  };

  const allowed = policy?.allowed_actions ?? [];
  const confirmation = policy?.require_confirmation_actions ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            Autonomía de Atenia AI
          </CardTitle>
          <div className="flex items-center gap-3">
            {policy && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {policy.is_enabled ? "🟢 Activa" : "🔴 Desactivada"}
                </span>
                <Switch
                  checked={policy.is_enabled}
                  onCheckedChange={handleToggle}
                  disabled={isSaving}
                />
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunCycle}
              disabled={isRunning || !policy?.is_enabled}
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-1" />
              )}
              Ejecutar ciclo
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !policy ? (
          <p className="text-sm text-muted-foreground">No se encontró política de autonomía.</p>
        ) : (
          <>
            {/* Allowed actions */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <Zap className="h-3 w-3" /> Acciones automáticas (sin confirmación)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allowed.map((a: string) => (
                  <Badge key={a} variant="default" className="text-[10px]">
                    ✅ {ACTION_LABELS[a] || a}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Confirmation-required actions */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <Shield className="h-3 w-3" /> Requieren confirmación
              </p>
              <div className="flex flex-wrap gap-1.5">
                {confirmation.map((a: string) => (
                  <Badge key={a} variant="secondary" className="text-[10px]">
                    ⚠️ {ACTION_LABELS[a] || a}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Budget summary */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">📊 Presupuestos</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[10px]">
                {Object.entries(policy.budgets || {}).slice(0, 6).map(([key, val]: [string, any]) => (
                  <div key={key} className="flex justify-between border rounded px-2 py-1">
                    <span className="truncate">{ACTION_LABELS[key]?.split(" ")[0] || key}</span>
                    <span className="text-muted-foreground">{val.max_per_hour}/h · {val.max_per_day}/d</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
