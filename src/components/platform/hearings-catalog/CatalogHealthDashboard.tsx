/**
 * CatalogHealthDashboard — Platform-level health overview for hearings catalog
 * Shows: coverage per jurisdiction, unused types, orgs with no flows, statistics
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity, BookOpen, AlertTriangle, CheckCircle2, BarChart3,
  ListOrdered, Building2, Scale,
} from "lucide-react";
import { JURISDICTION_LABELS, JURISDICTIONS } from "@/hooks/use-hearing-catalog";

interface JurisdictionHealth {
  jurisdiction: string;
  typeCount: number;
  mandatoryCount: number;
  flowCount: number;
  defaultFlowExists: boolean;
  avgSteps: number;
}

interface CatalogStats {
  totalTypes: number;
  totalFlows: number;
  totalHearingsCreated: number;
  jurisdictionHealth: JurisdictionHealth[];
  unusedTypes: { id: string; name: string; jurisdiction: string }[];
  typesNeedingReview: { id: string; name: string; jurisdiction: string }[];
}

export function CatalogHealthDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["catalog-health-dashboard"],
    queryFn: async (): Promise<CatalogStats> => {
      // Fetch all types
      const { data: types = [] } = await supabase
        .from("hearing_types")
        .select("id, name, short_name, jurisdiction, is_mandatory, is_active, needs_admin_review");

      // Fetch all flows
      const { data: flows = [] } = await supabase
        .from("hearing_flow_templates")
        .select("id, jurisdiction, is_default, is_active");

      // Fetch flow steps for avg calculation
      const { data: steps = [] } = await supabase
        .from("hearing_flow_template_steps")
        .select("flow_template_id, hearing_type_id");

      // Fetch hearing usage counts per type
      const { data: hearings = [] } = await (supabase
        .from("work_item_hearings") as any)
        .select("hearing_type_id")
        .not("hearing_type_id", "is", null);

      const usedTypeIds = new Set((hearings || []).map((h: any) => h.hearing_type_id));
      const stepsByFlow = new Map<string, number>();
      const usedInSteps = new Set<string>();

      (steps || []).forEach((s: any) => {
        stepsByFlow.set(s.flow_template_id, (stepsByFlow.get(s.flow_template_id) || 0) + 1);
        usedInSteps.add(s.hearing_type_id);
      });

      // Build jurisdiction health
      const jurisdictionHealth: JurisdictionHealth[] = JURISDICTIONS.map((j) => {
        const jTypes = (types || []).filter((t: any) => t.jurisdiction === j && t.is_active);
        const jFlows = (flows || []).filter((f: any) => f.jurisdiction === j && f.is_active);
        const defaultExists = jFlows.some((f: any) => f.is_default);

        const flowStepCounts = jFlows.map((f: any) => stepsByFlow.get(f.id) || 0);
        const avgSteps = flowStepCounts.length > 0
          ? Math.round(flowStepCounts.reduce((a: number, b: number) => a + b, 0) / flowStepCounts.length)
          : 0;

        return {
          jurisdiction: j,
          typeCount: jTypes.length,
          mandatoryCount: jTypes.filter((t: any) => t.is_mandatory).length,
          flowCount: jFlows.length,
          defaultFlowExists: defaultExists,
          avgSteps,
        };
      });

      // Unused types (active, not in any flow step, not used by any hearing)
      const activeTypes = (types || []).filter((t: any) => t.is_active);
      const unusedTypes = activeTypes
        .filter((t: any) => !usedTypeIds.has(t.id) && !usedInSteps.has(t.id))
        .map((t: any) => ({ id: t.id, name: t.short_name || t.name, jurisdiction: t.jurisdiction }));

      // Types needing review
      const typesNeedingReview = (types || [])
        .filter((t: any) => t.needs_admin_review)
        .map((t: any) => ({ id: t.id, name: t.short_name || t.name, jurisdiction: t.jurisdiction }));

      return {
        totalTypes: activeTypes.length,
        totalFlows: (flows || []).filter((f: any) => f.is_active).length,
        totalHearingsCreated: (hearings || []).length,
        jurisdictionHealth,
        unusedTypes,
        typesNeedingReview,
      };
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="text-sm text-white/40 text-center py-12">
        Cargando estado del catálogo...
      </div>
    );
  }

  if (!stats) return null;

  const overallScore = Math.round(
    (stats.jurisdictionHealth.filter((j) => j.defaultFlowExists && j.typeCount > 0).length /
      Math.max(stats.jurisdictionHealth.length, 1)) * 100
  );

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <BookOpen className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.totalTypes}</p>
                <p className="text-xs text-white/50">Tipos activos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <ListOrdered className="h-8 w-8 text-blue-400" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.totalFlows}</p>
                <p className="text-xs text-white/50">Flujos activos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Scale className="h-8 w-8 text-emerald-400" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.totalHearingsCreated}</p>
                <p className="text-xs text-white/50">Audiencias creadas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Activity className="h-8 w-8 text-amber-400" />
              <div>
                <p className="text-2xl font-bold text-white">{overallScore}%</p>
                <p className="text-xs text-white/50">Cobertura</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jurisdiction Breakdown */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Salud por jurisdicción
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {stats.jurisdictionHealth.map((jh) => {
              const completeness = jh.typeCount > 0 && jh.defaultFlowExists ? 100 :
                jh.typeCount > 0 ? 60 : 0;

              return (
                <div key={jh.jurisdiction} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">
                        {JURISDICTION_LABELS[jh.jurisdiction] || jh.jurisdiction}
                      </span>
                      {jh.defaultFlowExists ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-white/50">
                      <span>{jh.typeCount} tipos</span>
                      <span>{jh.mandatoryCount} oblig.</span>
                      <span>{jh.flowCount} flujos</span>
                      <span>~{jh.avgSteps} pasos</span>
                    </div>
                  </div>
                  <Progress value={completeness} className="h-1.5" />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {/* Unused Types */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Tipos sin uso ({stats.unusedTypes.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.unusedTypes.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-4">
                Todos los tipos están en uso o asignados a flujos.
              </p>
            ) : (
              <ScrollArea className="max-h-48">
                <div className="space-y-1.5">
                  {stats.unusedTypes.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-xs">
                      <span className="text-white/70">{t.name}</span>
                      <Badge variant="outline" className="text-[10px] border-white/10 text-white/40">
                        {t.jurisdiction}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Needs Review */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-400" />
              Pendientes de revisión ({stats.typesNeedingReview.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.typesNeedingReview.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-4">
                No hay tipos marcados para revisión.
              </p>
            ) : (
              <ScrollArea className="max-h-48">
                <div className="space-y-1.5">
                  {stats.typesNeedingReview.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-xs">
                      <span className="text-white/70">{t.name}</span>
                      <Badge variant="outline" className="text-[10px] border-amber-500/20 text-amber-400">
                        Revisión
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
