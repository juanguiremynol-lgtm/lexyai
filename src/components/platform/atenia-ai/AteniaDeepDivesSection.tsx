/**
 * AteniaDeepDivesSection — Deep Dives panel for the Supervisor Panel.
 * Shows recent deep dive investigations with collapsible step timelines.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Search, ChevronDown, Sparkles, Wrench } from "lucide-react";

interface DeepDiveRow {
  id: string;
  radicado: string;
  trigger_criteria: string;
  severity: string;
  status: string;
  diagnosis: string;
  root_cause: string | null;
  steps: Array<{ name: string; ok: boolean; latency_ms?: number; findings?: any }>;
  recommended_actions: Array<{ action_type: string; description: string; auto_executable: boolean }>;
  remediation_applied: boolean;
  gemini_analysis: string | null;
  duration_ms: number | null;
  created_at: string;
}

export function AteniaDeepDivesSection() {
  const { data: dives, isLoading } = useQuery({
    queryKey: ["atenia-deep-dives-recent"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("atenia_deep_dives") as any)
        .select("id, radicado, trigger_criteria, severity, status, diagnosis, root_cause, steps, recommended_actions, remediation_applied, gemini_analysis, duration_ms, created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) {
        console.warn("[DeepDives] Error:", error.message);
        return [];
      }
      return (data ?? []) as DeepDiveRow[];
    },
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 2,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-5 w-5" />
          Deep Dives Recientes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : !dives || dives.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin deep dives recientes. ✅</p>
        ) : (
          <div className="space-y-3">
            {dives.map((dive) => (
              <Collapsible key={dive.id}>
                <div className="flex items-center justify-between py-2 border-b">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        dive.severity === "CRITICAL" ? "destructive" :
                        dive.severity === "HIGH" ? "secondary" :
                        "outline"
                      }
                    >
                      {dive.severity}
                    </Badge>
                    <span className="text-sm font-mono">{dive.radicado}</span>
                    <span className="text-xs text-muted-foreground">{dive.trigger_criteria}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{dive.status}</Badge>
                    {dive.gemini_analysis && <Sparkles className="h-3 w-3 text-purple-500" />}
                    {dive.remediation_applied && <Wrench className="h-3 w-3 text-blue-500" />}
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </div>
                <CollapsibleContent className="py-3 space-y-2 text-sm">
                  <p><strong>Diagnóstico:</strong> {dive.diagnosis}</p>
                  {dive.root_cause && dive.root_cause !== "UNDETERMINED" && (
                    <p><strong>Causa raíz:</strong> {dive.root_cause}</p>
                  )}

                  {/* Steps timeline */}
                  <div className="space-y-1 pl-4 border-l-2 border-muted">
                    {(dive.steps ?? []).map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span>{step.ok ? "✅" : "❌"}</span>
                        <span className="font-mono">{step.name}</span>
                        {step.latency_ms != null && (
                          <span className="text-muted-foreground">{step.latency_ms}ms</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {dive.gemini_analysis && (
                    <div className="mt-2 p-3 bg-purple-50 dark:bg-purple-950/30 rounded-md text-sm">
                      <p className="font-medium text-purple-800 dark:text-purple-300 mb-1">🤖 Análisis Gemini</p>
                      <p className="text-purple-700 dark:text-purple-400 whitespace-pre-wrap">{dive.gemini_analysis}</p>
                    </div>
                  )}

                  {(dive.recommended_actions ?? []).length > 0 && (
                    <div className="mt-2">
                      <p className="font-medium text-sm">Acciones recomendadas:</p>
                      {dive.recommended_actions.map((action, i) => (
                        <div key={i} className="text-xs text-muted-foreground ml-2">
                          • {action.description}
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Duración: {dive.duration_ms}ms · {new Date(dive.created_at).toLocaleString("es-CO")}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
