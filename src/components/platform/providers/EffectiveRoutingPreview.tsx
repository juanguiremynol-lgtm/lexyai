/**
 * EffectiveRoutingPreview — Shows resolved provider chain per workflow/scope,
 * including built-in defaults, configured external routes, and merge strategy.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, ArrowRight, CheckCircle2, AlertTriangle, Merge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";

const SYNC_WORKFLOWS: WorkflowType[] = ["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"];

// Built-in provider order per workflow (matches getProviderOrder in sync-by-work-item)
const BUILTIN_CHAIN: Record<string, { acts: string[]; pubs: string[] }> = {
  CGP: { acts: ["CPNU"], pubs: ["Publicaciones API"] },
  LABORAL: { acts: ["CPNU"], pubs: ["Publicaciones API"] },
  CPACA: { acts: ["SAMAI"], pubs: ["Publicaciones API"] },
  TUTELA: { acts: ["CPNU", "TUTELAS API"], pubs: [] },
  PENAL_906: { acts: ["CPNU", "SAMAI"], pubs: ["Publicaciones API"] },
};

interface RouteRow {
  id: string;
  workflow: string;
  scope: string;
  route_kind: string;
  priority: number;
  enabled: boolean;
  is_authoritative?: boolean;
  provider_instances: { id: string; name: string; is_enabled: boolean } | null;
}

interface PolicyRow {
  workflow: string;
  scope: string;
  strategy: string;
  merge_mode: string;
  merge_budget_max_providers: number;
}

interface EffectiveRoutingPreviewProps {
  organizationId: string | null;
}

function resolveChain(workflow: string, scope: "ACTS" | "PUBS", routes: RouteRow[]): string[] {
  const chain: string[] = [];
  const builtin = BUILTIN_CHAIN[workflow] || { acts: ["CPNU"], pubs: [] };

  const primary = routes
    .filter((r) =>
      r.workflow === workflow &&
      r.route_kind === "PRIMARY" &&
      r.enabled &&
      (r.scope === scope || r.scope === "BOTH")
    )
    .sort((a, b) => a.priority - b.priority);

  for (const r of primary) {
    const auth = r.is_authoritative ? "👑 " : "⚡ ";
    chain.push(`${auth}${r.provider_instances?.name || "?"}`);
  }

  const builtinList = scope === "ACTS" ? builtin.acts : builtin.pubs;
  for (const b of builtinList) {
    chain.push(b);
  }

  const fallback = routes
    .filter((r) =>
      r.workflow === workflow &&
      r.route_kind === "FALLBACK" &&
      r.enabled &&
      (r.scope === scope || r.scope === "BOTH")
    )
    .sort((a, b) => a.priority - b.priority);

  for (const r of fallback) {
    chain.push(`🔄 ${r.provider_instances?.name || "?"}`);
  }

  return chain;
}

export function EffectiveRoutingPreview({ organizationId }: EffectiveRoutingPreviewProps) {
  const { data: routesData } = useQuery({
    queryKey: ["provider-category-routes", organizationId],
    queryFn: async () => {
      if (!organizationId) return { routes: [] };
      const { data, error } = await supabase.functions.invoke("provider-list-category-routes", {
        body: { organization_id: organizationId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { routes: RouteRow[] };
    },
    enabled: !!organizationId,
  });

  const { data: policies } = useQuery({
    queryKey: ["provider-merge-policies", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("provider_category_policies")
        .select("*")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data || []) as PolicyRow[];
    },
    enabled: !!organizationId,
  });

  const routes = (routesData?.routes || []) as RouteRow[];
  const hasAnyRoutes = routes.length > 0;

  const getPolicy = (wf: string, scope: string): PolicyRow | undefined => {
    return policies?.find((p) => p.workflow === wf && (p.scope === scope || p.scope === "BOTH"));
  };

  if (!organizationId) {
    return (
      <Card className="border-slate-700 bg-slate-900/50 opacity-60">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-amber-400" />
            Routing Efectivo
          </CardTitle>
          <CardDescription>Seleccione una organización</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-amber-400" />
          Routing Efectivo por Workflow
        </CardTitle>
        <CardDescription>
          Orden de resolución. ⚡ = ext PRIMARY, 🔄 = ext FALLBACK, 👑 = autoritativo
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {SYNC_WORKFLOWS.map((wf) => {
            const actsChain = resolveChain(wf, "ACTS", routes);
            const pubsChain = resolveChain(wf, "PUBS", routes);
            const wfConfig = WORKFLOW_TYPES[wf];
            const wfRoutes = routes.filter((r) => r.workflow === wf && r.enabled);
            const actsPolicy = getPolicy(wf, "ACTS");
            const pubsPolicy = getPolicy(wf, "PUBS");
            const bothPolicy = getPolicy(wf, "BOTH");
            const hasMerge = actsPolicy?.strategy === "MERGE" ||
              pubsPolicy?.strategy === "MERGE" ||
              bothPolicy?.strategy === "MERGE";

            return (
              <div key={wf} className="bg-slate-800/30 border border-slate-700 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-slate-200">{wfConfig.shortLabel}</span>
                  {wfRoutes.length > 0 ? (
                    <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/50 bg-emerald-500/10">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {wfRoutes.length} ruta(s) ext.
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-slate-400 border-slate-600">
                      Solo built-in
                    </Badge>
                  )}
                  {hasMerge && (
                    <Badge variant="outline" className="text-xs text-violet-400 border-violet-500/50 bg-violet-500/10">
                      <Merge className="h-3 w-3 mr-1" />
                      MERGE
                    </Badge>
                  )}
                </div>

                {/* Acts chain */}
                <div className="flex items-center gap-1 text-xs mb-1 flex-wrap">
                  <span className="text-slate-500 w-12">ACTS:</span>
                  {(actsPolicy || bothPolicy)?.strategy === "MERGE" ? (
                    <span className="text-violet-300 font-mono">
                      MERGE ({(actsPolicy || bothPolicy)?.merge_mode}) — up to{" "}
                      {(actsPolicy || bothPolicy)?.merge_budget_max_providers} proveedores:
                    </span>
                  ) : null}
                  {actsChain.map((step, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && (
                        (actsPolicy || bothPolicy)?.strategy === "MERGE"
                          ? <span className="text-violet-500">+</span>
                          : <ArrowRight className="h-3 w-3 text-slate-600" />
                      )}
                      <span className={step.startsWith("⚡") || step.startsWith("🔄") || step.startsWith("👑")
                        ? "text-amber-300 font-mono"
                        : "text-slate-400"
                      }>
                        {step}
                      </span>
                    </span>
                  ))}
                  {actsChain.length === 0 && <span className="text-slate-500">—</span>}
                </div>

                {/* Pubs chain */}
                <div className="flex items-center gap-1 text-xs flex-wrap">
                  <span className="text-slate-500 w-12">PUBS:</span>
                  {(pubsPolicy || bothPolicy)?.strategy === "MERGE" ? (
                    <span className="text-violet-300 font-mono">
                      MERGE ({(pubsPolicy || bothPolicy)?.merge_mode}):
                    </span>
                  ) : null}
                  {pubsChain.map((step, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && (
                        (pubsPolicy || bothPolicy)?.strategy === "MERGE"
                          ? <span className="text-violet-500">+</span>
                          : <ArrowRight className="h-3 w-3 text-slate-600" />
                      )}
                      <span className={step.startsWith("⚡") || step.startsWith("🔄") || step.startsWith("👑")
                        ? "text-amber-300 font-mono"
                        : "text-slate-400"
                      }>
                        {step}
                      </span>
                    </span>
                  ))}
                  {pubsChain.length === 0 && <span className="text-slate-500">—</span>}
                </div>
              </div>
            );
          })}
        </div>

        {!hasAnyRoutes && (
          <p className="text-xs text-slate-500 mt-3 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            No hay rutas externas configuradas. Todos los workflows usan proveedores built-in.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
