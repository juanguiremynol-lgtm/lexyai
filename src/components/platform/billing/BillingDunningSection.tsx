/**
 * Billing Dunning & Collections Section — Real dunning controls with rule management
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Play, Loader2, Clock, Zap, Ban } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

export function BillingDunningSection() {
  const queryClient = useQueryClient();

  // Fetch dunning rules
  const { data: dunningRules } = useQuery({
    queryKey: ["platform-dunning-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dunning_rules")
        .select("*")
        .order("attempt_number", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch dunning schedule entries
  const { data: dunningEntries, isLoading } = useQuery({
    queryKey: ["platform-dunning-schedule"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dunning_schedule")
        .select("*")
        .order("scheduled_at", { ascending: true })
        .limit(50);
      if (error) throw error;

      const orgIds = [...new Set((data || []).map((d) => d.organization_id))];
      if (orgIds.length === 0) return [];
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds);
      const orgMap = new Map((orgs || []).map((o) => [o.id, o.name]));

      return (data || []).map((d) => ({ ...d, org_name: orgMap.get(d.organization_id) || "—" }));
    },
    staleTime: 30_000,
  });

  // Dry run mutation
  const dryRunMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing-dunning-engine`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dry_run: true }),
        }
      );

      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Dry run failed");
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Dry run: ${data.processed} entradas procesarían`, {
        description: data.results?.map((r: any) => `${r.organization_id.slice(0, 8)}: ${r.action} → ${r.escalation || "retry"}`).join("\n"),
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Execute dunning mutation
  const executeMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing-dunning-engine`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dry_run: false }),
        }
      );

      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Execution failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["platform-dunning-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["platform-billing-subscriptions"] });
      toast.success(`Dunning ejecutado: ${data.processed} entradas procesadas`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const statusStyle: Record<string, string> = {
    PENDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    PROCESSING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    COMPLETED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    ESCALATED: "bg-red-500/20 text-red-400 border-red-500/30",
    SKIPPED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };

  const pendingCount = dunningEntries?.filter(d => d.status === "PENDING").length || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
          Cobros y Morosidad
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Programación de intentos de cobro, escalamiento y suspensión automática.
        </p>
      </div>

      {/* Dunning Rules (Escalation Ladder) */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" />
            Escalera de Cobro (Dunning Rules)
          </CardTitle>
          <CardDescription className="text-slate-400">
            Reglas de escalamiento configuradas. Cada intento fallido avanza al siguiente nivel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {dunningRules?.map((rule: any) => (
              <div key={rule.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-700/30 bg-slate-800/20">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-amber-400">#{rule.attempt_number}</span>
                  </div>
                  <div>
                    <p className="text-sm text-slate-200">{rule.action_type.replace(/_/g, " ")}</p>
                    <p className="text-xs text-slate-500">
                      Espera: {rule.delay_hours}h
                      {rule.notify_email && " • Email"}
                      {rule.notify_in_app && " • In-App"}
                    </p>
                  </div>
                </div>
                {rule.escalation_action && (
                  <Badge className={
                    rule.escalation_action === "CANCEL"
                      ? "bg-red-500/20 text-red-400 border-red-500/30"
                      : "bg-orange-500/20 text-orange-400 border-orange-500/30"
                  }>
                    → {rule.escalation_action === "SUSPEND" ? "Suspender" : "Cancelar"}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card className="bg-slate-900/50 border-amber-500/20">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-200 font-medium">
                {pendingCount} intentos pendientes de ejecución
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Ejecute manualmente o configure un cron para procesamiento automático.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => dryRunMutation.mutate()}
                disabled={dryRunMutation.isPending || pendingCount === 0}
              >
                {dryRunMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Clock className="h-4 w-4 mr-1" />}
                Dry Run
              </Button>
              <Button
                size="sm"
                onClick={() => executeMutation.mutate()}
                disabled={executeMutation.isPending || pendingCount === 0}
                className="bg-amber-500 hover:bg-amber-600 text-black"
              >
                {executeMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                Ejecutar Dunning
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dunning Schedule Table */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base">Programación de Cobros</CardTitle>
          <CardDescription className="text-slate-400">
            Intentos de cobro programados y ejecutados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-400">Cargando...</p>
          ) : (dunningEntries?.length || 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay intentos de cobro programados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Organización</th>
                    <th className="text-left py-2 px-2">Intento</th>
                    <th className="text-left py-2 px-2">Programado</th>
                    <th className="text-left py-2 px-2">Ejecutado</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {dunningEntries?.map((d: any) => (
                    <tr key={d.id} className="border-b border-slate-800/50">
                      <td className="py-2 px-2 text-slate-200">{d.org_name}</td>
                      <td className="py-2 px-2 text-slate-300">#{d.attempt_number}</td>
                      <td className="py-2 px-2 text-slate-400">
                        {format(new Date(d.scheduled_at), "dd MMM yyyy HH:mm", { locale: es })}
                      </td>
                      <td className="py-2 px-2 text-slate-400">
                        {d.executed_at ? format(new Date(d.executed_at), "dd MMM HH:mm", { locale: es }) : "—"}
                      </td>
                      <td className="py-2 px-2">
                        <Badge className={statusStyle[d.status] || "bg-slate-500/20 text-slate-300"}>{d.status}</Badge>
                      </td>
                      <td className="py-2 px-2 text-slate-400">{d.action_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
