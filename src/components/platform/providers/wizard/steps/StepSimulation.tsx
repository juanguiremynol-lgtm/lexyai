/**
 * StepSimulation — Simulation Lab for the External Provider Wizard.
 * Allows users to test data flow with sample/fixture payloads without writing to DB.
 * Includes Gemini AI analysis for integration strategy recommendations.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  ArrowRight, Play, Loader2, CheckCircle2, XCircle, AlertTriangle,
  FlaskConical, Database, ArrowDownLeft, Sparkles, Bot, FileJson,
  RefreshCw, Copy, Zap, Route,
} from "lucide-react";
import { toast } from "sonner";
import { useWizardSessionContext } from "../WizardSessionContext";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardConnector, WizardInstance } from "../WizardTypes";

interface StepSimulationProps {
  connector: WizardConnector | null;
  instance: WizardInstance | null;
  onNext: () => void;
}

type SimMode = "FIXTURE" | "SAMPLE_PAYLOAD" | "LIVE_FETCH";
type DataKind = "ACTUACIONES" | "ESTADOS" | "SNAPSHOT";

interface SimStep {
  step: string;
  status: string;
  detail: any;
  duration_ms: number;
}

interface SimResult {
  ok: boolean;
  simulation_mode: string;
  data_kind: string;
  source_platform: string;
  steps: SimStep[];
  characteristics: any;
  mapping_report: any;
  dedup: any;
  ai_analysis: any;
  sample_canonical: any[];
  recommendations: any;
}

const STEP_LABELS: Record<string, string> = {
  RESOLVE: "Resolución",
  PARSE: "Análisis de estructura",
  MAPPING: "Mapeo a esquema canónico",
  DEDUP: "Deduplicación",
  DB_WRITE_DRYRUN: "Validación DB (dry-run)",
  AI_ANALYSIS: "Análisis IA",
};

const STEP_ICONS: Record<string, React.ElementType> = {
  RESOLVE: Zap,
  PARSE: FileJson,
  MAPPING: Route,
  DEDUP: Database,
  DB_WRITE_DRYRUN: Database,
  AI_ANALYSIS: Sparkles,
};

function statusColor(status: string): string {
  if (["OK", "SIMULATED", "USER_PROVIDED"].includes(status)) return "text-primary";
  if (status === "WARN") return "text-amber-500";
  if (status === "SKIP") return "text-muted-foreground";
  return "text-destructive";
}

function statusIcon(status: string) {
  if (["OK", "SIMULATED", "USER_PROVIDED"].includes(status)) return <CheckCircle2 className="h-3.5 w-3.5 text-primary" />;
  if (status === "WARN") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (status === "SKIP") return <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />;
  return <XCircle className="h-3.5 w-3.5 text-destructive" />;
}

const SAMPLE_PAYLOAD_TEMPLATES: Record<string, string> = {
  ACTUACIONES: JSON.stringify([
    { fechaActuacion: "2025-06-01", actuacion: "AUTO ADMISORIO DE LA DEMANDA", anotacion: "Se admite demanda.", fechaRegistro: "2025-06-01T10:00:00Z" },
  ], null, 2),
  ESTADOS: JSON.stringify([
    { fecha_fijacion: "2025-06-02", descripcion: "FIJACIÓN DE ESTADO No. 045", tipo: "ESTADO", documento_url: "https://example.com/estado.pdf" },
  ], null, 2),
};

export function StepSimulation({ connector, instance, onNext }: StepSimulationProps) {
  const { invokeWithSession } = useWizardSessionContext();
  const [simMode, setSimMode] = useState<SimMode>("FIXTURE");
  const [dataKind, setDataKind] = useState<DataKind>("ACTUACIONES");
  const [samplePayload, setSamplePayload] = useState(SAMPLE_PAYLOAD_TEMPLATES.ACTUACIONES);
  const [includeAI, setIncludeAI] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [activeTab, setActiveTab] = useState("pipeline");

  const runSimulation = async () => {
    setRunning(true);
    setResult(null);
    try {
      let parsedPayload: unknown[] | undefined;
      if (simMode === "SAMPLE_PAYLOAD") {
        try {
          parsedPayload = JSON.parse(samplePayload);
          if (!Array.isArray(parsedPayload)) throw new Error("Must be an array");
        } catch (e: any) {
          toast.error(`JSON inválido: ${e.message}`);
          setRunning(false);
          return;
        }
      }

      const { data, error } = await invokeWithSession("provider-wizard-simulate", {
        body: {
          simulation_mode: simMode,
          connector_id: connector?.id,
          instance_id: instance?.id,
          data_kind: dataKind,
          source_platform: connector?.key || "SIMULATED",
          sample_payload: parsedPayload,
          include_ai_analysis: includeAI,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResult(data as SimResult);
      toast.success("Simulación completada");
    } catch (err: any) {
      toast.error(err.message || "Error en simulación");
    } finally {
      setRunning(false);
    }
  };

  const copyResult = () => {
    if (result) {
      navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      toast.success("Resultado copiado");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-5">
        <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          Laboratorio de Simulación
        </h2>

        <div className="text-xs bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-start gap-2">
          <FlaskConical className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
          <span className="text-foreground/80">
            Pruebe el pipeline completo <strong>sin escribir en la base de datos</strong>. 
            Simule datos de proveedor, valide el mapping, verifique compatibilidad DB y obtenga 
            recomendaciones de IA sobre la estrategia de integración.
          </span>
        </div>

        {/* Configuration */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Modo</Label>
            <Select value={simMode} onValueChange={(v) => setSimMode(v as SimMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FIXTURE">Fixture (datos de prueba)</SelectItem>
                <SelectItem value="SAMPLE_PAYLOAD">Payload personalizado</SelectItem>
                <SelectItem value="LIVE_FETCH">Live Fetch (real)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tipo de datos</Label>
            <Select value={dataKind} onValueChange={(v) => {
              setDataKind(v as DataKind);
              if (simMode === "SAMPLE_PAYLOAD" && SAMPLE_PAYLOAD_TEMPLATES[v]) {
                setSamplePayload(SAMPLE_PAYLOAD_TEMPLATES[v]);
              }
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTUACIONES">Actuaciones</SelectItem>
                <SelectItem value="ESTADOS">Estados / Publicaciones</SelectItem>
                <SelectItem value="SNAPSHOT">Snapshot completo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Análisis IA</Label>
            <div className="flex items-center gap-2 pt-1">
              <Switch checked={includeAI} onCheckedChange={setIncludeAI} />
              <span className="text-xs text-muted-foreground">{includeAI ? "Activado" : "Desactivado"}</span>
            </div>
          </div>
        </div>

        {/* Sample payload editor */}
        {simMode === "SAMPLE_PAYLOAD" && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Payload JSON (array de registros)</Label>
            <Textarea
              value={samplePayload}
              onChange={(e) => setSamplePayload(e.target.value)}
              className="font-mono text-xs min-h-[150px] resize-y"
              placeholder='[{"fechaActuacion": "2025-01-01", "actuacion": "...", "anotacion": "..."}]'
            />
          </div>
        )}

        {/* Run button */}
        <Button onClick={runSimulation} disabled={running} className="w-full gap-2" size="lg">
          {running ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Simulando pipeline…</>
          ) : result ? (
            <><RefreshCw className="h-4 w-4" /> Re-ejecutar simulación</>
          ) : (
            <><Play className="h-4 w-4" /> Ejecutar simulación</>
          )}
        </Button>

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className={`rounded-lg p-4 border-2 ${result.ok ? "bg-primary/5 border-primary/30" : "bg-destructive/5 border-destructive/30"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {result.ok ? <CheckCircle2 className="h-6 w-6 text-primary" /> : <XCircle className="h-6 w-6 text-destructive" />}
                  <div>
                    <p className="font-semibold text-foreground">
                      {result.ok ? "✅ Pipeline compatible" : "❌ Hay problemas de compatibilidad"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {result.steps.length} pasos · {result.steps.reduce((s, st) => s + st.duration_ms, 0)}ms total
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={copyResult} title="Copiar JSON">
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Tabbed results */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full">
                <TabsTrigger value="pipeline" className="flex-1 text-xs">Pipeline</TabsTrigger>
                <TabsTrigger value="mapping" className="flex-1 text-xs">Mapping</TabsTrigger>
                <TabsTrigger value="canonical" className="flex-1 text-xs">Datos canónicos</TabsTrigger>
                {result.ai_analysis && <TabsTrigger value="ai" className="flex-1 text-xs">IA Atenia</TabsTrigger>}
              </TabsList>

              <TabsContent value="pipeline">
                <ScrollArea className="max-h-[400px]">
                  <div className="space-y-2">
                    {result.steps.map((step, i) => {
                      const Icon = STEP_ICONS[step.step] || Zap;
                      return (
                        <div key={i} className={`rounded-lg border p-3 ${
                          ["OK", "SIMULATED", "USER_PROVIDED", "SKIP"].includes(step.status)
                            ? "bg-card border-border/50"
                            : step.status === "WARN" ? "bg-amber-500/5 border-amber-500/20"
                            : "bg-destructive/5 border-destructive/20"
                        }`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs font-medium text-foreground">
                                {STEP_LABELS[step.step] || step.step}
                              </span>
                              {statusIcon(step.status)}
                              <Badge variant="outline" className={`text-[10px] ${statusColor(step.status)}`}>
                                {step.status}
                              </Badge>
                            </div>
                            <span className="text-[10px] text-muted-foreground">{step.duration_ms}ms</span>
                          </div>
                          {step.detail && typeof step.detail === "object" && (
                            <pre className="text-[10px] font-mono text-muted-foreground bg-muted/30 rounded p-2 overflow-auto max-h-24 mt-1">
                              {JSON.stringify(step.detail, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="mapping">
                <div className="space-y-3">
                  {result.mapping_report && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                          <span className="text-xs text-muted-foreground">Tabla destino</span>
                          <p className="text-sm font-mono text-foreground">{result.mapping_report.target_table}</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                          <span className="text-xs text-muted-foreground">Registros</span>
                          <p className="text-sm font-mono text-foreground">
                            <span className="text-primary">{result.mapping_report.records_valid}</span> válidos / 
                            <span className="text-destructive ml-1">{result.mapping_report.records_invalid}</span> inválidos
                          </p>
                        </div>
                      </div>

                      {result.mapping_report.mapped_fields?.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground">Campos mapeados:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {result.mapping_report.mapped_fields.map((f: string) => (
                              <Badge key={f} className="text-[10px] bg-primary/10 text-primary">{f}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {result.mapping_report.extra_fields?.length > 0 && (
                        <div>
                          <span className="text-xs text-amber-500">Campos extras (irán a tabla extras):</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {result.mapping_report.extra_fields.map((f: string) => (
                              <Badge key={f} variant="outline" className="text-[10px] text-amber-500">{f}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recommendations */}
                      {result.recommendations && (
                        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
                          <span className="text-xs font-medium text-foreground flex items-center gap-1">
                            <Sparkles className="h-3 w-3 text-primary" /> Detección automática
                          </span>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <span className="text-muted-foreground">Patrón:</span>{" "}
                              <Badge variant="secondary" className="text-[10px]">
                                {result.recommendations.is_snapshot ? "Snapshot" : "Registro individual"}
                              </Badge>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Estrategia:</span>{" "}
                              <Badge variant="secondary" className="text-[10px]">
                                {result.recommendations.recommended_strategy}
                              </Badge>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Documentos:</span>{" "}
                              <span className="font-mono">{result.recommendations.has_documents ? "Sí" : "No"}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Identity mapping:</span>{" "}
                              <span className="font-mono">{result.recommendations.needs_identity_mapping ? "Recomendado" : "No necesario"}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="canonical">
                <ScrollArea className="max-h-[400px]">
                  <div className="space-y-2">
                    {result.sample_canonical?.map((record, i) => (
                      <div key={i} className="rounded-lg border bg-card p-3">
                        <span className="text-[10px] text-muted-foreground">Registro #{i + 1}</span>
                        <pre className="text-[10px] font-mono text-foreground bg-muted/30 rounded p-2 overflow-auto max-h-32 mt-1">
                          {JSON.stringify(record, null, 2)}
                        </pre>
                      </div>
                    ))}
                    {(!result.sample_canonical || result.sample_canonical.length === 0) && (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        No hay registros canónicos para mostrar.
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {result.ai_analysis && (
                <TabsContent value="ai">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">Análisis de Atenia IA</span>
                    </div>

                    {result.ai_analysis.summary && (
                      <div className="bg-accent/50 border rounded-lg p-3">
                        <p className="text-xs text-foreground leading-relaxed">{result.ai_analysis.summary}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      {result.ai_analysis.integration_type && (
                        <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                          <span className="text-xs text-muted-foreground">Tipo de integración</span>
                          <p className="text-sm font-mono text-primary font-medium">{result.ai_analysis.integration_type}</p>
                          {result.ai_analysis.integration_type_reason && (
                            <p className="text-[10px] text-muted-foreground mt-1">{result.ai_analysis.integration_type_reason}</p>
                          )}
                        </div>
                      )}
                      {result.ai_analysis.data_quality_score !== undefined && (
                        <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                          <span className="text-xs text-muted-foreground">Calidad de datos</span>
                          <p className={`text-sm font-mono font-medium ${
                            result.ai_analysis.data_quality_score >= 80 ? "text-primary" :
                            result.ai_analysis.data_quality_score >= 50 ? "text-amber-500" : "text-destructive"
                          }`}>{result.ai_analysis.data_quality_score}/100</p>
                        </div>
                      )}
                      {result.ai_analysis.dedup_risk && (
                        <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                          <span className="text-xs text-muted-foreground">Riesgo de duplicados</span>
                          <Badge variant={result.ai_analysis.dedup_risk === "low" ? "default" : "destructive"} className="text-[10px]">
                            {result.ai_analysis.dedup_risk}
                          </Badge>
                        </div>
                      )}
                      {result.ai_analysis.snapshot_compatible !== undefined && (
                        <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                          <span className="text-xs text-muted-foreground">Compatible snapshot</span>
                          <p className="text-sm font-mono">{result.ai_analysis.snapshot_compatible ? "✅ Sí" : "❌ No"}</p>
                        </div>
                      )}
                    </div>

                    {/* Workarounds (no-code solutions) */}
                    {result.ai_analysis.workarounds?.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-xs font-medium text-foreground flex items-center gap-1">
                          <Zap className="h-3 w-3 text-primary" /> Soluciones sin código
                        </span>
                        {result.ai_analysis.workarounds.map((w: any, i: number) => (
                          <div key={i} className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                            <p className="text-xs font-medium text-foreground">{w.issue}</p>
                            <p className="text-[11px] text-muted-foreground mt-1">{w.solution}</p>
                            {w.no_code && (
                              <Badge className="text-[9px] mt-1 bg-primary/10 text-primary">No requiere código</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {result.ai_analysis.mapping_recommendations?.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-foreground">Recomendaciones de mapping:</span>
                        {result.ai_analysis.mapping_recommendations.map((r: string, i: number) => (
                          <p key={i} className="text-[11px] text-muted-foreground">• {r}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={onNext} className="gap-2">
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Laboratorio de Simulación"
          whatItDoes="Ejecuta el pipeline completo en modo dry-run: resolución, parsing, mapping, deduplicación y validación de escritura DB — todo sin escribir datos reales. Opcionalmente, Atenia IA analiza los resultados."
          whyItMatters="Permite detectar problemas de compatibilidad antes de configurar routing y activar el proveedor. Los datos simulados revelan si el mapping es correcto, si hay campos que se perderían, y si la estrategia (snapshot vs polling) es la adecuada."
          commonMistakes={[
            "El fixture usa datos genéricos — use SAMPLE_PAYLOAD con datos reales de su proveedor",
            "Un score de calidad bajo no bloquea — pero indica que el mapping necesita ajustes",
            "Los campos 'extra' no se pierden — van a la tabla extras como JSONB",
            "'Identity mapping' significa que el proveedor ya devuelve el formato canónico",
          ]}
        />
      </div>
    </div>
  );
}
