/**
 * GlobalRoutingCard — Configure PLATFORM-WIDE provider routing per workflow category.
 * Routes reference provider_connectors (not instances), applied to all orgs.
 * Super admin only.
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Route, Plus, Trash2, Loader2, ArrowUpDown, Globe, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";

const SYNC_WORKFLOWS: WorkflowType[] = ["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"];
const SCOPES = [
  { value: "BOTH", label: "Acts + Pubs" },
  { value: "ACTS", label: "Solo Acts" },
  { value: "PUBS", label: "Solo Pubs" },
];
const ROUTE_KINDS = [
  { value: "PRIMARY", label: "PRIMARY" },
  { value: "FALLBACK", label: "FALLBACK" },
];

interface Connector {
  id: string;
  name: string;
  key: string;
  is_enabled: boolean;
}

interface GlobalRouteRow {
  id: string;
  workflow: string;
  scope: string;
  route_kind: string;
  priority: number;
  provider_connector_id: string;
  is_authoritative: boolean;
  enabled: boolean;
  provider_connectors: Connector | null;
}

const BUILTIN_DEFAULTS: Record<string, { primary: string; fallback: string | null }> = {
  CGP: { primary: "CPNU", fallback: null },
  LABORAL: { primary: "CPNU", fallback: null },
  CPACA: { primary: "SAMAI", fallback: null },
  TUTELA: { primary: "CPNU", fallback: "TUTELAS API" },
  PENAL_906: { primary: "CPNU", fallback: "SAMAI" },
};

export function GlobalRoutingCard() {
  const queryClient = useQueryClient();
  const [addingWorkflow, setAddingWorkflow] = useState("");
  const [addingScope, setAddingScope] = useState("BOTH");
  const [addingKind, setAddingKind] = useState("PRIMARY");
  const [addingConnectorId, setAddingConnectorId] = useState("");
  const [addingPriority, setAddingPriority] = useState(0);

  // Load global routes
  const { data: globalData, isLoading } = useQuery({
    queryKey: ["global-routes"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("provider-list-global-routes", {
        body: {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as {
        routes: GlobalRouteRow[];
        policies: any[];
        coverage: Record<string, number>;
      };
    },
  });

  // Load all connectors
  const { data: connectors } = useQuery({
    queryKey: ["all-connectors"],
    queryFn: async () => {
      const { data } = await supabase
        .from("provider_connectors")
        .select("id, name, key, is_enabled")
        .eq("is_enabled", true)
        .order("name");
      return (data || []) as Connector[];
    },
  });

  const addRouteMutation = useMutation({
    mutationFn: async () => {
      if (!addingWorkflow || !addingConnectorId) {
        throw new Error("Campos requeridos incompletos");
      }
      const { data, error } = await supabase.functions.invoke("provider-set-global-routes", {
        body: {
          routes: [{
            workflow: addingWorkflow,
            scope: addingScope,
            route_kind: addingKind,
            priority: addingPriority,
            provider_connector_id: addingConnectorId,
            enabled: true,
          }],
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Ruta global agregada");
      queryClient.invalidateQueries({ queryKey: ["global-routes"] });
      setAddingWorkflow("");
      setAddingConnectorId("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleRouteMutation = useMutation({
    mutationFn: async ({ routeId, enabled }: { routeId: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("provider_category_routes_global")
        .update({ enabled })
        .eq("id", routeId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["global-routes"] }),
  });

  const deleteRouteMutation = useMutation({
    mutationFn: async (routeId: string) => {
      const { error } = await supabase
        .from("provider_category_routes_global")
        .delete()
        .eq("id", routeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ruta eliminada");
      queryClient.invalidateQueries({ queryKey: ["global-routes"] });
    },
  });

  const routes = globalData?.routes || [];
  const coverage = globalData?.coverage || {};

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="h-5 w-5 text-amber-400" />
            E) Routing Global por Categoría
          </CardTitle>
          <CardDescription>
            Configuración PLATFORM-WIDE — aplica a todas las organizaciones. Las rutas referencian conectores; cada org debe tener una instancia habilitada.
          </CardDescription>
        </div>
        <Badge variant="outline" className={routes.length > 0
          ? "text-emerald-400 border-emerald-500/50 bg-emerald-500/10"
          : "text-slate-400 border-slate-600"
        }>
          {routes.length > 0 ? `${routes.length} rutas globales` : "Sin rutas (defaults)"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {SYNC_WORKFLOWS.map((wf) => {
            const wfRoutes = routes.filter((r) => r.workflow === wf);
            const builtin = BUILTIN_DEFAULTS[wf];
            const wfConfig = WORKFLOW_TYPES[wf];

            return (
              <div key={wf} className="bg-slate-800/30 border border-slate-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-200">{wfConfig.shortLabel}</span>
                    <Badge variant="outline" className="text-xs text-slate-400 border-slate-600">
                      {wfConfig.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <span>Default: {builtin?.primary || "—"}</span>
                    {builtin?.fallback && <span>→ {builtin.fallback}</span>}
                  </div>
                </div>

                {wfRoutes.length > 0 ? (
                  <div className="space-y-1 mt-2">
                    {wfRoutes
                      .sort((a, b) => {
                        if (a.route_kind !== b.route_kind) return a.route_kind === "PRIMARY" ? -1 : 1;
                        return a.priority - b.priority;
                      })
                      .map((route) => {
                        const orgCount = coverage[route.provider_connector_id] || 0;
                        return (
                          <div
                            key={route.id}
                            className={`flex items-center justify-between rounded px-2 py-1.5 text-sm ${
                              route.enabled ? "bg-slate-800/50" : "bg-slate-800/20 opacity-50"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={`text-xs ${
                                  route.route_kind === "PRIMARY"
                                    ? "text-emerald-400 border-emerald-500/50 bg-emerald-500/10"
                                    : "text-amber-400 border-amber-500/50 bg-amber-500/10"
                                }`}
                              >
                                {route.route_kind}
                              </Badge>
                              <Badge variant="outline" className="text-xs text-slate-400 border-slate-600">
                                {route.scope}
                              </Badge>
                              <span className="text-slate-300 font-mono text-xs">P{route.priority}</span>
                              <span className="text-slate-200">
                                {route.provider_connectors?.name || "?"}
                              </span>
                              {route.is_authoritative && (
                                <Badge variant="outline" className="text-[10px] text-violet-400 border-violet-500/50 bg-violet-500/10">
                                  👑 AUTH
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/50">
                                {orgCount} org(s)
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <Switch
                                checked={route.enabled}
                                onCheckedChange={(v) =>
                                  toggleRouteMutation.mutate({ routeId: route.id, enabled: v })
                                }
                                className="scale-75"
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() => deleteRouteMutation.mutate(route.id)}
                              >
                                <Trash2 className="h-3 w-3 text-red-400" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">
                    Sin rutas globales — usa built-in ({builtin?.primary || "default"})
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Add route form */}
        <div className="border border-dashed border-slate-700 rounded-lg p-3 space-y-3">
          <Label className="text-slate-300 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Agregar Ruta Global
          </Label>
          <div className="grid grid-cols-5 gap-2">
            <Select value={addingWorkflow} onValueChange={setAddingWorkflow}>
              <SelectTrigger className="bg-slate-800 border-slate-600">
                <SelectValue placeholder="Workflow" />
              </SelectTrigger>
              <SelectContent>
                {SYNC_WORKFLOWS.map((wf) => (
                  <SelectItem key={wf} value={wf}>{WORKFLOW_TYPES[wf].shortLabel}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={addingScope} onValueChange={setAddingScope}>
              <SelectTrigger className="bg-slate-800 border-slate-600">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={addingKind} onValueChange={setAddingKind}>
              <SelectTrigger className="bg-slate-800 border-slate-600">
                <SelectValue placeholder="Kind" />
              </SelectTrigger>
              <SelectContent>
                {ROUTE_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={addingConnectorId} onValueChange={setAddingConnectorId}>
              <SelectTrigger className="bg-slate-800 border-slate-600">
                <SelectValue placeholder="Conector" />
              </SelectTrigger>
              <SelectContent>
                {connectors?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={addingPriority}
                onChange={(e) => setAddingPriority(Number(e.target.value))}
                placeholder="P"
                className="bg-slate-800 border-slate-600 w-16"
              />
              <Button
                onClick={() => addRouteMutation.mutate()}
                disabled={addRouteMutation.isPending || !addingWorkflow || !addingConnectorId}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {addRouteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          {!connectors?.length && (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              No hay conectores habilitados. Cree uno en el panel A.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
