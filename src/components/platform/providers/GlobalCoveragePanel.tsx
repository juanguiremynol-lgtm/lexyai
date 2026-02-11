/**
 * GlobalCoveragePanel — Shows per-connector instance coverage across orgs
 * and merge conflict summary (platform-wide view).
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Layers, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export function GlobalCoveragePanel() {
  const { data: globalData } = useQuery({
    queryKey: ["global-routes"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("provider-list-global-routes", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as {
        routes: any[];
        policies: any[];
        coverage: Record<string, number>;
      };
    },
  });

  const routes = globalData?.routes || [];
  const coverage = globalData?.coverage || {};

  // Deduplicate connectors from routes
  const connectorMap = new Map<string, { name: string; orgCount: number }>();
  for (const r of routes) {
    const cid = r.provider_connector_id;
    if (!connectorMap.has(cid)) {
      connectorMap.set(cid, {
        name: r.provider_connectors?.name || "?",
        orgCount: coverage[cid] || 0,
      });
    }
  }

  const connectors = Array.from(connectorMap.entries());

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="h-5 w-5 text-cyan-400" />
              <Layers className="h-5 w-5 text-cyan-400" />
              H) Cobertura de Instancias
            </CardTitle>
            <CardDescription>
              Para cada conector en las rutas globales, cuántas orgs tienen una instancia habilitada
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {connectors.length > 0 ? (
          <div className="space-y-2">
            {connectors.map(([cid, info]) => (
              <div key={cid} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                <div className="flex items-center gap-2">
                  <span className="text-slate-200 font-medium">{info.name}</span>
                  <span className="text-xs text-slate-500 font-mono">{cid.slice(0, 8)}</span>
                </div>
                <Badge
                  variant="outline"
                  className="text-emerald-400 border-emerald-500/50 bg-emerald-500/10"
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />100% orgs (plataforma)
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Sin conectores en rutas globales. Configure rutas en el panel E.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
