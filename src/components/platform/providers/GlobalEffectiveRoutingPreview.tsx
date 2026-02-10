/**
 * GlobalEffectiveRoutingPreview — Shows resolved provider chain per workflow/scope
 * from GLOBAL routes. Shows connector names and org coverage counts.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, ArrowRight, CheckCircle2, AlertTriangle, Merge, Globe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";

const SYNC_WORKFLOWS: WorkflowType[] = ["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"];

const BUILTIN_CHAIN: Record<string, { acts: string[]; pubs: string[] }> = {
  CGP: { acts: ["CPNU"], pubs: ["Publicaciones API"] },
  LABORAL: { acts: ["CPNU"], pubs: ["Publicaciones API"] },
  CPACA: { acts: ["SAMAI"], pubs: ["Publicaciones API"] },
  TUTELA: { acts: ["CPNU", "TUTELAS API"], pubs: [] },
  PENAL_906: { acts: ["CPNU", "SAMAI"], pubs: ["Publicaciones API"] },
};

interface GlobalRouteRow {
  id: string;
  workflow: string;
  scope: string;
  route_kind: string;
  priority: number;
  enabled: boolean;
  is_authoritative: boolean;
  provider_connectors: { id: string; name: string; key: string; is_enabled: boolean } | null;
}

interface GlobalPolicyRow {
  workflow: string;
  scope: string;
  strategy: string;
  merge_mode: string;
  merge_budget_max_providers: number;
}

function resolveChain(workflow: string, scope: "ACTS" | "PUBS", routes: GlobalRouteRow[]): string[] {
  const chain: string[] = [];
  const builtin = BUILTIN_CHAIN[workflow] || { acts: ["CPNU"], pubs: [] };

  const primary = routes
    .filter((r) => r.workflow === workflow && r.route_kind === "PRIMARY" && r.enabled && (r.scope === scope || r.scope === "BOTH"))
    .sort((a, b) => a.priority - b.priority);

  for (const r of primary) {
    const auth = r.is_authoritative ? "👑 " : "⚡ ";
    chain.push(`${auth}${r.provider_connectors?.name || "?"}`);
  }

  const builtinList = scope === "ACTS" ? builtin.acts : builtin.pubs;
  for (const b of builtinList) chain.push(b);

  const fallback = routes
    .filter((r) => r.workflow === workflow && r.route_kind === "FALLBACK" && r.enabled && (r.scope === scope || r.scope === "BOTH"))
    .sort((a, b) => a.priority - b.priority);

  for (const r of fallback) chain.push(`🔄 ${r.provider_connectors?.name || "?"}`);

  return chain;
}

export function GlobalEffectiveRoutingPreview() {
  const { data: globalData } = useQuery({
    queryKey: ["global-routes"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("provider-list-global-routes", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { routes: GlobalRouteRow[]; policies: GlobalPolicyRow[]; coverage: Record<string, number> };
    },
  });

  const routes = (globalData?.routes || []) as GlobalRouteRow[];
  const policies = (globalData?.policies || []) as GlobalPolicyRow[];
  const coverage = globalData?.coverage || {};
  const hasAnyRoutes = routes.length > 0;

  const getPolicy = (wf: string, scope: string): GlobalPolicyRow | undefined => {
    return policies.find((p) => p.workflow === wf && (p.scope === scope || p.scope === "BOTH"));
  };

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Globe className="h-5 w-5 text-amber-400" />
          <GitBranch className="h-5 w-5 text-amber-400" />
          Routing Efectivo Global
        </CardTitle>
        <CardDescription>
          Orden de resolución platform-wide. ⚡ = ext PRIMARY, 🔄 = ext FALLBACK, 👑 = autoritativo
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
            const hasMerge = actsPolicy?.strategy === "MERGE" || pubsPolicy?.strategy === "MERGE" || bothPolicy?.strategy === "MERGE";

            return (
              <div key={wf} className="bg-slate-800/30 border border-slate-700 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-slate-200">{wfConfig.shortLabel}</span>
                  {wfRoutes.length > 0 ? (
                    <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/50 bg-emerald-500/10">
                      <CheckCircle2 className="h-3 w-3 mr-1" />{wfRoutes.length} ruta(s)
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-slate-400 border-slate-600">Solo built-in</Badge>
                  )}
                  {hasMerge && (
                    <Badge variant="outline" className="text-xs text-violet-400 border-violet-500/50 bg-violet-500/10">
                      <Merge className="h-3 w-3 mr-1" />MERGE
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1 text-xs mb-1 flex-wrap">
                  <span className="text-slate-500 w-12">ACTS:</span>
                  {(actsPolicy || bothPolicy)?.strategy === "MERGE" && (
                    <span className="text-violet-300 font-mono">MERGE ({(actsPolicy || bothPolicy)?.merge_mode}):</span>
                  )}
                  {actsChain.map((step, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && ((actsPolicy || bothPolicy)?.strategy === "MERGE"
                        ? <span className="text-violet-500">+</span>
                        : <ArrowRight className="h-3 w-3 text-slate-600" />
                      )}
                      <span className={step.startsWith("⚡") || step.startsWith("🔄") || step.startsWith("👑") ? "text-amber-300 font-mono" : "text-slate-400"}>
                        {step}
                      </span>
                    </span>
                  ))}
                  {actsChain.length === 0 && <span className="text-slate-500">—</span>}
                </div>

                <div className="flex items-center gap-1 text-xs flex-wrap">
                  <span className="text-slate-500 w-12">PUBS:</span>
                  {(pubsPolicy || bothPolicy)?.strategy === "MERGE" && (
                    <span className="text-violet-300 font-mono">MERGE ({(pubsPolicy || bothPolicy)?.merge_mode}):</span>
                  )}
                  {pubsChain.map((step, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && ((pubsPolicy || bothPolicy)?.strategy === "MERGE"
                        ? <span className="text-violet-500">+</span>
                        : <ArrowRight className="h-3 w-3 text-slate-600" />
                      )}
                      <span className={step.startsWith("⚡") || step.startsWith("🔄") || step.startsWith("👑") ? "text-amber-300 font-mono" : "text-slate-400"}>
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
            Sin rutas globales. Todos los workflows usan proveedores built-in.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
