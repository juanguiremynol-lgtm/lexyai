/**
 * OrgRoutingOverridePanel — Org admin can configure org-specific routing overrides.
 * Shows effective routing with source labels and "Reset to Global Defaults" action.
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Route, Plus, Trash2, Loader2, Globe, Building2, RotateCcw, AlertTriangle, ArrowRight, Info } from "lucide-react";
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
  visibility?: string;
}

interface OrgRouteRow {
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

interface OrgRoutingOverridePanelProps {
  organizationId: string;
}

export function OrgRoutingOverridePanel({ organizationId }: OrgRoutingOverridePanelProps) {
  const queryClient = useQueryClient();
  const [addingWorkflow, setAddingWorkflow] = useState("");
  const [addingScope, setAddingScope] = useState("BOTH");
  const [addingKind, setAddingKind] = useState("PRIMARY");
  const [addingConnectorId, setAddingConnectorId] = useState("");
  const [addingPriority, setAddingPriority] = useState(0);

  // Load org override routes
  const { data: orgRoutes, isLoading } = useQuery({
    queryKey: ["org-override-routes", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_category_routes_org_override")
        .select("*, provider_connectors(id, name, key, is_enabled)")
        .eq("organization_id", organizationId)
        .order("workflow")
        .order("scope")
        .order("route_kind")
        .order("priority");
      if (error) throw error;
      return (data || []) as OrgRouteRow[];
    },
    enabled: !!organizationId,
  });

  // Load available connectors (GLOBAL + org's ORG_PRIVATE)
  const { data: connectors } = useQuery({
    queryKey: ["available-connectors", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("provider_connectors")
        .select("id, name, key, is_enabled, visibility")
        .eq("is_enabled", true)
        .order("name");
      return (data || []) as Connector[];
    },
  });

  // Load effective routing for preview
  const { data: effectiveData } = useQuery({
    queryKey: ["effective-routing", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("provider-list-effective-routing", {
        body: { organization_id: organizationId },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const addRouteMutation = useMutation({
    mutationFn: async () => {
      if (!addingWorkflow || !addingConnectorId) throw new Error("Campos requeridos");
      const { data, error } = await supabase.functions.invoke("provider-set-category-routes-org", {
        body: {
          organization_id: organizationId,
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
      toast.success("Ruta de override agregada");
      queryClient.invalidateQueries({ queryKey: ["org-override-routes", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["effective-routing", organizationId] });
      setAddingWorkflow("");
      setAddingConnectorId("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteRouteMutation = useMutation({
    mutationFn: async (routeId: string) => {
      const { error } = await supabase
        .from("provider_category_routes_org_override")
        .delete()
        .eq("id", routeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ruta eliminada");
      queryClient.invalidateQueries({ queryKey: ["org-override-routes", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["effective-routing", organizationId] });
    },
  });

  const resetAllMutation = useMutation({
    mutationFn: async () => {
      const { error: routesErr } = await supabase
        .from("provider_category_routes_org_override")
        .delete()
        .eq("organization_id", organizationId);
      if (routesErr) throw routesErr;
      const { error: policiesErr } = await supabase
        .from("provider_category_policies_org_override")
        .delete()
        .eq("organization_id", organizationId);
      if (policiesErr) throw policiesErr;
    },
    onSuccess: () => {
      toast.success("Override eliminado — usando defaults globales");
      queryClient.invalidateQueries({ queryKey: ["org-override-routes", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["effective-routing", organizationId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const routes = orgRoutes || [];
  const hasOverrides = routes.length > 0;
  const resolutions = effectiveData?.resolutions || [];

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-400" />
            Routing Override (Organización)
          </CardTitle>
          <CardDescription>
            Override de rutas para esta organización. Tiene precedencia sobre la configuración global.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={hasOverrides
            ? "text-blue-400 border-blue-500/50 bg-blue-500/10"
            : "text-slate-400 border-slate-600"
          }>
            {hasOverrides ? `${routes.length} override(s)` : "Usando global"}
          </Badge>
          {hasOverrides && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-300">
                  <RotateCcw className="h-3 w-3 mr-1" /> Reset
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Resetear a defaults globales?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esto eliminará todos los overrides de routing y política de esta organización. Se volverán a usar las configuraciones globales.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => resetAllMutation.mutate()}>
                    Resetear
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Warning banner */}
        <div className="flex items-start gap-2 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg text-xs text-blue-300">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>Este override solo afecta a tu organización. Las demás organizaciones seguirán usando la configuración global.</span>
        </div>

        {/* Effective routing preview */}
        {resolutions.length > 0 && (
          <div className="space-y-2">
            <Label className="text-slate-400 text-xs uppercase tracking-wider">Routing Efectivo</Label>
            {SYNC_WORKFLOWS.map((wf) => {
              const actsRes = resolutions.find((r: any) => r.workflow === wf && r.scope === "ACTS");
              const pubsRes = resolutions.find((r: any) => r.workflow === wf && r.scope === "PUBS");
              const wfConfig = WORKFLOW_TYPES[wf];

              const renderChain = (res: any) => {
                if (!res) return <span className="text-slate-500">—</span>;
                const chain = res.chain || [];
                return (
                  <div className="flex items-center gap-1 flex-wrap">
                    <Badge variant="outline" className={`text-[9px] px-1 ${
                      res.routeSource === "ORG_OVERRIDE"
                        ? "text-blue-400 border-blue-500/50 bg-blue-500/10"
                        : res.routeSource === "GLOBAL"
                        ? "text-amber-400 border-amber-500/50 bg-amber-500/10"
                        : "text-slate-400 border-slate-600"
                    }`}>
                      {res.routeSource}
                    </Badge>
                    {chain.filter((c: any) => !c.skip_reason).map((c: any, i: number) => (
                      <span key={i} className="flex items-center gap-0.5">
                        {i > 0 && <ArrowRight className="h-2.5 w-2.5 text-slate-600" />}
                        <span className={c.source === "BUILTIN" ? "text-slate-400" : "text-amber-300 font-mono"}>
                          {c.provider_name}
                        </span>
                      </span>
                    ))}
                  </div>
                );
              };

              return (
                <div key={wf} className="bg-slate-800/30 border border-slate-700 rounded px-3 py-2 text-xs">
                  <span className="text-slate-200 font-medium">{wfConfig.shortLabel}</span>
                  <div className="mt-1 space-y-0.5">
                    <div className="flex items-center gap-1"><span className="text-slate-500 w-10">ACTS:</span>{renderChain(actsRes)}</div>
                    <div className="flex items-center gap-1"><span className="text-slate-500 w-10">PUBS:</span>{renderChain(pubsRes)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Existing override routes */}
        {routes.length > 0 && (
          <div className="space-y-1">
            <Label className="text-slate-400 text-xs uppercase tracking-wider">Override Routes</Label>
            {routes.map((route) => (
              <div
                key={route.id}
                className={`flex items-center justify-between rounded px-2 py-1.5 text-sm ${
                  route.enabled ? "bg-slate-800/50" : "bg-slate-800/20 opacity-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-xs ${
                    route.route_kind === "PRIMARY"
                      ? "text-emerald-400 border-emerald-500/50 bg-emerald-500/10"
                      : "text-amber-400 border-amber-500/50 bg-amber-500/10"
                  }`}>
                    {route.route_kind}
                  </Badge>
                  <Badge variant="outline" className="text-xs text-slate-400 border-slate-600">
                    {route.workflow}/{route.scope}
                  </Badge>
                  <span className="text-slate-300 font-mono text-xs">P{route.priority}</span>
                  <span className="text-slate-200">{route.provider_connectors?.name || "?"}</span>
                  {route.is_authoritative && (
                    <Badge variant="outline" className="text-[10px] text-violet-400 border-violet-500/50 bg-violet-500/10">
                      👑 AUTH
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm" variant="ghost" className="h-6 w-6 p-0"
                  onClick={() => deleteRouteMutation.mutate(route.id)}
                >
                  <Trash2 className="h-3 w-3 text-red-400" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add route form */}
        <div className="border border-dashed border-slate-700 rounded-lg p-3 space-y-3">
          <Label className="text-slate-300 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Agregar Override Route
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
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.visibility === "ORG_PRIVATE" ? " 🔒" : " 🌐"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Input
                type="number" min={0}
                value={addingPriority}
                onChange={(e) => setAddingPriority(Number(e.target.value))}
                placeholder="P"
                className="bg-slate-800 border-slate-600 w-16"
              />
              <Button
                onClick={() => addRouteMutation.mutate()}
                disabled={addRouteMutation.isPending || !addingWorkflow || !addingConnectorId}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {addRouteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
