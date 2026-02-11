/**
 * GlobalCoveragePanel — Shows per-connector instance coverage across orgs
 * and merge conflict summary (platform-wide view).
 * Includes warning banner when GLOBAL routes lack a PLATFORM instance.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Globe, Layers, CheckCircle2, AlertTriangle, Server } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

export function GlobalCoveragePanel() {
  const navigate = useNavigate();
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
        platform_instances?: Record<string, boolean>;
      };
    },
  });

  const routes = globalData?.routes || [];
  const platformInstances = globalData?.platform_instances || {};

  // Deduplicate connectors from routes, collecting affected workflows/scopes
  const connectorMap = new Map<string, { name: string; hasPlatformInstance: boolean; workflows: Set<string>; scopes: Set<string> }>();
  for (const r of routes) {
    const cid = r.provider_connector_id;
    if (!connectorMap.has(cid)) {
      connectorMap.set(cid, {
        name: r.provider_connectors?.name || "?",
        hasPlatformInstance: !!platformInstances[cid],
        workflows: new Set(),
        scopes: new Set(),
      });
    }
    const entry = connectorMap.get(cid)!;
    if (r.workflow) entry.workflows.add(r.workflow);
    if (r.scope) entry.scopes.add(r.scope);
  }

  const connectors = Array.from(connectorMap.entries());
  const missingInstances = connectors.filter(([, info]) => !info.hasPlatformInstance);

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
              Para cada conector con ruta global, estado de la instancia de plataforma
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Warning banner for missing PLATFORM instances */}
        {missingInstances.length > 0 && (
          <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="text-xs text-foreground/80 space-y-2">
              <p className="font-semibold text-destructive">⚠️ Proveedores configurados pero NO activos</p>
              <p>
                Las siguientes rutas GLOBALES están configuradas pero <strong>no tienen instancia de plataforma activa</strong>.
                El proveedor NO se ejecutará para ninguna organización hasta que se cree una instancia de plataforma.
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                {missingInstances.map(([cid, info]) => (
                  <li key={cid}>
                    <strong className="text-foreground">{info.name}</strong>{" "}
                    <span className="font-mono text-[10px]">({cid.slice(0, 8)})</span>
                    {" — "}
                    <span>Workflows: {Array.from(info.workflows).join(", ") || "—"}</span>
                    {" · "}
                    <span>Scopes: {Array.from(info.scopes).join(", ") || "—"}</span>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="destructive"
                className="mt-1 gap-1"
                onClick={() => navigate("/platform/external-providers/wizard")}
              >
                <Server className="h-3 w-3" /> Crear instancia de plataforma
              </Button>
            </div>
          </div>
        )}

        {connectors.length > 0 ? (
          <div className="space-y-2">
            {connectors.map(([cid, info]) => (
              <div key={cid} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                <div className="flex items-center gap-2">
                  <span className="text-slate-200 font-medium">{info.name}</span>
                  <span className="text-xs text-slate-500 font-mono">{cid.slice(0, 8)}</span>
                </div>
                {info.hasPlatformInstance ? (
                  <Badge
                    variant="outline"
                    className="text-emerald-400 border-emerald-500/50 bg-emerald-500/10"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />100% orgs (plataforma)
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-destructive border-destructive/50 bg-destructive/10"
                  >
                    <AlertTriangle className="h-3 w-3 mr-1" />Sin instancia de plataforma
                  </Badge>
                )}
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