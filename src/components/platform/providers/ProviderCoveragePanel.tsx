/**
 * ProviderCoveragePanel — Shows provider coverage and merge conflicts summary
 * for a selected provider instance and organization.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Layers, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface ProviderCoveragePanelProps {
  organizationId: string | null;
  instanceId?: string | null;
}

interface ConflictRow {
  id: string;
  work_item_id: string;
  scope: string;
  dedupe_key: string;
  field_name: string;
  primary_value: string | null;
  secondary_value: string | null;
  resolved: boolean;
  created_at: string;
}

export function ProviderCoveragePanel({ organizationId, instanceId }: ProviderCoveragePanelProps) {
  // Load recent merge conflicts
  const { data: conflicts } = useQuery({
    queryKey: ["merge-conflicts", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("provider_merge_conflicts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as ConflictRow[];
    },
    enabled: !!organizationId,
  });

  // Load provenance stats
  const { data: actProvenanceCount } = useQuery({
    queryKey: ["act-provenance-count", instanceId],
    queryFn: async () => {
      if (!instanceId) return 0;
      const { count, error } = await supabase
        .from("act_provenance")
        .select("id", { count: "exact", head: true })
        .eq("provider_instance_id", instanceId);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!instanceId,
  });

  const { data: pubProvenanceCount } = useQuery({
    queryKey: ["pub-provenance-count", instanceId],
    queryFn: async () => {
      if (!instanceId) return 0;
      const { count, error } = await supabase
        .from("pub_provenance")
        .select("id", { count: "exact", head: true })
        .eq("provider_instance_id", instanceId);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!instanceId,
  });

  if (!organizationId) {
    return (
      <Card className="border-slate-700 bg-slate-900/50 opacity-60">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Layers className="h-5 w-5 text-cyan-400" />
            H) Cobertura + Conflictos
          </CardTitle>
          <CardDescription>Seleccione una organización</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const unresolvedCount = conflicts?.length || 0;
  const actsScope = conflicts?.filter((c) => c.scope === "ACTS") || [];
  const pubsScope = conflicts?.filter((c) => c.scope === "PUBS") || [];

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-5 w-5 text-cyan-400" />
              H) Cobertura + Conflictos de Merge
            </CardTitle>
            <CardDescription>
              Resumen de proveniencia multi-proveedor y conflictos detectados
            </CardDescription>
          </div>
          <Badge variant="outline" className={unresolvedCount > 0
            ? "text-amber-400 border-amber-500/50 bg-amber-500/10"
            : "text-emerald-400 border-emerald-500/50 bg-emerald-500/10"
          }>
            {unresolvedCount > 0 ? `${unresolvedCount} conflicto(s)` : "Sin conflictos"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Provenance stats */}
        {instanceId && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
              <p className="text-xs text-slate-400 mb-1">Registros de Proveniencia (Acts)</p>
              <p className="text-2xl font-mono text-cyan-400">{actProvenanceCount ?? 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
              <p className="text-xs text-slate-400 mb-1">Registros de Proveniencia (Pubs)</p>
              <p className="text-2xl font-mono text-cyan-400">{pubProvenanceCount ?? 0}</p>
            </div>
          </div>
        )}

        {/* Conflicts list */}
        {unresolvedCount > 0 ? (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
                <AlertTriangle className="h-3 w-3 text-amber-400" />
                {actsScope.length} en ACTS, {pubsScope.length} en PUBS
              </div>
              {conflicts?.map((c) => (
                <div
                  key={c.id}
                  className="bg-slate-800/30 border border-slate-700 rounded p-2 text-xs"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/50">
                        {c.scope}
                      </Badge>
                      <span className="text-slate-300 font-mono">{c.field_name}</span>
                    </div>
                    <span className="text-slate-500">{new Date(c.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="bg-emerald-900/10 border border-emerald-800/30 rounded px-2 py-1">
                      <span className="text-[10px] text-emerald-500">PRIMARY:</span>
                      <p className="text-slate-300 truncate">{c.primary_value || "—"}</p>
                    </div>
                    <div className="bg-amber-900/10 border border-amber-800/30 rounded px-2 py-1">
                      <span className="text-[10px] text-amber-500">SECONDARY:</span>
                      <p className="text-slate-300 truncate">{c.secondary_value || "—"}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            No hay conflictos sin resolver para esta organización.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
