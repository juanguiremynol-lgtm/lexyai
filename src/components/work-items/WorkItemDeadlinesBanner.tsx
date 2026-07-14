/**
 * WorkItemDeadlinesBanner
 *
 * Shows active deadlines for a work item. Highlights when any deadline
 * is within ≤3 business days of expiring (WARNING) or overdue (CRITICAL).
 * Sourced from the local term engine (`work_item_deadlines`).
 */
import { useWorkItemDeadlines, businessDaysUntil, type WorkItemDeadline } from "@/hooks/use-work-item-deadlines";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlarmClock, AlertTriangle, Info } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Props {
  workItemId: string;
}

function deadlineTone(d: WorkItemDeadline): "critical" | "warning" | "info" | "review" {
  if (d.status === "REQUIERE_REVISION_MANUAL") return "review";
  if (d.status !== "PENDING") return "info";
  const bd = businessDaysUntil(d.deadline_date);
  if (bd <= 0) return "critical";
  if (bd <= 3) return "warning";
  return "info";
}

export function WorkItemDeadlinesBanner({ workItemId }: Props) {
  const { data: deadlines = [], isLoading } = useWorkItemDeadlines(workItemId);
  if (isLoading || deadlines.length === 0) return null;

  const active = deadlines.filter((d) => d.status === "PENDING" || d.status === "REQUIERE_REVISION_MANUAL");
  if (active.length === 0) return null;

  const worst = active.reduce<WorkItemDeadline>((acc, d) => {
    const rank = { critical: 3, warning: 2, review: 1, info: 0 } as const;
    return rank[deadlineTone(d)] > rank[deadlineTone(acc)] ? d : acc;
  }, active[0]);
  const tone = deadlineTone(worst);

  const toneClass =
    tone === "critical"
      ? "border-destructive/60 bg-destructive/10 text-destructive-foreground"
      : tone === "warning"
      ? "border-amber-500/60 bg-amber-500/10"
      : tone === "review"
      ? "border-blue-500/60 bg-blue-500/10"
      : "border-muted bg-muted/20";

  const Icon = tone === "critical" || tone === "warning" ? AlertTriangle : tone === "review" ? Info : AlarmClock;

  return (
    <Alert className={cn("mb-4", toneClass)}>
      <Icon className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2">
        Términos procesales activos
        <Badge variant="secondary">{active.length}</Badge>
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-2 space-y-2">
          {active.slice(0, 5).map((d) => {
            const bd = businessDaysUntil(d.deadline_date);
            const isReview = d.status === "REQUIERE_REVISION_MANUAL";
            return (
              <li key={d.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{d.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.calculation_meta?.norma ?? "—"} · ancla:{" "}
                    {d.calculation_meta?.anchor_source === "DESPACHO" ? "despacho" : "fijación estado"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {isReview ? (
                    <Badge variant="outline" className="border-blue-500 text-blue-700 dark:text-blue-300">
                      Requiere revisión manual
                    </Badge>
                  ) : (
                    <>
                      <div className="font-semibold">
                        {format(new Date(d.deadline_date + "T00:00:00"), "d MMM yyyy", { locale: es })}
                      </div>
                      <div
                        className={cn(
                          "text-xs",
                          bd <= 0
                            ? "text-destructive font-semibold"
                            : bd <= 3
                            ? "text-amber-600 dark:text-amber-400 font-semibold"
                            : "text-muted-foreground"
                        )}
                      >
                        {bd < 0
                          ? `Vencido hace ${Math.abs(bd)} día${Math.abs(bd) === 1 ? "" : "s"}`
                          : bd === 0
                          ? "Vence hoy"
                          : `En ${bd} día${bd === 1 ? "" : "s"} hábil${bd === 1 ? "" : "es"}`}
                      </div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {active.length > 5 && (
          <p className="mt-2 text-xs text-muted-foreground">+ {active.length - 5} término(s) adicional(es)</p>
        )}
      </AlertDescription>
    </Alert>
  );
}