/**
 * MilestonesChecklist - Fillable checklist for key legal milestones
 * 
 * Three milestones:
 * 1. Acta de Radicación - one-click checkable, NO link input
 * 2. Auto Admisorio - one-click checkable, NO link input
 * 3. Acceso / Expediente Electrónico - requires URL OR "Not available" toggle
 * 
 * Once cleared, hides and shows a compact badge with "Edit" action.
 */

import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  CheckCircle2, 
  Circle, 
  FileText, 
  Gavel, 
  Link2,
  Target,
  ExternalLink,
  Pencil,
  Loader2,
  AlertCircle,
  Ban,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";

import type { WorkItem } from "@/types/work-item";

interface MilestonesChecklistProps {
  workItem: WorkItem & {
    milestones_cleared_at?: string | null;
    milestones_cleared_status?: string | null;
    sharepoint_url?: string | null;
    onedrive_url?: string | null;
    acta_reparto_received_at?: string | null;
  };
  compact?: boolean;
}

// Workflow types that show milestones
const MILESTONE_WORKFLOWS = ["CGP", "CPACA", "TUTELA", "LABORAL"];

type ClearedStatus = "COMPLETE_WITH_ACCESS" | "COMPLETE_NO_ACCESS" | "PARTIAL";

function isValidUrl(url: string): boolean {
  if (!url || url.trim() === "") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function MilestonesChecklist({ workItem, compact = false }: MilestonesChecklistProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  
  // Local state for the access milestone
  const [accessUrl, setAccessUrl] = useState("");
  const [accessUrlError, setAccessUrlError] = useState<string | null>(null);
  const [accessNotAvailable, setAccessNotAvailable] = useState(false);

  // Determine milestone states from work_items fields
  const actaCompleted = !!(workItem as any).acta_reparto_received_at || !!workItem.filing_date;
  const autoAdmisorioCompleted = !!workItem.auto_admisorio_date || workItem.cgp_phase === "PROCESS";
  const expedienteUrl = workItem.sharepoint_url || workItem.onedrive_url || workItem.expediente_url;
  const hasExpedienteUrl = !!expedienteUrl && isValidUrl(expedienteUrl);
  
  // Access milestone: completed if URL exists OR cleared as NOT_AVAILABLE
  const clearedStatus = workItem.milestones_cleared_status as ClearedStatus | null;
  const accessMarkedNotAvailable = clearedStatus === "COMPLETE_NO_ACCESS";
  const accessCompleted = hasExpedienteUrl || accessMarkedNotAvailable;

  const isCleared = !!workItem.milestones_cleared_at;

  // Don't show for non-applicable workflow types
  if (!MILESTONE_WORKFLOWS.includes(workItem.workflow_type)) return null;

  const milestones = [
    {
      id: "acta",
      label: "Acta de Radicación",
      description: "Constancia de radicación ante el despacho",
      completed: actaCompleted,
      icon: FileText,
      value: workItem.filing_date 
        ? format(new Date(workItem.filing_date), "dd/MM/yyyy")
        : (workItem as any).acta_reparto_received_at 
          ? format(new Date((workItem as any).acta_reparto_received_at), "dd/MM/yyyy")
          : null,
    },
    {
      id: "auto_admisorio",
      label: "Auto Admisorio",
      description: "Auto que admite la demanda",
      completed: autoAdmisorioCompleted,
      icon: Gavel,
      value: workItem.auto_admisorio_date 
        ? format(new Date(workItem.auto_admisorio_date), "dd/MM/yyyy")
        : null,
    },
    {
      id: "expediente",
      label: "Acceso / Expediente Electrónico",
      description: "Enlace al expediente digital del despacho",
      completed: accessCompleted,
      icon: Link2,
      value: accessMarkedNotAvailable 
        ? "No disponible" 
        : hasExpedienteUrl 
          ? expedienteUrl 
          : null,
    },
  ];

  const completedCount = milestones.filter(m => m.completed).length;
  const totalCount = milestones.length;

  // Mutation for toggling simple milestones
  const toggleMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const { error } = await supabase
        .from("work_items")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", workItem.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hito actualizado");
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });

  // Mutation for clearing milestones
  const clearMutation = useMutation({
    mutationFn: async (status: ClearedStatus) => {
      const updates: Record<string, any> = {
        milestones_cleared_at: new Date().toISOString(),
        milestones_cleared_status: status,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("work_items")
        .update(updates)
        .eq("id", workItem.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hitos confirmados");
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });

  // Mutation to reopen (unclear) milestones
  const reopenMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("work_items")
        .update({ 
          milestones_cleared_at: null, 
          milestones_cleared_status: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", workItem.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setIsEditing(true);
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });

  // Save access URL
  const saveAccessUrl = () => {
    const trimmed = accessUrl.trim();
    if (!trimmed) {
      setAccessUrlError("Ingresa una URL válida");
      return;
    }
    if (!isValidUrl(trimmed)) {
      setAccessUrlError("URL inválida. Debe comenzar con https://");
      return;
    }
    toggleMutation.mutate({
      sharepoint_url: trimmed,
      expediente_url: trimmed,
    });
    setAccessUrl("");
    setAccessUrlError(null);
  };

  // Mark access as not available
  const markAccessNotAvailable = () => {
    setAccessNotAvailable(true);
    // We don't persist NOT_AVAILABLE immediately — it's captured when user clicks "Confirm"
    toast.info("Marcado como no disponible. Confirma los hitos para guardar.");
  };

  // Handle milestone toggle (one-click)
  const handleToggle = (milestoneId: string, currentlyCompleted: boolean) => {
    if (milestoneId === "acta") {
      if (currentlyCompleted) {
        toggleMutation.mutate({ acta_reparto_received_at: null });
      } else {
        toggleMutation.mutate({ acta_reparto_received_at: new Date().toISOString() });
      }
    } else if (milestoneId === "auto_admisorio") {
      if (currentlyCompleted) {
        toggleMutation.mutate({ auto_admisorio_date: null });
      } else {
        toggleMutation.mutate({ auto_admisorio_date: new Date().toISOString() });
      }
    }
  };

  // Handle "Confirm / Clear milestones"
  const handleClearMilestones = () => {
    const actaDone = actaCompleted;
    const autoDone = autoAdmisorioCompleted;
    const accessDone = hasExpedienteUrl || accessNotAvailable || accessMarkedNotAvailable;

    if (actaDone && autoDone && accessDone) {
      if (hasExpedienteUrl) {
        clearMutation.mutate("COMPLETE_WITH_ACCESS");
      } else {
        clearMutation.mutate("COMPLETE_NO_ACCESS");
      }
    } else {
      clearMutation.mutate("PARTIAL");
    }
  };

  // Compact mode for lists
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {milestones.map((m) => (
            <div
              key={m.id}
              className={cn(
                "h-2 w-2 rounded-full",
                m.completed ? "bg-emerald-500" : "bg-muted-foreground/30"
              )}
              title={`${m.label}: ${m.completed ? "✓" : "Pendiente"}`}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {completedCount}/{totalCount}
        </span>
      </div>
    );
  }

  // ─── CLEARED STATE: Show badge/button ───
  if (isCleared && !isEditing) {
    const statusLabel = clearedStatus === "COMPLETE_WITH_ACCESS"
      ? "Hitos completados"
      : clearedStatus === "COMPLETE_NO_ACCESS"
        ? "Hitos completados (sin acceso electrónico)"
        : `Hitos en progreso (${completedCount}/${totalCount})`;
    
    const statusIcon = clearedStatus === "PARTIAL" 
      ? <Circle className="h-4 w-4" />
      : <ShieldCheck className="h-4 w-4" />;

    const statusVariant = clearedStatus === "PARTIAL" ? "secondary" as const : "default" as const;

    return (
      <Card className="border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={statusVariant} className={cn(
                "gap-1",
                clearedStatus !== "PARTIAL" && "bg-emerald-600 hover:bg-emerald-700"
              )}>
                {statusIcon}
                {statusLabel}
              </Badge>
              {hasExpedienteUrl && (
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
                  <a href={expedienteUrl!} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3" />
                    Abrir expediente
                  </a>
                </Button>
              )}
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 text-xs gap-1"
              onClick={() => reopenMutation.mutate()}
              disabled={reopenMutation.isPending}
            >
              <Pencil className="h-3 w-3" />
              Editar hitos
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── EDITABLE CHECKLIST ───
  const isPending = toggleMutation.isPending || clearMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5" />
            Hitos del Caso
          </CardTitle>
          <Badge 
            variant={completedCount === totalCount ? "default" : "secondary"}
            className={cn(completedCount === totalCount && "bg-emerald-600")}
          >
            {completedCount} / {totalCount}
          </Badge>
        </div>
        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-2 mt-2">
          <div 
            className={cn(
              "h-2 rounded-full transition-all",
              completedCount === totalCount ? "bg-emerald-500" : "bg-primary"
            )}
            style={{ width: `${(completedCount / totalCount) * 100}%` }}
          />
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {milestones.map((milestone) => (
          <div
            key={milestone.id}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg border transition-colors",
              milestone.completed
                ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800"
                : "bg-muted/30 border-dashed"
            )}
          >
            {/* Checkbox - for acta and auto_admisorio: clickable toggle */}
            {milestone.id !== "expediente" ? (
              <button
                type="button"
                onClick={() => handleToggle(milestone.id, milestone.completed)}
                disabled={isPending}
                className="shrink-0 mt-0.5 cursor-pointer hover:scale-110 transition-transform disabled:opacity-50"
                title={milestone.completed ? "Desmarcar" : "Marcar como completado (hoy)"}
              >
                {milestone.completed ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
              </button>
            ) : (
              <div className="shrink-0 mt-0.5">
                {milestone.completed ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <milestone.icon className={cn(
                  "h-4 w-4",
                  milestone.completed ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                )} />
                <span className={cn(
                  "font-medium text-sm",
                  milestone.completed && "text-emerald-700 dark:text-emerald-300"
                )}>
                  {milestone.label}
                </span>
              </div>

              {milestone.completed ? (
                <div className="mt-1">
                  {milestone.id === "expediente" && hasExpedienteUrl ? (
                    <a
                      href={expedienteUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir expediente
                    </a>
                  ) : milestone.id === "expediente" && accessMarkedNotAvailable ? (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Ban className="h-3 w-3" />
                      Acceso electrónico no disponible
                    </span>
                  ) : milestone.value ? (
                    <span className="text-xs text-muted-foreground">{milestone.value}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Completado</span>
                  )}
                </div>
              ) : (
                <div className="mt-1">
                  <p className="text-xs text-muted-foreground mb-2">{milestone.description}</p>
                  
                  {/* Only the expediente milestone gets URL input */}
                  {milestone.id === "expediente" && !accessNotAvailable && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input
                          value={accessUrl}
                          onChange={(e) => {
                            setAccessUrl(e.target.value);
                            setAccessUrlError(null);
                          }}
                          placeholder="https://onedrive.live.com/... o https://sharepoint.com/..."
                          className={cn("text-sm h-8", accessUrlError && "border-destructive")}
                        />
                        <Button
                          size="sm"
                          className="h-8 text-xs shrink-0"
                          onClick={saveAccessUrl}
                          disabled={isPending || !accessUrl.trim()}
                        >
                          {toggleMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                          Guardar
                        </Button>
                      </div>
                      {accessUrlError && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {accessUrlError}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={markAccessNotAvailable}
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 flex items-center gap-1"
                      >
                        <Ban className="h-3 w-3" />
                        Acceso no disponible
                      </button>
                      <p className="text-[10px] text-muted-foreground/70">
                        Algunos despachos no ofrecen acceso electrónico permanente.
                      </p>
                    </div>
                  )}

                  {/* Show "not available" confirmed state */}
                  {milestone.id === "expediente" && accessNotAvailable && (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs gap-1">
                        <Ban className="h-3 w-3" />
                        Marcado como no disponible
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => setAccessNotAvailable(false)}
                      >
                        Cambiar
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Confirm / Clear button */}
        <div className="pt-2 border-t">
          <Button
            onClick={handleClearMilestones}
            disabled={isPending || clearMutation.isPending}
            className="w-full gap-2"
            variant={completedCount === totalCount || (actaCompleted && autoAdmisorioCompleted && (hasExpedienteUrl || accessNotAvailable)) ? "default" : "outline"}
          >
            {clearMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            <ShieldCheck className="h-4 w-4" />
            {completedCount === totalCount || (actaCompleted && autoAdmisorioCompleted && (hasExpedienteUrl || accessNotAvailable))
              ? "Confirmar hitos"
              : `Guardar progreso (${completedCount}/${totalCount})`
            }
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
