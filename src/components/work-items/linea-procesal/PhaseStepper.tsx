/**
 * Horizontal canonical phase stepper.
 * Legacy stage values are mapped onto canonical phases at render time.
 */
import { Check, FileText, Mail, Newspaper, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getWorkflowPhases, mapStageToCanonicalPhase } from "@/lib/workflow-phases";
import type { WorkflowType } from "@/lib/workflow-constants";

export interface PhaseReach {
  phaseKey: string;
  reachedAt: string;
  source: "ACTUACION" | "ESTADO" | "CORREO" | "MANUAL";
}

const SOURCE_ICON = {
  ACTUACION: FileText,
  ESTADO: Newspaper,
  CORREO: Mail,
  MANUAL: User,
} as const;

const SOURCE_LABEL = {
  ACTUACION: "Actualizado por actuación",
  ESTADO: "Actualizado por estado electrónico",
  CORREO: "Actualizado por correo",
  MANUAL: "Actualizado manualmente",
} as const;

interface PhaseStepperProps {
  workflowType: WorkflowType;
  currentStage: string | null;
  reaches: PhaseReach[];
  /** Phase inferred from the latest event when the stored stage is unmappable. */
  inferredPhase?: string | null;
}

export function PhaseStepper({ workflowType, currentStage, reaches, inferredPhase }: PhaseStepperProps) {
  const phases = getWorkflowPhases(workflowType);
  const mapped = mapStageToCanonicalPhase(workflowType, currentStage);
  const currentPhase = mapped ?? inferredPhase ?? null;
  const isInferred = !mapped && !!inferredPhase;
  const currentIndex = phases.findIndex((p) => p.key === currentPhase);
  const reachByPhase = new Map(reaches.map((r) => [r.phaseKey, r]));

  return (
    <>
    <ol className="flex w-full snap-x gap-2 overflow-x-auto pb-2" aria-label="Fases del proceso">
      {phases.map((phase, i) => {
        const isDone = currentIndex >= 0 && i < currentIndex;
        const isCurrent = i === currentIndex;
        const reach = reachByPhase.get(phase.key);
        const Icon = reach ? SOURCE_ICON[reach.source] : null;
        return (
          <li
            key={phase.key}
            className={cn(
              "flex min-w-[8.5rem] flex-1 shrink-0 snap-start flex-col gap-1 rounded-md border px-3 py-2",
              isCurrent && "border-primary bg-primary/10",
              isDone && "border-border bg-muted/50",
              !isCurrent && !isDone && "border-dashed border-border/60",
            )}
            aria-current={isCurrent ? "step" : undefined}
          >
            <div className="flex items-center gap-1.5">
              {isDone ? (
                <Check className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              ) : (
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px]",
                    isCurrent ? "border-primary text-primary" : "border-muted-foreground/40 text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
              )}
              <span
                className={cn(
                  "truncate text-xs font-medium",
                  isCurrent ? "text-primary" : isDone ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {phase.label}
                {isCurrent && isInferred ? " (inferida)" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {reach ? (
                <>
                  {Icon && <Icon className="h-3 w-3" aria-label={SOURCE_LABEL[reach.source]} />}
                  <span>{format(new Date(reach.reachedAt), "d MMM yyyy", { locale: es })}</span>
                </>
              ) : (
                <span aria-hidden>—</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
    {isInferred && (
      <p className="text-[11px] text-muted-foreground">
        Fase inferida a partir de la última actuación o estado; la etapa registrada no es concluyente.
      </p>
    )}
    </>
  );
}
