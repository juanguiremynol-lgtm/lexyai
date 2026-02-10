/**
 * GlobalMergePolicyCard — Configure global merge strategy per workflow/scope.
 * Platform-wide: applies to all orgs. Super admin only.
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Merge, Loader2, Save, Info, Globe } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";

const SYNC_WORKFLOWS: WorkflowType[] = ["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"];
const SCOPES = ["BOTH", "ACTS", "PUBS"] as const;

const MERGE_MODE_LABELS: Record<string, { label: string; desc: string }> = {
  UNION: { label: "UNION", desc: "Unir registros de todos los proveedores" },
  UNION_PREFER_PRIMARY: { label: "UNION (Primary wins)", desc: "Primary prevalece en conflictos" },
  VERIFY_ONLY: { label: "VERIFY ONLY", desc: "Solo registrar proveniencia" },
};

interface GlobalPolicyRow {
  id: string;
  workflow: string;
  scope: string;
  strategy: string;
  merge_mode: string;
  merge_budget_max_providers: number;
  merge_budget_max_ms: number;
  allow_merge_on_empty: boolean;
  max_provider_attempts_per_run: number;
  enabled: boolean;
}

export function GlobalMergePolicyCard() {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<GlobalPolicyRow>>({});

  const { data: policies } = useQuery({
    queryKey: ["global-policies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_category_policies_global")
        .select("*")
        .order("workflow")
        .order("scope");
      if (error) throw error;
      return (data || []) as GlobalPolicyRow[];
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (policy: Partial<GlobalPolicyRow> & { workflow: string; scope: string }) => {
      const { data, error } = await supabase.functions.invoke("provider-set-global-policy", {
        body: {
          workflow: policy.workflow,
          scope: policy.scope,
          strategy: policy.strategy || "SELECT",
          merge_mode: policy.merge_mode || "UNION_PREFER_PRIMARY",
          merge_budget_max_providers: policy.merge_budget_max_providers ?? 2,
          merge_budget_max_ms: policy.merge_budget_max_ms ?? 15000,
          allow_merge_on_empty: policy.allow_merge_on_empty ?? false,
          max_provider_attempts_per_run: policy.max_provider_attempts_per_run ?? 2,
          enabled: policy.enabled ?? true,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Política global guardada");
      queryClient.invalidateQueries({ queryKey: ["global-policies"] });
      queryClient.invalidateQueries({ queryKey: ["global-routes"] });
      setEditingKey(null);
      setEditForm({});
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const getPolicy = (wf: string, scope: string): GlobalPolicyRow | undefined => {
    return policies?.find((p) => p.workflow === wf && p.scope === scope);
  };

  const startEdit = (wf: string, scope: string) => {
    const existing = getPolicy(wf, scope);
    setEditingKey(`${wf}|${scope}`);
    setEditForm(existing || {
      workflow: wf,
      scope,
      strategy: "SELECT",
      merge_mode: "UNION_PREFER_PRIMARY",
      merge_budget_max_providers: 2,
      merge_budget_max_ms: 15000,
      allow_merge_on_empty: false,
      max_provider_attempts_per_run: 2,
      enabled: true,
    });
  };

  const mergeCount = policies?.filter((p) => p.strategy === "MERGE").length || 0;

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="h-5 w-5 text-violet-400" />
              <Merge className="h-5 w-5 text-violet-400" />
              G) Políticas de Merge (Global)
            </CardTitle>
            <CardDescription>
              SELECT o MERGE por workflow/scope — aplica a TODAS las organizaciones
            </CardDescription>
          </div>
          <Badge variant="outline" className={mergeCount > 0
            ? "text-violet-400 border-violet-500/50 bg-violet-500/10"
            : "text-slate-400 border-slate-600"
          }>
            {mergeCount > 0 ? `${mergeCount} MERGE` : "Todo SELECT"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {SYNC_WORKFLOWS.map((wf) => {
          const wfConfig = WORKFLOW_TYPES[wf];
          return (
            <div key={wf} className="bg-slate-800/30 border border-slate-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-slate-200">{wfConfig.shortLabel}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {SCOPES.map((scope) => {
                  const policy = getPolicy(wf, scope);
                  const key = `${wf}|${scope}`;
                  const isEditing = editingKey === key;
                  const isMerge = isEditing ? editForm.strategy === "MERGE" : policy?.strategy === "MERGE";

                  return (
                    <div
                      key={scope}
                      className={`rounded-lg border p-2 text-xs cursor-pointer transition-colors ${
                        isMerge
                          ? "border-violet-500/50 bg-violet-900/10"
                          : "border-slate-700 bg-slate-800/30 hover:bg-slate-800/50"
                      }`}
                      onClick={() => !isEditing && startEdit(wf, scope)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-slate-400">{scope}</span>
                        <Badge variant="outline" className={`text-[10px] px-1 ${
                          isMerge ? "text-violet-400 border-violet-500/50" : "text-slate-500 border-slate-600"
                        }`}>
                          {isMerge ? "MERGE" : "SELECT"}
                        </Badge>
                      </div>

                      {isEditing ? (
                        <div className="space-y-2 mt-2" onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={editForm.strategy || "SELECT"}
                            onValueChange={(v) => setEditForm({ ...editForm, strategy: v })}
                          >
                            <SelectTrigger className="h-7 text-xs bg-slate-900 border-slate-600">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="SELECT">SELECT</SelectItem>
                              <SelectItem value="MERGE">MERGE</SelectItem>
                            </SelectContent>
                          </Select>

                          {editForm.strategy === "MERGE" && (
                            <>
                              <Select
                                value={editForm.merge_mode || "UNION_PREFER_PRIMARY"}
                                onValueChange={(v) => setEditForm({ ...editForm, merge_mode: v })}
                              >
                                <SelectTrigger className="h-7 text-xs bg-slate-900 border-slate-600">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(MERGE_MODE_LABELS).map(([k, v]) => (
                                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              <div className="flex gap-1">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex-1">
                                        <Input
                                          type="number" min={1} max={5}
                                          value={editForm.merge_budget_max_providers ?? 2}
                                          onChange={(e) => setEditForm({ ...editForm, merge_budget_max_providers: Number(e.target.value) })}
                                          className="h-7 text-xs bg-slate-900 border-slate-600"
                                        />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>Max proveedores por run</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex-1">
                                        <Input
                                          type="number" min={5000} max={60000} step={1000}
                                          value={editForm.merge_budget_max_ms ?? 15000}
                                          onChange={(e) => setEditForm({ ...editForm, merge_budget_max_ms: Number(e.target.value) })}
                                          className="h-7 text-xs bg-slate-900 border-slate-600"
                                        />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>Budget max ms</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>

                              <div className="flex items-center gap-1">
                                <Switch
                                  checked={editForm.allow_merge_on_empty ?? false}
                                  onCheckedChange={(v) => setEditForm({ ...editForm, allow_merge_on_empty: v })}
                                  className="scale-[0.6]"
                                />
                                <span className="text-[10px] text-slate-400">Merge on empty</span>
                              </div>
                            </>
                          )}

                          <div className="flex gap-1 mt-1">
                            <Button
                              size="sm"
                              className="h-6 text-xs bg-violet-600 hover:bg-violet-700 flex-1"
                              disabled={upsertMutation.isPending}
                              onClick={() => upsertMutation.mutate({ workflow: wf, scope, ...editForm } as any)}
                            >
                              {upsertMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setEditingKey(null); setEditForm({}); }}>×</Button>
                          </div>
                        </div>
                      ) : (
                        policy?.strategy === "MERGE" && (
                          <div className="text-[10px] text-violet-300 mt-1">
                            {MERGE_MODE_LABELS[policy.merge_mode]?.label || policy.merge_mode}
                            <br />
                            max {policy.merge_budget_max_providers} prov / {policy.merge_budget_max_ms}ms
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="flex items-start gap-2 text-xs text-slate-500 mt-2">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            <strong>SELECT:</strong> Cadena secuencial (PRIMARY → built-in → FALLBACK).{" "}
            <strong>MERGE:</strong> Ingesta multi-proveedor, deduplica y fusiona.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
