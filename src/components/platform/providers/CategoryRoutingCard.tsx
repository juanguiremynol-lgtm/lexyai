/**
 * CategoryRoutingCard — Configure provider routing per workflow category.
 * Shows matrix of workflow × scope with PRIMARY/FALLBACK provider assignments.
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Route, Plus, Trash2, Loader2, ArrowUpDown, Copy, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";

const SYNC_WORKFLOWS: WorkflowType[] = ["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"];
const SCOPES = [
  { value: "BOTH", label: "Actuaciones + Publicaciones" },
  { value: "ACTS", label: "Solo Actuaciones" },
  { value: "PUBS", label: "Solo Publicaciones/Estados" },
];
const ROUTE_KINDS = [
  { value: "PRIMARY", label: "PRIMARY" },
  { value: "FALLBACK", label: "FALLBACK" },
];

interface Instance {
  id: string;
  name: string;
  base_url: string;
  auth_type: string;
  is_enabled: boolean;
}

interface RouteRow {
  id: string;
  organization_id: string;
  workflow: string;
  scope: string;
  route_kind: string;
  priority: number;
  provider_instance_id: string;
  enabled: boolean;
  is_authoritative: boolean;
  provider_instances: Instance | null;
}

interface CategoryRoutingCardProps {
  organizationId: string | null;
}

// Built-in defaults for display
const BUILTIN_DEFAULTS: Record<string, { primary: string; fallback: string | null }> = {
  CGP: { primary: "CPNU", fallback: null },
  LABORAL: { primary: "CPNU", fallback: null },
  CPACA: { primary: "SAMAI", fallback: null },
  TUTELA: { primary: "CPNU", fallback: "TUTELAS API" },
  PENAL_906: { primary: "CPNU", fallback: "SAMAI" },
};

export function CategoryRoutingCard({ organizationId }: CategoryRoutingCardProps) {
  const queryClient = useQueryClient();
  const [addingWorkflow, setAddingWorkflow] = useState("");
  const [addingScope, setAddingScope] = useState("BOTH");
  const [addingKind, setAddingKind] = useState("PRIMARY");
  const [addingInstanceId, setAddingInstanceId] = useState("");
  const [addingPriority, setAddingPriority] = useState(0);

  // Load routes
  const { data: routesData, isLoading } = useQuery({
    queryKey: ["provider-category-routes", organizationId],
    queryFn: async () => {
      if (!organizationId) return { routes: [], grouped: {} };
      const { data, error } = await supabase.functions.invoke("provider-list-category-routes", {
        body: { organization_id: organizationId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { routes: RouteRow[]; grouped: Record<string, RouteRow[]> };
    },
    enabled: !!organizationId,
  });

  // Load available instances for this org
  const { data: instances } = useQuery({
    queryKey: ["provider-instances-for-org", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data } = await supabase
        .from("provider_instances")
        .select("id, name, base_url, auth_type, is_enabled")
        .eq("organization_id", organizationId)
        .eq("is_enabled", true)
        .order("name");
      return (data || []) as Instance[];
    },
    enabled: !!organizationId,
  });

  const addRouteMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId || !addingWorkflow || !addingInstanceId) {
        throw new Error("Campos requeridos incompletos");
      }
      const { data, error } = await supabase.functions.invoke("provider-set-category-routes", {
        body: {
          organization_id: organizationId,
          routes: [{
            workflow: addingWorkflow,
            scope: addingScope,
            route_kind: addingKind,
            priority: addingPriority,
            provider_instance_id: addingInstanceId,
            enabled: true,
          }],
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success("Ruta agregada");
      queryClient.invalidateQueries({ queryKey: ["provider-category-routes"] });
      setAddingWorkflow("");
      setAddingInstanceId("");
      if (data.warnings?.length) {
        toast.warning(`${data.warnings.length} advertencia(s) de seguridad`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleRouteMutation = useMutation({
    mutationFn: async ({ routeId, enabled }: { routeId: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("provider_category_routes")
        .update({ enabled })
        .eq("id", routeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-category-routes"] });
    },
  });

  const deleteRouteMutation = useMutation({
    mutationFn: async (routeId: string) => {
      const { error } = await supabase
        .from("provider_category_routes")
        .delete()
        .eq("id", routeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ruta eliminada");
      queryClient.invalidateQueries({ queryKey: ["provider-category-routes"] });
    },
  });

  const copyRoutes = () => {
    navigator.clipboard.writeText(JSON.stringify(routesData?.routes || [], null, 2));
    toast.success("Rutas copiadas");
  };

  if (!organizationId) {
    return (
      <Card className="border-slate-700 bg-slate-900/50 opacity-60">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Route className="h-5 w-5 text-amber-400" />
            E) Routing por Categoría
          </CardTitle>
          <CardDescription>Seleccione una organización en el panel B</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const routes = routesData?.routes || [];

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Route className="h-5 w-5 text-amber-400" />
            E) Routing por Categoría
          </CardTitle>
          <CardDescription>
            Asigne proveedores a workflows con prioridad PRIMARY/FALLBACK
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={routes.length > 0
            ? "text-emerald-400 border-emerald-500/50 bg-emerald-500/10"
            : "text-slate-400 border-slate-600"
          }>
            {routes.length > 0 ? `${routes.length} rutas` : "Sin rutas (defaults)"}
          </Badge>
          <Button size="sm" variant="ghost" onClick={copyRoutes}><Copy className="h-4 w-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Workflow routing matrix */}
        <div className="space-y-3">
          {SYNC_WORKFLOWS.map((wf) => {
            const wfRoutes = routes.filter((r) => r.workflow === wf);
            const builtin = BUILTIN_DEFAULTS[wf];
            const primaryRoutes = wfRoutes.filter((r) => r.route_kind === "PRIMARY" && r.enabled);
            const fallbackRoutes = wfRoutes.filter((r) => r.route_kind === "FALLBACK" && r.enabled);
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

                {/* Configured routes for this workflow */}
                {wfRoutes.length > 0 ? (
                  <div className="space-y-1 mt-2">
                    {wfRoutes
                      .sort((a, b) => {
                        if (a.route_kind !== b.route_kind) return a.route_kind === "PRIMARY" ? -1 : 1;
                        return a.priority - b.priority;
                      })
                      .map((route) => (
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
                            <span className="text-slate-300 font-mono text-xs">
                              P{route.priority}
                            </span>
                            <span className="text-slate-200">
                              {route.provider_instances?.name || route.provider_instance_id.slice(0, 8)}
                            </span>
                            {route.is_authoritative && (
                              <Badge variant="outline" className="text-[10px] text-violet-400 border-violet-500/50 bg-violet-500/10">
                                👑 AUTH
                              </Badge>
                            )}
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
                      ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">
                    Sin rutas externas — usa proveedores built-in ({builtin?.primary || "default"})
                  </p>
                )}

                {/* Effective chain preview */}
                {(primaryRoutes.length > 0 || fallbackRoutes.length > 0) && (
                  <div className="mt-2 text-xs text-slate-400 flex items-center gap-1 flex-wrap">
                    <ArrowUpDown className="h-3 w-3" />
                    <span>Cadena efectiva:</span>
                    {primaryRoutes.map((r, i) => (
                      <span key={r.id}>
                        {i > 0 && " → "}
                        <span className="text-emerald-400">{r.provider_instances?.name || "?"}</span>
                      </span>
                    ))}
                    {primaryRoutes.length > 0 && <span> → </span>}
                    <span className="text-slate-500">[{builtin?.primary}]</span>
                    {fallbackRoutes.map((r) => (
                      <span key={r.id}>
                        {" → "}
                        <span className="text-amber-400">{r.provider_instances?.name || "?"}</span>
                      </span>
                    ))}
                    {builtin?.fallback && <span> → <span className="text-slate-500">[{builtin.fallback}]</span></span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add route form */}
        <div className="border border-dashed border-slate-700 rounded-lg p-3 space-y-3">
          <Label className="text-slate-300 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Agregar Ruta
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

            <Select value={addingInstanceId} onValueChange={setAddingInstanceId}>
              <SelectTrigger className="bg-slate-800 border-slate-600">
                <SelectValue placeholder="Proveedor" />
              </SelectTrigger>
              <SelectContent>
                {instances?.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>{inst.name}</SelectItem>
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
                disabled={addRouteMutation.isPending || !addingWorkflow || !addingInstanceId}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {addRouteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          {!instances?.length && (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              No hay instancias de proveedor disponibles para esta organización. Cree una en el panel B.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
