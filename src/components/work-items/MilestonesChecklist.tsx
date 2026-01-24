/**
 * MilestonesChecklist - Visual checklist of key legal milestones
 * 
 * Shows completion status for critical milestones:
 * - Filing proof (Acta/Constancia de radicación)
 * - Radicado assigned (23-digit)
 * - Auto Admisorio (when applicable)
 * - Electronic file link (OneDrive/SharePoint)
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  Circle, 
  FileText, 
  Hash, 
  Gavel, 
  Link2,
  Target,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

import type { WorkItem } from "@/types/work-item";

interface MilestonesChecklistProps {
  workItem: WorkItem;
  compact?: boolean;
}

interface Milestone {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  value?: string | null;
  linkUrl?: string | null;
  icon: typeof FileText;
  importance: "critical" | "high" | "medium";
}

export function MilestonesChecklist({ workItem, compact = false }: MilestonesChecklistProps) {
  // Define milestones based on workflow type
  const getMilestones = (): Milestone[] => {
    const baseMilestones: Milestone[] = [];
    
    // Radicado - critical for CGP/CPACA/TUTELA
    if (workItem.workflow_type === "CGP" || workItem.workflow_type === "CPACA" || workItem.workflow_type === "TUTELA") {
      baseMilestones.push({
        id: "radicado",
        label: "Número de Radicado",
        description: "23 dígitos del proceso judicial",
        completed: !!workItem.radicado && workItem.radicado.length >= 20,
        value: workItem.radicado,
        icon: Hash,
        importance: "critical",
      });
    }

    // Court/Authority - important for all judicial workflows
    if (workItem.workflow_type === "CGP" || workItem.workflow_type === "CPACA" || workItem.workflow_type === "TUTELA") {
      baseMilestones.push({
        id: "authority",
        label: "Juzgado Asignado",
        description: "Despacho de conocimiento",
        completed: !!workItem.authority_name,
        value: workItem.authority_name,
        icon: Gavel,
        importance: "high",
      });
    }

    // Auto Admisorio - for CGP (indicates FILING → PROCESS transition)
    if (workItem.workflow_type === "CGP") {
      const hasAutoAdmisorio = workItem.cgp_phase === "PROCESS" || !!workItem.auto_admisorio_date;
      baseMilestones.push({
        id: "auto_admisorio",
        label: "Auto Admisorio",
        description: hasAutoAdmisorio ? "Demanda admitida" : "Pendiente de admisión",
        completed: hasAutoAdmisorio,
        value: workItem.auto_admisorio_date 
          ? new Date(workItem.auto_admisorio_date).toLocaleDateString("es-CO") 
          : null,
        icon: Gavel,
        importance: "critical",
      });
    }

    // Electronic File - critical for document access
    if (workItem.workflow_type === "CGP" || workItem.workflow_type === "CPACA" || workItem.workflow_type === "TUTELA") {
      baseMilestones.push({
        id: "expediente",
        label: "Expediente Electrónico",
        description: "Enlace al expediente digital",
        completed: !!workItem.expediente_url,
        linkUrl: workItem.expediente_url,
        icon: Link2,
        importance: "high",
      });
    }

    // For PETICION - different milestones
    if (workItem.workflow_type === "PETICION") {
      baseMilestones.push({
        id: "filed",
        label: "Petición Radicada",
        description: "Constancia de radicación",
        completed: !!workItem.filing_date || !!workItem.radicado,
        value: workItem.radicado,
        icon: FileText,
        importance: "critical",
      });
      
      baseMilestones.push({
        id: "entity",
        label: "Entidad Receptora",
        description: "Entidad a la que se dirige",
        completed: !!workItem.authority_name,
        value: workItem.authority_name,
        icon: Gavel,
        importance: "high",
      });
    }

    // For GOV_PROCEDURE
    if (workItem.workflow_type === "GOV_PROCEDURE") {
      baseMilestones.push({
        id: "authority",
        label: "Autoridad",
        description: "Autoridad administrativa",
        completed: !!workItem.authority_name,
        value: workItem.authority_name,
        icon: Gavel,
        importance: "critical",
      });
      
      baseMilestones.push({
        id: "reference",
        label: "Número de Expediente",
        description: "Referencia del trámite",
        completed: !!workItem.radicado,
        value: workItem.radicado,
        icon: Hash,
        importance: "high",
      });
    }

    return baseMilestones;
  };

  const milestones = getMilestones();
  const completedCount = milestones.filter(m => m.completed).length;
  const allComplete = milestones.length > 0 && completedCount === milestones.length;
  const progress = milestones.length > 0 ? (completedCount / milestones.length) * 100 : 0;

  if (milestones.length === 0) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {milestones.map((milestone) => (
            <div
              key={milestone.id}
              className={cn(
                "h-2 w-2 rounded-full",
                milestone.completed ? "bg-emerald-500" : "bg-muted-foreground/30"
              )}
              title={`${milestone.label}: ${milestone.completed ? "✓" : "Pendiente"}`}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {completedCount}/{milestones.length}
        </span>
      </div>
    );
  }

  return (
    <Card className={cn(
      "transition-colors",
      allComplete && "border-emerald-500/50 bg-emerald-50/30 dark:bg-emerald-950/10"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5" />
            Hitos del Caso
          </CardTitle>
          <Badge 
            variant={allComplete ? "default" : "secondary"}
            className={cn(allComplete && "bg-emerald-500")}
          >
            {completedCount} / {milestones.length}
          </Badge>
        </div>
        
        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-2 mt-2">
          <div 
            className={cn(
              "h-2 rounded-full transition-all",
              allComplete ? "bg-emerald-500" : "bg-primary"
            )}
            style={{ width: `${progress}%` }}
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
                : milestone.importance === "critical"
                  ? "bg-amber-50/50 border-amber-200/50 dark:bg-amber-950/10 dark:border-amber-800/30"
                  : "bg-muted/30 border-dashed"
            )}
          >
            {/* Status icon */}
            {milestone.completed ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <Circle className={cn(
                "h-5 w-5 shrink-0 mt-0.5",
                milestone.importance === "critical" 
                  ? "text-amber-500" 
                  : "text-muted-foreground"
              )} />
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
                {!milestone.completed && milestone.importance === "critical" && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                    Requerido
                  </Badge>
                )}
              </div>
              
              {milestone.completed ? (
                <div className="mt-1">
                  {milestone.linkUrl ? (
                    <a
                      href={milestone.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir expediente
                    </a>
                  ) : milestone.value ? (
                    <code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {milestone.value}
                    </code>
                  ) : (
                    <span className="text-xs text-muted-foreground">Completado</span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {milestone.description}
                </p>
              )}
            </div>
          </div>
        ))}

        {allComplete && (
          <div className="text-center py-2 mt-2 border-t border-emerald-200 dark:border-emerald-800">
            <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium flex items-center justify-center gap-1">
              <CheckCircle2 className="h-4 w-4" />
              Todos los hitos completados
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
