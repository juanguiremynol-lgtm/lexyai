/**
 * HearingAIInsights — AI insights panel for a hearing, gated by authorization
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Brain, Loader2, AlertTriangle, ChevronDown, ChevronRight, Search, HelpCircle, Lightbulb, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  hearingId: string;
  organizationId: string;
  hasContent: boolean; // Whether there's enough notes/decisions to analyze
}

interface AIInsight {
  id: string;
  gaps_to_verify: Array<{ text: string; confidence: string; source: string }>;
  points_of_interest: Array<{ text: string; confidence: string; relevance: string }>;
  follow_up_questions: Array<{ question: string; rationale: string }>;
  suggested_prompt_template: string;
  created_at: string;
  model_id: string;
}

export function HearingAIInsights({ hearingId, organizationId, hasContent }: Props) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Check tenant + user AI config
  const { data: aiEnabled } = useQuery({
    queryKey: ["hearing-ai-enabled", organizationId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { tenantEnabled: false, userEnabled: false };

      const [tenantRes, userRes] = await Promise.all([
        supabase.from("hearing_tenant_config").select("ai_insights_enabled").eq("organization_id", organizationId).maybeSingle(),
        supabase.from("hearing_user_ai_prefs").select("ai_enabled").eq("user_id", user.id).eq("organization_id", organizationId).maybeSingle(),
      ]);

      return {
        tenantEnabled: tenantRes.data?.ai_insights_enabled ?? false,
        userEnabled: userRes.data?.ai_enabled ?? false,
      };
    },
  });

  // Load existing insights
  const { data: insights = [], isLoading } = useQuery({
    queryKey: ["hearing-ai-insights", hearingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hearing_ai_insights")
        .select("*")
        .eq("work_item_hearing_id", hearingId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as AIInsight[];
    },
    enabled: expanded,
  });

  const handleEnableUserAI = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("hearing_user_ai_prefs").upsert({
      user_id: user.id,
      organization_id: organizationId,
      ai_enabled: true,
    }, { onConflict: "user_id,organization_id" });

    if (error) toast.error(error.message);
    else {
      toast.success("IA habilitada para audiencias");
      queryClient.invalidateQueries({ queryKey: ["hearing-ai-enabled"] });
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("hearing-ai-insights", {
        body: { hearing_id: hearingId, organization_id: organizationId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success("Análisis generado");
      queryClient.invalidateQueries({ queryKey: ["hearing-ai-insights", hearingId] });
    } catch (e: any) {
      toast.error(e.message || "Error al generar análisis");
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (insightId: string) => {
    const { error } = await supabase
      .from("hearing_ai_insights")
      .update({ is_deleted: true })
      .eq("id", insightId);

    if (error) toast.error(error.message);
    else {
      toast.success("Análisis eliminado");
      queryClient.invalidateQueries({ queryKey: ["hearing-ai-insights", hearingId] });
    }
  };

  const confidenceBadge = (c: string) => {
    const colors: Record<string, string> = {
      alta: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
      media: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
      baja: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    };
    return <Badge className={`text-[10px] ${colors[c] || ""}`}>{c}</Badge>;
  };

  return (
    <Card>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-accent/30 transition-colors">
            <CardTitle className="text-sm flex items-center gap-2">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Brain className="h-4 w-4 text-primary" />
              AI Insights (Atenia AI)
              <Badge variant="outline" className="text-[10px] ml-auto">Opcional</Badge>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Disclaimer */}
            <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-800 dark:text-amber-300">
                La IA es orientativa. Verifique toda la información. No constituye asesoría legal.
              </AlertDescription>
            </Alert>

            {/* Gate: Tenant not enabled */}
            {!aiEnabled?.tenantEnabled && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Los insights de IA no están habilitados para esta organización. Un administrador puede activarlos en la configuración.
              </p>
            )}

            {/* Gate: User not opted in */}
            {aiEnabled?.tenantEnabled && !aiEnabled?.userEnabled && (
              <div className="text-center py-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Habilita Atenia AI para obtener análisis de tus audiencias.
                </p>
                <Button variant="outline" size="sm" onClick={handleEnableUserAI}>
                  <Brain className="h-4 w-4 mr-1" /> Activar Atenia AI
                </Button>
              </div>
            )}

            {/* Enabled: Show generate + results */}
            {aiEnabled?.tenantEnabled && aiEnabled?.userEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <Button
                    onClick={handleGenerate}
                    disabled={generating || !hasContent}
                    size="sm"
                  >
                    {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Brain className="h-4 w-4 mr-1" />}
                    {generating ? "Analizando..." : "Generar análisis"}
                  </Button>
                  {!hasContent && (
                    <span className="text-xs text-muted-foreground">Agrega notas o decisiones primero</span>
                  )}
                </div>

                {isLoading ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">Cargando...</div>
                ) : insights.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    Sin análisis previos para esta audiencia.
                  </p>
                ) : (
                  insights.map((insight) => (
                    <div key={insight.id} className="space-y-3 p-3 rounded-lg border bg-muted/20">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {new Date(insight.created_at).toLocaleString("es-CO")} — {insight.model_id}
                        </span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(insight.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>

                      {/* Gaps */}
                      {insight.gaps_to_verify.length > 0 && (
                        <div>
                          <h4 className="text-xs font-medium flex items-center gap-1 mb-1">
                            <Search className="h-3.5 w-3.5" /> Vacíos por verificar
                          </h4>
                          <ul className="space-y-1">
                            {insight.gaps_to_verify.map((g, i) => (
                              <li key={i} className="text-xs flex items-start gap-2">
                                {confidenceBadge(g.confidence)}
                                <span>{g.text}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Points of interest */}
                      {insight.points_of_interest.length > 0 && (
                        <div>
                          <h4 className="text-xs font-medium flex items-center gap-1 mb-1">
                            <Lightbulb className="h-3.5 w-3.5" /> Puntos de interés
                          </h4>
                          <ul className="space-y-1">
                            {insight.points_of_interest.map((p, i) => (
                              <li key={i} className="text-xs flex items-start gap-2">
                                {confidenceBadge(p.confidence)}
                                <span>{p.text}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Follow-up questions */}
                      {insight.follow_up_questions.length > 0 && (
                        <div>
                          <h4 className="text-xs font-medium flex items-center gap-1 mb-1">
                            <HelpCircle className="h-3.5 w-3.5" /> Preguntas de seguimiento
                          </h4>
                          <ul className="space-y-1">
                            {insight.follow_up_questions.map((q, i) => (
                              <li key={i} className="text-xs">
                                <strong>Q:</strong> {q.question}
                                {q.rationale && <span className="text-muted-foreground ml-1">— {q.rationale}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Prompt template */}
                      {insight.suggested_prompt_template && (
                        <div>
                          <h4 className="text-xs font-medium mb-1">Plantilla de prompt sugerida</h4>
                          <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">{insight.suggested_prompt_template}</pre>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
