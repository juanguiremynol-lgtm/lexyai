/**
 * Pattern Testing Panel — Wizard UI
 * Guides users through: Browse → Edit → Test → Save
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  FlaskConical,
  Check,
  X,
  Regex,
  Target,
  Sparkles,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Search,
  Save,
  RotateCcw,
  ShieldAlert,
  ArrowRight,
  CircleDot,
  List,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  testAllPatterns,
  getMilestoneDisplayName,
  type MilestonePattern,
  type PatternMatchExplanation,
} from "@/lib/scraping/milestone-mapper";
import {
  evaluatePreclusion,
  getDecisionLabel,
  getDecisionColor,
  getDecisionBadgeVariant,
} from "@/lib/workflows/preclusion-guard";
import {
  getTaxonomy,
  getCanonicalLabel,
  INFERENCE_SUPPORTED_WORKFLOWS,
} from "@/lib/workflows/stage-taxonomy";
import type { WorkflowType } from "@/lib/workflow-constants";

// ============================================
// Types
// ============================================

interface PatternRow {
  id: string;
  milestone_type: string;
  pattern_regex: string;
  pattern_keywords: string[];
  base_confidence: number;
  priority: number;
  is_system: boolean;
  active: boolean;
  notes: string | null;
}

type WizardStep = "browse" | "edit" | "test" | "save";

const STEPS: { key: WizardStep; label: string; icon: React.ReactNode }[] = [
  { key: "browse", label: "Explorar", icon: <List className="h-4 w-4" /> },
  { key: "edit", label: "Editar", icon: <Pencil className="h-4 w-4" /> },
  { key: "test", label: "Probar", icon: <FlaskConical className="h-4 w-4" /> },
  { key: "save", label: "Guardar", icon: <Save className="h-4 w-4" /> },
];

const SAMPLE_TEXTS = [
  "Auto admisorio de la demanda - Se admite la demanda presentada",
  "Se libra mandamiento de pago contra el demandado",
  "Notificación personal al demandante en la secretaría",
  "Pasa al despacho para decidir sobre las excepciones",
  "Sentencia de primera instancia - falla a favor del demandante",
  "Se fija fecha para audiencia de conciliación",
  "Declara la nulidad de lo actuado y retrotrae la actuación hasta la notificación",
];

// ============================================
// Component
// ============================================

export function PatternTestingPanel() {
  const queryClient = useQueryClient();

  // Wizard state
  const [step, setStep] = useState<WizardStep>("browse");
  const [selectedPattern, setSelectedPattern] = useState<PatternRow | null>(null);
  const [editDraft, setEditDraft] = useState<PatternRow | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Test state
  const [testText, setTestText] = useState("");
  const [testResults, setTestResults] = useState<{ pattern: MilestonePattern; explanation: PatternMatchExplanation }[]>([]);
  const [testWorkflow, setTestWorkflow] = useState<WorkflowType>("CGP");
  const [testCurrentStage, setTestCurrentStage] = useState("");

  // Has unsaved changes
  const hasChanges = editDraft && selectedPattern && (
    editDraft.pattern_regex !== selectedPattern.pattern_regex ||
    editDraft.base_confidence !== selectedPattern.base_confidence ||
    editDraft.priority !== selectedPattern.priority ||
    editDraft.notes !== selectedPattern.notes ||
    JSON.stringify(editDraft.pattern_keywords) !== JSON.stringify(selectedPattern.pattern_keywords)
  );

  // ---- Queries & Mutations ----

  const { data: patterns, isLoading } = useQuery({
    queryKey: ["milestone-patterns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("milestone_mapping_patterns")
        .select("*")
        .order("priority", { ascending: false });
      if (error) throw error;
      return data as PatternRow[];
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("milestone_mapping_patterns")
        .update({ active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["milestone-patterns"] });
      toast.success("Patrón actualizado");
    },
    onError: (error) => toast.error("Error", { description: error.message }),
  });

  const updatePatternMutation = useMutation({
    mutationFn: async (pattern: Partial<PatternRow> & { id: string }) => {
      const { error } = await supabase
        .from("milestone_mapping_patterns")
        .update({
          pattern_regex: pattern.pattern_regex,
          pattern_keywords: pattern.pattern_keywords,
          base_confidence: pattern.base_confidence,
          priority: pattern.priority,
          notes: pattern.notes,
        })
        .eq("id", pattern.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["milestone-patterns"] });
      toast.success("Patrón guardado correctamente");
      // Update selectedPattern to match saved state
      if (editDraft) setSelectedPattern(editDraft);
    },
    onError: (error) => toast.error("Error al guardar", { description: error.message }),
  });

  // ---- Filtered patterns ----

  const filteredPatterns = useMemo(() => {
    if (!patterns) return [];
    if (!searchQuery.trim()) return patterns;
    const q = searchQuery.toLowerCase();
    return patterns.filter(
      (p) =>
        p.milestone_type.toLowerCase().includes(q) ||
        getMilestoneDisplayName(p.milestone_type).toLowerCase().includes(q) ||
        p.pattern_regex.toLowerCase().includes(q) ||
        (p.notes && p.notes.toLowerCase().includes(q))
    );
  }, [patterns, searchQuery]);

  // ---- Actions ----

  const selectPattern = (p: PatternRow) => {
    setSelectedPattern(p);
    setEditDraft({ ...p });
    setStep("edit");
  };

  const handleTest = () => {
    if (!testText.trim() || !patterns) {
      setTestResults([]);
      return;
    }

    const mappedPatterns: MilestonePattern[] = patterns
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        milestoneType: p.milestone_type,
        patternRegex: p.pattern_regex,
        patternKeywords: p.pattern_keywords || [],
        baseConfidence: Number(p.base_confidence) || 0.8,
        priority: p.priority || 100,
        notes: p.notes || undefined,
        isSystem: p.is_system,
      }));

    const results = testAllPatterns(testText, mappedPatterns);
    setTestResults(results);

    if (results.length === 0) {
      toast.info("No se encontraron coincidencias");
    } else {
      toast.success(`${results.length} patrón(es) coinciden`);
    }
  };

  const handleSave = () => {
    if (!editDraft) return;
    updatePatternMutation.mutate(editDraft);
  };

  const goToStep = (s: WizardStep) => {
    if (s === "test" && editDraft) {
      // When entering test, pre-fill with the selected pattern's sample
      if (!testText) {
        setTestText(`Texto de ejemplo para: ${getMilestoneDisplayName(editDraft.milestone_type)}`);
      }
    }
    setStep(s);
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  // ---- Preclusion preview ----

  const preclusionPreview = useMemo(() => {
    if (!testText.trim() || !testCurrentStage || testResults.length === 0) return null;

    // Use the best match to simulate a stage suggestion
    const bestMatch = testResults[0];
    if (!bestMatch) return null;

    return evaluatePreclusion({
      workflowType: testWorkflow,
      currentStage: testCurrentStage,
      currentCgpPhase: null,
      suggestedStage: bestMatch.pattern.milestoneType,
      suggestedCgpPhase: null,
      docketText: testText,
    });
  }, [testText, testCurrentStage, testWorkflow, testResults]);

  // ---- Render ----

  return (
    <div className="space-y-4">
      {/* Step Indicator */}
      <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg">
        {STEPS.map((s, i) => {
          const isCurrent = step === s.key;
          const isPast = i < stepIndex;
          const isClickable = s.key === "browse" || selectedPattern;
          return (
            <button
              key={s.key}
              onClick={() => isClickable && goToStep(s.key)}
              disabled={!isClickable}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center",
                isCurrent && "bg-background text-foreground shadow-sm",
                isPast && !isCurrent && "text-primary",
                !isCurrent && !isPast && "text-muted-foreground",
                !isClickable && "opacity-50 cursor-not-allowed"
              )}
            >
              {isPast && !isCurrent ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                s.icon
              )}
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* Step Content */}
      <Card>
        {/* ==================== STEP: BROWSE ==================== */}
        {step === "browse" && (
          <>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Regex className="h-5 w-5 text-primary" />
                Patrones de Hitos
              </CardTitle>
              <CardDescription>
                {patterns?.length || 0} patrones configurados. Selecciona uno para editar y probar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre, regex o notas..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Pattern List */}
              <ScrollArea className="h-[420px]">
                <div className="space-y-1">
                  {isLoading && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Cargando patrones...
                    </p>
                  )}
                  {filteredPatterns.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => selectPattern(p)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors",
                        "hover:border-primary/50 hover:bg-muted/50",
                        selectedPattern?.id === p.id && "border-primary bg-primary/5"
                      )}
                    >
                      <Switch
                        checked={p.active}
                        onCheckedChange={(checked) => {
                          toggleActiveMutation.mutate({ id: p.id, active: checked });
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">
                            {getMilestoneDisplayName(p.milestone_type)}
                          </span>
                          <Badge
                            variant={p.is_system ? "secondary" : "outline"}
                            className="text-[10px] px-1.5 shrink-0"
                          >
                            {p.is_system ? "SIS" : "USR"}
                          </Badge>
                        </div>
                        <code className="text-xs text-muted-foreground truncate block mt-0.5">
                          {p.pattern_regex}
                        </code>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-xs">
                          {(Number(p.base_confidence) * 100).toFixed(0)}%
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                  {!isLoading && filteredPatterns.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No se encontraron patrones
                    </p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </>
        )}

        {/* ==================== STEP: EDIT ==================== */}
        {step === "edit" && editDraft && (
          <>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Pencil className="h-5 w-5 text-primary" />
                    Editar Patrón
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary">
                      {getMilestoneDisplayName(editDraft.milestone_type)}
                    </Badge>
                    {hasChanges && (
                      <Badge variant="outline" className="text-amber-600 border-amber-600/30">
                        Sin guardar
                      </Badge>
                    )}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="edit-regex">Expresión Regular</Label>
                <Input
                  id="edit-regex"
                  value={editDraft.pattern_regex}
                  onChange={(e) =>
                    setEditDraft({ ...editDraft, pattern_regex: e.target.value })
                  }
                  className="font-mono text-sm"
                  placeholder="(?:auto\s+admisorio|admite\s+demanda)..."
                />
                {/* Regex validation hint */}
                {editDraft.pattern_regex && (() => {
                  try {
                    new RegExp(editDraft.pattern_regex, "i");
                    return (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <Check className="h-3 w-3" /> Regex válido
                      </p>
                    );
                  } catch {
                    return (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <X className="h-3 w-3" /> Regex inválido
                      </p>
                    );
                  }
                })()}
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-keywords">Keywords (separadas por coma)</Label>
                <Input
                  id="edit-keywords"
                  value={editDraft.pattern_keywords.join(", ")}
                  onChange={(e) =>
                    setEditDraft({
                      ...editDraft,
                      pattern_keywords: e.target.value
                        .split(",")
                        .map((k) => k.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="admisorio, admite, demanda"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-confidence">Confianza (0–1)</Label>
                  <Input
                    id="edit-confidence"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={editDraft.base_confidence}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, base_confidence: parseFloat(e.target.value) })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-priority">Prioridad</Label>
                  <Input
                    id="edit-priority"
                    type="number"
                    min="1"
                    max="1000"
                    value={editDraft.priority}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, priority: parseInt(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-notes">Notas</Label>
                <Textarea
                  id="edit-notes"
                  value={editDraft.notes || ""}
                  onChange={(e) =>
                    setEditDraft({ ...editDraft, notes: e.target.value })
                  }
                  placeholder="Descripción del patrón..."
                  rows={3}
                />
              </div>

              {/* Navigation */}
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep("browse")}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Volver
                </Button>
                <Button onClick={() => goToStep("test")}>
                  Probar
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </>
        )}

        {/* ==================== STEP: TEST ==================== */}
        {step === "test" && (
          <>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FlaskConical className="h-5 w-5 text-primary" />
                Probar Patrones
              </CardTitle>
              <CardDescription>
                Ingresa texto de actuación y verifica qué patrones coinciden, incluyendo el guardia de preclusión.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Test input */}
              <div className="space-y-2">
                <Label>Texto de Prueba</Label>
                <Textarea
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  placeholder="Ingresa el texto de una actuación para probar..."
                  className="min-h-[80px]"
                />
              </div>

              {/* Quick samples */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Ejemplos rápidos:</Label>
                <div className="flex flex-wrap gap-1.5">
                  {SAMPLE_TEXTS.map((sample, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setTestText(sample)}
                    >
                      {sample.substring(0, 35)}…
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Preclusion context */}
              <div className="space-y-3">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Contexto de Preclusión (opcional)
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Jurisdicción</Label>
                    <select
                      value={testWorkflow}
                      onChange={(e) => {
                        setTestWorkflow(e.target.value as WorkflowType);
                        setTestCurrentStage("");
                      }}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {INFERENCE_SUPPORTED_WORKFLOWS.map((wf) => (
                        <option key={wf} value={wf}>{wf}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Etapa actual del asunto</Label>
                    <select
                      value={testCurrentStage}
                      onChange={(e) => setTestCurrentStage(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">— Sin etapa —</option>
                      {getTaxonomy(testWorkflow).map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.rank}. {s.label_es}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button onClick={handleTest} disabled={!testText.trim()}>
                  <Target className="h-4 w-4 mr-2" />
                  Probar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setTestText("");
                    setTestResults([]);
                  }}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Limpiar
                </Button>
              </div>

              {/* Results */}
              {testResults.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h4 className="font-medium flex items-center gap-2 text-sm">
                    <Sparkles className="h-4 w-4 text-primary" />
                    {testResults.length} coincidencia(s)
                  </h4>

                  {testResults.map(({ pattern, explanation }, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-lg border p-3 space-y-2",
                        i === 0 ? "border-primary/50 bg-primary/5" : "bg-muted/30"
                      )}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          {i === 0 && <CircleDot className="h-4 w-4 text-primary" />}
                          <Badge variant="default">
                            {getMilestoneDisplayName(pattern.milestoneType)}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {(pattern.baseConfidence * 100).toFixed(0)}%
                          </Badge>
                        </div>
                        {i === 0 && (
                          <span className="text-xs text-primary font-medium">
                            Mejor coincidencia
                          </span>
                        )}
                      </div>

                      <div className="text-sm space-y-1">
                        <div className="flex items-start gap-2">
                          <Target className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                          <span>
                            <mark className="bg-yellow-200 dark:bg-yellow-900 px-1 rounded text-sm">
                              {explanation.matched_text}
                            </mark>
                          </span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Regex className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {explanation.pattern_regex}
                          </code>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Preclusion Preview */}
                  {preclusionPreview && (
                    <div className="rounded-lg border border-dashed p-3 space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4" />
                        Guardia de Preclusión
                      </h4>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={getDecisionBadgeVariant(preclusionPreview.decision)}>
                          {getDecisionLabel(preclusionPreview.decision)}
                        </Badge>
                        {preclusionPreview.finalStage && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <ArrowRight className="h-3 w-3" />
                            {getCanonicalLabel(testWorkflow, preclusionPreview.finalStage)}
                          </span>
                        )}
                      </div>
                      {preclusionPreview.rollbackTrigger.detected && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Rollback detectado: "{preclusionPreview.rollbackTrigger.matchedText}"
                          {preclusionPreview.rollbackTrigger.targetStageParsed && (
                            <> → {getCanonicalLabel(testWorkflow, preclusionPreview.rollbackTrigger.targetStageParsed)}</>
                          )}
                        </p>
                      )}
                      <div className={cn(
                        "text-xs",
                        getDecisionColor(preclusionPreview.decision)
                      )}>
                        Rank actual: {preclusionPreview.currentStageRank} → Sugerido: {preclusionPreview.suggestedStageRank}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {testText.trim() && testResults.length === 0 && (
                <div className="text-center py-6 text-muted-foreground">
                  <X className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                  <p className="text-sm">No se encontraron patrones que coincidan</p>
                </div>
              )}

              {/* Navigation */}
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(selectedPattern ? "edit" : "browse")}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Volver
                </Button>
                {hasChanges && (
                  <Button onClick={() => goToStep("save")}>
                    Guardar
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
              </div>
            </CardContent>
          </>
        )}

        {/* ==================== STEP: SAVE ==================== */}
        {step === "save" && editDraft && selectedPattern && (
          <>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Save className="h-5 w-5 text-primary" />
                Confirmar Cambios
              </CardTitle>
              <CardDescription>
                Revisa los cambios antes de guardar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4 space-y-3">
                <Badge variant="secondary" className="mb-2">
                  {getMilestoneDisplayName(editDraft.milestone_type)}
                </Badge>

                {/* Diff view */}
                {editDraft.pattern_regex !== selectedPattern.pattern_regex && (
                  <DiffRow
                    label="Regex"
                    before={selectedPattern.pattern_regex}
                    after={editDraft.pattern_regex}
                    mono
                  />
                )}
                {editDraft.base_confidence !== selectedPattern.base_confidence && (
                  <DiffRow
                    label="Confianza"
                    before={`${(Number(selectedPattern.base_confidence) * 100).toFixed(0)}%`}
                    after={`${(Number(editDraft.base_confidence) * 100).toFixed(0)}%`}
                  />
                )}
                {editDraft.priority !== selectedPattern.priority && (
                  <DiffRow
                    label="Prioridad"
                    before={String(selectedPattern.priority)}
                    after={String(editDraft.priority)}
                  />
                )}
                {editDraft.notes !== selectedPattern.notes && (
                  <DiffRow
                    label="Notas"
                    before={selectedPattern.notes || "(vacío)"}
                    after={editDraft.notes || "(vacío)"}
                  />
                )}
                {JSON.stringify(editDraft.pattern_keywords) !== JSON.stringify(selectedPattern.pattern_keywords) && (
                  <DiffRow
                    label="Keywords"
                    before={selectedPattern.pattern_keywords.join(", ") || "(vacío)"}
                    after={editDraft.pattern_keywords.join(", ") || "(vacío)"}
                  />
                )}

                {!hasChanges && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hay cambios pendientes.
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep("edit")}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Volver
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || updatePatternMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updatePatternMutation.isPending ? "Guardando..." : "Guardar Cambios"}
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

// ============================================
// Diff Row sub-component
// ============================================

function DiffRow({ label, before, after, mono }: { label: string; before: string; after: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className={cn("bg-destructive/10 text-destructive rounded px-2 py-1 line-through", mono && "font-mono text-xs")}>
          {before}
        </div>
        <div className={cn("bg-green-500/10 text-green-700 dark:text-green-400 rounded px-2 py-1", mono && "font-mono text-xs")}>
          {after}
        </div>
      </div>
    </div>
  );
}
