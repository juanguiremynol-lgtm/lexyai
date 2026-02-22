/**
 * HearingDiagnosticsPanel — Troubleshooting tools for hearing data
 * Checks: flow generation status, missing types, orphan artifacts, data integrity
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Stethoscope, CheckCircle2, AlertTriangle, XCircle, ChevronDown, RefreshCw } from "lucide-react";

interface Props {
  workItemId: string;
  organizationId: string;
  jurisdiction: string;
}

interface DiagnosticCheck {
  id: string;
  label: string;
  status: "PASS" | "WARN" | "FAIL" | "LOADING";
  detail: string;
}

export function HearingDiagnosticsPanel({ workItemId, organizationId, jurisdiction }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  const { data: checks = [], isLoading, refetch } = useQuery({
    queryKey: ["hearing-diagnostics", workItemId],
    queryFn: async () => {
      const results: DiagnosticCheck[] = [];

      // 1. Check hearings exist
      const { data: hearings, error: hErr } = await supabase
        .from("work_item_hearings")
        .select("id, status, hearing_type_id, scheduled_at, occurred_at, custom_name")
        .eq("work_item_id", workItemId);

      if (hErr) {
        results.push({
          id: "hearings-exist",
          label: "Audiencias cargadas",
          status: "FAIL",
          detail: `Error: ${hErr.message}`,
        });
        return results;
      }

      const hearingCount = hearings?.length || 0;
      results.push({
        id: "hearings-exist",
        label: "Audiencias cargadas",
        status: hearingCount > 0 ? "PASS" : "WARN",
        detail: hearingCount > 0
          ? `${hearingCount} audiencia(s) encontrada(s)`
          : "No hay audiencias. Verifica si el flujo se generó correctamente.",
      });

      // 2. Check flow template exists for jurisdiction
      const { data: templates } = await supabase
        .from("hearing_flow_templates")
        .select("id, name")
        .eq("jurisdiction", jurisdiction)
        .eq("is_active", true)
        .eq("is_default", true)
        .limit(1);

      const hasTemplate = templates && templates.length > 0;
      results.push({
        id: "flow-template",
        label: `Plantilla de flujo (${jurisdiction})`,
        status: hasTemplate ? "PASS" : "WARN",
        detail: hasTemplate
          ? `Plantilla: ${templates[0].name}`
          : `No hay plantilla de flujo por defecto para ${jurisdiction}. Las audiencias deben crearse manualmente.`,
      });

      // 3. Check for orphan hearing_type_ids
      if (hearings && hearings.length > 0) {
        const typeIds = hearings
          .map((h: any) => h.hearing_type_id)
          .filter(Boolean) as string[];

        if (typeIds.length > 0) {
          const { data: types } = await supabase
            .from("hearing_types")
            .select("id")
            .in("id", typeIds);

          const foundIds = new Set((types || []).map((t: any) => t.id));
          const orphanCount = typeIds.filter((id) => !foundIds.has(id)).length;

          results.push({
            id: "orphan-types",
            label: "Tipos de audiencia válidos",
            status: orphanCount === 0 ? "PASS" : "FAIL",
            detail: orphanCount === 0
              ? "Todos los tipos de audiencia referenciados existen en el catálogo"
              : `${orphanCount} audiencia(s) referencian tipos eliminados del catálogo`,
          });
        }
      }

      // 4. Check for hearings without dates
      if (hearings && hearings.length > 0) {
        const noDate = hearings.filter(
          (h: any) => !h.scheduled_at && !h.occurred_at
        ).length;

        results.push({
          id: "missing-dates",
          label: "Fechas asignadas",
          status: noDate === 0 ? "PASS" : "WARN",
          detail: noDate === 0
            ? "Todas las audiencias tienen al menos una fecha"
            : `${noDate} audiencia(s) sin fecha programada ni de celebración`,
        });
      }

      // 5. Check artifacts storage
      const { data: artifacts, error: aErr } = await (supabase
        .from("hearing_artifacts") as any)
        .select("id, storage_path")
        .eq("organization_id", organizationId)
        .in("hearing_id", (hearings || []).map((h: any) => h.id));

      if (!aErr && artifacts && artifacts.length > 0) {
        results.push({
          id: "artifacts-count",
          label: "Archivos adjuntos",
          status: "PASS",
          detail: `${artifacts.length} archivo(s) vinculados a audiencias`,
        });
      }

      // 6. Status distribution
      if (hearings && hearings.length > 0) {
        const statusCounts: Record<string, number> = {};
        hearings.forEach((h: any) => {
          statusCounts[h.status] = (statusCounts[h.status] || 0) + 1;
        });

        const statusSummary = Object.entries(statusCounts)
          .map(([s, c]) => `${s}: ${c}`)
          .join(", ");

        results.push({
          id: "status-distribution",
          label: "Distribución de estados",
          status: "PASS",
          detail: statusSummary,
        });
      }

      return results;
    },
    enabled: isOpen,
  });

  const statusIcon = (s: string) => {
    switch (s) {
      case "PASS": return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
      case "WARN": return <AlertTriangle className="h-4 w-4 text-amber-400" />;
      case "FAIL": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />;
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Stethoscope className="h-4 w-4" />
                Diagnóstico de audiencias
              </CardTitle>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                Ejecutando verificaciones...
              </div>
            ) : (
              <div className="space-y-2">
                {checks.map((check) => (
                  <div key={check.id} className="flex items-start gap-3 py-2 border-b last:border-0">
                    {statusIcon(check.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{check.label}</p>
                      <p className="text-xs text-muted-foreground">{check.detail}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${
                        check.status === "PASS" ? "border-emerald-500/30 text-emerald-400" :
                        check.status === "WARN" ? "border-amber-500/30 text-amber-400" :
                        "border-destructive/30 text-destructive"
                      }`}
                    >
                      {check.status}
                    </Badge>
                  </div>
                ))}

                <div className="pt-2">
                  <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-xs">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Re-ejecutar
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
