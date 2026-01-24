/**
 * Pattern Testing Panel
 * Admin UI to manage and test milestone mapping patterns
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { 
  FlaskConical, 
  Check, 
  X, 
  ChevronDown,
  Regex,
  Target,
  Info,
  Sparkles,
  Copy,
  Pencil,
  Plus,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { 
  testPatternMatch, 
  testAllPatterns,
  getMilestoneDisplayName,
  type MilestonePattern,
  type PatternMatchExplanation,
} from "@/lib/scraping/milestone-mapper";

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

export function PatternTestingPanel() {
  const queryClient = useQueryClient();
  const [testText, setTestText] = useState("");
  const [testResults, setTestResults] = useState<{ pattern: MilestonePattern; explanation: PatternMatchExplanation }[]>([]);
  const [isTestOpen, setIsTestOpen] = useState(true);
  const [editingPattern, setEditingPattern] = useState<PatternRow | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  // Fetch patterns
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

  // Toggle pattern active state
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
    onError: (error) => {
      toast.error("Error al actualizar", { description: error.message });
    },
  });

  // Update pattern
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
      toast.success("Patrón actualizado");
      setIsEditDialogOpen(false);
      setEditingPattern(null);
    },
    onError: (error) => {
      toast.error("Error al actualizar", { description: error.message });
    },
  });

  // Run test
  const handleTest = () => {
    if (!testText.trim() || !patterns) {
      setTestResults([]);
      return;
    }
    
    const mappedPatterns: MilestonePattern[] = patterns
      .filter(p => p.active)
      .map(p => ({
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

  // Sample texts for testing
  const sampleTexts = [
    "Auto admisorio de la demanda - Se admite la demanda presentada",
    "Se libra mandamiento de pago contra el demandado",
    "Notificación personal al demandante en la secretaría",
    "Pasa al despacho para decidir sobre las excepciones",
    "Sentencia de primera instancia - Se ordena seguir adelante la ejecución",
    "Se fija fecha para audiencia de conciliación",
  ];

  const copyRegex = (regex: string) => {
    navigator.clipboard.writeText(regex);
    toast.success("Regex copiado al portapapeles");
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Test Panel */}
        <Card>
          <Collapsible open={isTestOpen} onOpenChange={setIsTestOpen}>
            <CardHeader className="pb-3">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-5 w-5 text-primary" />
                    <CardTitle>Probar Patrones</CardTitle>
                  </div>
                  <ChevronDown className={cn(
                    "h-5 w-5 transition-transform",
                    isTestOpen && "rotate-180"
                  )} />
                </div>
              </CollapsibleTrigger>
              <CardDescription>
                Prueba texto de actuaciones contra los patrones configurados
              </CardDescription>
            </CardHeader>
            
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="test-text">Texto de Prueba</Label>
                  <Textarea
                    id="test-text"
                    value={testText}
                    onChange={(e) => setTestText(e.target.value)}
                    placeholder="Ingresa el texto de una actuación para probar..."
                    className="min-h-[100px]"
                  />
                </div>
                
                {/* Sample texts */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Ejemplos rápidos:</Label>
                  <div className="flex flex-wrap gap-2">
                    {sampleTexts.map((sample, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => setTestText(sample)}
                      >
                        {sample.substring(0, 30)}...
                      </Button>
                    ))}
                  </div>
                </div>
                
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
                  <div className="space-y-3 pt-4 border-t">
                    <h4 className="font-medium flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Resultados ({testResults.length})
                    </h4>
                    
                    {testResults.map(({ pattern, explanation }, i) => (
                      <Card key={i} className="bg-muted/50">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="default">
                                {getMilestoneDisplayName(pattern.milestoneType)}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                Confianza: {(pattern.baseConfidence * 100).toFixed(0)}%
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                Prioridad: {pattern.priority}
                              </Badge>
                            </div>
                            {i === 0 && (
                              <Badge className="bg-green-500/20 text-green-700 dark:text-green-400">
                                Mejor coincidencia
                              </Badge>
                            )}
                          </div>
                          
                          <div className="grid gap-2 text-sm">
                            <div className="flex items-start gap-2">
                              <Regex className="h-4 w-4 mt-0.5 text-muted-foreground" />
                              <div className="flex-1">
                                <span className="text-muted-foreground">Regex: </span>
                                <code className="bg-background px-1 py-0.5 rounded text-xs">
                                  {explanation.pattern_regex}
                                </code>
                              </div>
                            </div>
                            
                            <div className="flex items-start gap-2">
                              <Target className="h-4 w-4 mt-0.5 text-muted-foreground" />
                              <div>
                                <span className="text-muted-foreground">Texto coincidente: </span>
                                <mark className="bg-yellow-200 dark:bg-yellow-900 px-1 rounded">
                                  {explanation.matched_text}
                                </mark>
                                <span className="text-xs text-muted-foreground ml-2">
                                  (pos: {explanation.match_position.start}-{explanation.match_position.end})
                                </span>
                              </div>
                            </div>
                            
                            {explanation.keywords_matched.length > 0 && (
                              <div className="flex items-start gap-2">
                                <Check className="h-4 w-4 mt-0.5 text-green-500" />
                                <div>
                                  <span className="text-muted-foreground">Keywords: </span>
                                  {explanation.keywords_matched.map((kw, j) => (
                                    <Badge key={j} variant="outline" className="mr-1 text-xs">
                                      {kw}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {explanation.pattern_notes && (
                              <div className="flex items-start gap-2">
                                <Info className="h-4 w-4 mt-0.5 text-blue-500" />
                                <span className="text-muted-foreground italic">
                                  {explanation.pattern_notes}
                                </span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
                
                {testText && testResults.length === 0 && (
                  <div className="text-center py-4 text-muted-foreground">
                    <X className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p>No se encontraron patrones que coincidan</p>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* Patterns Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Regex className="h-5 w-5" />
                  Patrones de Mapeo
                </CardTitle>
                <CardDescription>
                  {patterns?.length || 0} patrones configurados
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">Activo</TableHead>
                    <TableHead>Hito</TableHead>
                    <TableHead>Regex</TableHead>
                    <TableHead className="w-[80px]">Confianza</TableHead>
                    <TableHead className="w-[80px]">Prioridad</TableHead>
                    <TableHead className="w-[80px]">Tipo</TableHead>
                    <TableHead className="w-[100px]">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patterns?.map((pattern) => (
                    <TableRow key={pattern.id}>
                      <TableCell>
                        <Switch
                          checked={pattern.active}
                          onCheckedChange={(checked) => 
                            toggleActiveMutation.mutate({ id: pattern.id, active: checked })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="secondary">
                            {getMilestoneDisplayName(pattern.milestone_type)}
                          </Badge>
                          {pattern.notes && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {pattern.notes}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded max-w-[200px] truncate block">
                            {pattern.pattern_regex}
                          </code>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6"
                                onClick={() => copyRegex(pattern.pattern_regex)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Copiar regex</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {(Number(pattern.base_confidence) * 100).toFixed(0)}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{pattern.priority}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={pattern.is_system ? "secondary" : "outline"}>
                          {pattern.is_system ? "Sistema" : "Usuario"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  setEditingPattern(pattern);
                                  setIsEditDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Editar</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  setTestText(`Texto de ejemplo para: ${pattern.milestone_type}`);
                                  setIsTestOpen(true);
                                }}
                              >
                                <FlaskConical className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Probar</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Edit Pattern Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Patrón</DialogTitle>
              <DialogDescription>
                {editingPattern && getMilestoneDisplayName(editingPattern.milestone_type)}
              </DialogDescription>
            </DialogHeader>
            
            {editingPattern && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-regex">Expresión Regular</Label>
                  <Input
                    id="edit-regex"
                    value={editingPattern.pattern_regex}
                    onChange={(e) => setEditingPattern({
                      ...editingPattern,
                      pattern_regex: e.target.value,
                    })}
                    className="font-mono text-sm"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit-keywords">Keywords (separadas por coma)</Label>
                  <Input
                    id="edit-keywords"
                    value={editingPattern.pattern_keywords.join(", ")}
                    onChange={(e) => setEditingPattern({
                      ...editingPattern,
                      pattern_keywords: e.target.value.split(",").map(k => k.trim()).filter(Boolean),
                    })}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-confidence">Confianza Base (0-1)</Label>
                    <Input
                      id="edit-confidence"
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={editingPattern.base_confidence}
                      onChange={(e) => setEditingPattern({
                        ...editingPattern,
                        base_confidence: parseFloat(e.target.value),
                      })}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="edit-priority">Prioridad</Label>
                    <Input
                      id="edit-priority"
                      type="number"
                      min="1"
                      max="1000"
                      value={editingPattern.priority}
                      onChange={(e) => setEditingPattern({
                        ...editingPattern,
                        priority: parseInt(e.target.value),
                      })}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit-notes">Notas</Label>
                  <Textarea
                    id="edit-notes"
                    value={editingPattern.notes || ""}
                    onChange={(e) => setEditingPattern({
                      ...editingPattern,
                      notes: e.target.value,
                    })}
                    placeholder="Descripción del patrón..."
                  />
                </div>
              </div>
            )}
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancelar
              </Button>
              <Button 
                onClick={() => editingPattern && updatePatternMutation.mutate(editingPattern)}
                disabled={updatePatternMutation.isPending}
              >
                Guardar Cambios
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
