/**
 * Horizontal canonical phase stepper.
 * Legacy stage values are mapped onto canonical phases at render time.
 */
import { Check, FileText, Mail, Newspaper, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { clampInferredPhase, getWorkflowPhases, mapStageToCanonicalPhase } from "@/lib/workflow-phases";
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

/**
 * ITER53/B3 — a bare `YYYY-MM-DD` parses as UTC midnight and renders as the
 * previous day west of Greenwich. Judicial dates are calendar dates.
 */
function parseEventDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

export function PhaseStepper({ workflowType, currentStage, reaches, inferredPhase }: PhaseStepperProps) {
  const phases = getWorkflowPhases(workflowType);
  const mapped = mapStageToCanonicalPhase(workflowType, currentStage);
  // ITER19 B6: an inferred phase may never render the matter as earlier than
  // the phase implied by its recorded stage.
  const clampedInferred = clampInferredPhase(workflowType, currentStage, inferredPhase);
  const currentPhase = mapped ?? clampedInferred ?? null;
  const isInferred = !mapped && !!clampedInferred;
  const currentIndex = phases.findIndex((p) => p.key === currentPhase);
  // A phase cannot have been reached BEFORE an earlier phase of the same
  // sequence: a notification dated before the auto it notifies is impossible,
  // so that reach is a mis-attributed event and is not dated at all.
  const raw = new Map(reaches.map((r) => [r.phaseKey, r]));
  const reachByPhase = new Map<string, PhaseReach>();
  let floor = "";
  for (const phase of phases) {
    const r = raw.get(phase.key);
    if (!r) continue;
    if (floor && r.reachedAt.slice(0, 10) < floor) continue;
    reachByPhase.set(phase.key, r);
    floor = r.reachedAt.slice(0, 10);
  }

  return (
    <>
    <ol className="flex w-full snap-x gap-2 overflow-x-auto pb-2" aria-label="Fases del proceso">
      {phases.map((phase, i) => {
        const isDone = !phase.branch && currentIndex >= 0 && i < currentIndex && !phases[currentIndex]?.branch;
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
              phase.branch && !isCurrent && "opacity-70",
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
                {phase.branch ? " (salida)" : ""}
                {isCurrent && isInferred ? " (inferida)" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {reach ? (
                <>
                  {Icon && <Icon className="h-3 w-3" aria-label={SOURCE_LABEL[reach.source]} />}
                  <span>{format(parseEventDate(reach.reachedAt), "d MMM yyyy", { locale: es })}</span>
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
