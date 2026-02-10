/**
 * CaseSetupChecklist - Early-stage call-to-action panel
 * 
 * Shows checklist for critical documents in early stages:
 * - OneDrive electronic file link
 * - Acta de radicación
 * - Auto admisorio
 * 
 * Only visible for CGP, CPACA, LABORAL, TUTELA workflow types in early stages
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  Circle, 
  FolderOpen, 
  FileText, 
  Scale, 
  Link2,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { WorkItem } from "@/types/work-item";

interface CaseSetupChecklistProps {
  workItem: WorkItem & { 
    _source?: string;
    onedrive_url?: string | null;
    acta_radicacion_url?: string | null;
    auto_admisorio_url?: string | null;
  };
  onUpdate?: () => void;
}

// Early stages that show the checklist
const EARLY_STAGES = [
  // CGP stages
  "PREPARACION", "RADICADO", "SUBSANACION", "ADMISION", "DRAFTED", "PENDING_FILING", 
  // General early stages
  "DRAFT", "FILING", "PRECONTENCIOSO", "RADICACION", "PENDIENTE", "INICIAL",
  // Lower case variants
  "preparacion", "radicado", "subsanacion", "admision", "drafted", "pending_filing",
];

// Workflow types that use this checklist
const CHECKLIST_WORKFLOW_TYPES = ["CGP", "CPACA", "LABORAL", "TUTELA", "PENAL_906"];

// URL validation
function isValidUrl(url: string): boolean {
  if (!url || url.trim() === "") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isOneDriveUrl(url: string): boolean {
  if (!isValidUrl(url)) return false;
  const lower = url.toLowerCase();
  return lower.includes("onedrive.live.com") || 
         lower.includes("sharepoint.com") || 
         lower.includes("1drv.ms") ||
         lower.includes("onedrive.aspx");
}

type ChecklistItemKey = "onedrive" | "acta" | "auto";

interface ChecklistItem {
  key: ChecklistItemKey;
  label: string;
  description: string;
  icon: typeof FolderOpen;
  field: "onedrive_url" | "acta_radicacion_url" | "auto_admisorio_url";
  placeholder: string;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    key: "onedrive",
    label: "Expediente Electrónico (OneDrive)",
    description: "Link al expediente electrónico compartido por el despacho",
    icon: FolderOpen,
    field: "onedrive_url",
    placeholder: "https://onedrive.live.com/... o https://sharepoint.com/...",
  },
  {
    key: "acta",
    label: "Acta de Radicación",
    description: "Documento de constancia de radicación",
    icon: FileText,
    field: "acta_radicacion_url",
    placeholder: "https://...",
  },
  {
    key: "auto",
    label: "Auto Admisorio",
    description: "Auto que admite la demanda o solicitud",
    icon: Scale,
    field: "auto_admisorio_url",
    placeholder: "https://...",
  },
];

export function CaseSetupChecklist({ workItem, onUpdate }: CaseSetupChecklistProps) {
  const queryClient = useQueryClient();
  const [editingItem, setEditingItem] = useState<ChecklistItemKey | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  // Check if this work item should show the checklist
  const shouldShow = () => {
    // MilestonesChecklist now handles CGP/CPACA/LABORAL/TUTELA milestones — hide this legacy checklist for those
    const MILESTONE_WORKFLOWS = ["CGP", "CPACA", "TUTELA", "LABORAL"];
    if (MILESTONE_WORKFLOWS.includes(workItem.workflow_type)) {
      return false;
    }
    
    // Check workflow type
    if (!CHECKLIST_WORKFLOW_TYPES.includes(workItem.workflow_type)) {
      return false;
    }
    
    // Check if in early stage
    const stage = workItem.stage?.toUpperCase() || "";
    const cgpPhase = workItem.cgp_phase;
    
    // If CGP and in PROCESS phase with auto_admisorio_date, don't show
    if (workItem.workflow_type === "CGP" && cgpPhase === "PROCESS" && workItem.auto_admisorio_date) {
      return false;
    }
    
    // Check if any early stage matches
    const isEarlyStage = EARLY_STAGES.some(s => 
      stage.includes(s.toUpperCase()) || s.toUpperCase().includes(stage)
    );
    
    // Also show if any item is incomplete
    const hasIncompleteItems = !workItem.onedrive_url || !workItem.acta_radicacion_url || !workItem.auto_admisorio_url;
    
    return isEarlyStage || (hasIncompleteItems && !workItem.auto_admisorio_date);
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: string | null }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ 
          [field]: value, 
          updated_at: new Date().toISOString() 
        })
        .eq("id", workItem.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Guardado correctamente");
      setEditingItem(null);
      setInputValue("");
      setInputError(null);
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      onUpdate?.();
    },
    onError: (error) => {
      console.error("Error saving:", error);
      toast.error("Error al guardar");
    },
  });

  const handleStartEdit = (item: ChecklistItem) => {
    const currentValue = workItem[item.field] || "";
    setEditingItem(item.key);
    setInputValue(currentValue);
    setInputError(null);
  };

  const handleSave = (item: ChecklistItem) => {
    const trimmedValue = inputValue.trim();
    
    if (trimmedValue === "") {
      // Allow clearing
      saveMutation.mutate({ field: item.field, value: null });
      return;
    }

    if (!isValidUrl(trimmedValue)) {
      setInputError("Por favor ingresa una URL válida que comience con https://");
      return;
    }

    // Warn if OneDrive URL doesn't match expected domains
    if (item.key === "onedrive" && !isOneDriveUrl(trimmedValue)) {
      // Still allow, just warn via toast
      toast.warning("Esta URL no parece ser de OneDrive o SharePoint, pero se guardará de todos modos.");
    }

    saveMutation.mutate({ field: item.field, value: trimmedValue });
  };

  const handleRemove = (item: ChecklistItem) => {
    saveMutation.mutate({ field: item.field, value: null });
  };

  const handleCancel = () => {
    setEditingItem(null);
    setInputValue("");
    setInputError(null);
  };

  // Don't render if not applicable
  if (!shouldShow()) {
    return null;
  }

  const completedCount = CHECKLIST_ITEMS.filter(item => !!workItem[item.field]).length;
  const totalCount = CHECKLIST_ITEMS.length;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Configuración del Expediente
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Documenta los elementos esenciales para el seguimiento del proceso
            </CardDescription>
          </div>
          <Badge 
            variant={completedCount === totalCount ? "default" : "secondary"}
            className="text-xs"
          >
            {completedCount}/{totalCount} completos
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {CHECKLIST_ITEMS.map((item) => {
          const currentValue = workItem[item.field];
          const isComplete = !!currentValue;
          const isEditing = editingItem === item.key;
          const Icon = item.icon;

          return (
            <div 
              key={item.key}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border transition-all",
                isComplete ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" : "bg-background border-border"
              )}
            >
              {/* Status Icon */}
              <div className="mt-0.5">
                {isComplete ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className={cn(
                    "font-medium text-sm",
                    isComplete && "text-emerald-700 dark:text-emerald-400"
                  )}>
                    {item.label}
                  </span>
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <Input
                      value={inputValue}
                      onChange={(e) => {
                        setInputValue(e.target.value);
                        setInputError(null);
                      }}
                      placeholder={item.placeholder}
                      className={cn(
                        "text-sm",
                        inputError && "border-destructive focus:ring-destructive"
                      )}
                      autoFocus
                    />
                    {inputError && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {inputError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleSave(item)}
                        disabled={saveMutation.isPending}
                      >
                        {saveMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : null}
                        Guardar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancel}
                        disabled={saveMutation.isPending}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : isComplete ? (
                  <div className="space-y-1">
                    <a 
                      href={currentValue!} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline truncate block"
                    >
                      {currentValue}
                    </a>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => handleStartEdit(item)}
                      >
                        <Link2 className="h-3 w-3 mr-1" />
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemove(item)}
                        disabled={saveMutation.isPending}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Quitar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">{item.description}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => handleStartEdit(item)}
                    >
                      <Link2 className="h-3 w-3 mr-1" />
                      Agregar link
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
