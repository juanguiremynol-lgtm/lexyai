/**
 * Deadlines Tab - Shows terms/deadlines for the work item
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Calendar, 
  Clock,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { format, differenceInDays, isPast, isFuture } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

import type { WorkItem } from "@/types/work-item";
import { WORKFLOW_TYPES } from "@/lib/workflow-constants";

interface DeadlinesTabProps {
  workItem: WorkItem & { _source?: string };
}

interface Deadline {
  id: string;
  label: string;
  date: Date | null;
  description: string;
  isOverdue: boolean;
  isPending: boolean;
  daysRemaining: number | null;
}

export function DeadlinesTab({ workItem }: DeadlinesTabProps) {
  const workflowConfig = WORKFLOW_TYPES[workItem.workflow_type];

  // Calculate deadlines based on workflow type
  const getDeadlines = (): Deadline[] => {
    const deadlines: Deadline[] = [];
    const now = new Date();

    // For Peticiones - 15 business day rule
    if (workItem.workflow_type === "PETICION" && workItem.filing_date) {
      const filingDate = new Date(workItem.filing_date);
      // Simple calculation: 15 calendar days (in reality should be business days)
      const deadline = new Date(filingDate);
      deadline.setDate(deadline.getDate() + 15);
      
      const daysRemaining = differenceInDays(deadline, now);
      
      deadlines.push({
        id: "peticion-deadline",
        label: "Plazo de Respuesta",
        date: deadline,
        description: "15 días hábiles para respuesta según Ley 1755 de 2015",
        isOverdue: isPast(deadline),
        isPending: isFuture(deadline),
        daysRemaining: daysRemaining,
      });
    }

    // For Tutelas - 10 days for first instance
    if (workItem.workflow_type === "TUTELA" && workItem.filing_date) {
      const filingDate = new Date(workItem.filing_date);
      const deadline = new Date(filingDate);
      deadline.setDate(deadline.getDate() + 10);
      
      const daysRemaining = differenceInDays(deadline, now);
      
      deadlines.push({
        id: "tutela-deadline",
        label: "Plazo Fallo Primera Instancia",
        date: deadline,
        description: "10 días para fallo de primera instancia",
        isOverdue: isPast(deadline),
        isPending: isFuture(deadline),
        daysRemaining: daysRemaining,
      });
    }

    // For CGP - auto admisorio deadline
    if (workItem.workflow_type === "CGP" && workItem.filing_date && !workItem.auto_admisorio_date) {
      const filingDate = new Date(workItem.filing_date);
      const deadline = new Date(filingDate);
      deadline.setDate(deadline.getDate() + 30); // Typical deadline
      
      const daysRemaining = differenceInDays(deadline, now);
      
      deadlines.push({
        id: "cgp-auto-admisorio",
        label: "Auto Admisorio Esperado",
        date: deadline,
        description: "Plazo estimado para auto admisorio",
        isOverdue: isPast(deadline),
        isPending: isFuture(deadline),
        daysRemaining: daysRemaining,
      });
    }

    // Add any key dates as reference
    if (workItem.auto_admisorio_date) {
      const date = new Date(workItem.auto_admisorio_date);
      deadlines.push({
        id: "auto-admisorio-received",
        label: "Auto Admisorio",
        date: date,
        description: "Fecha del auto admisorio",
        isOverdue: false,
        isPending: false,
        daysRemaining: null,
      });
    }

    return deadlines;
  };

  const deadlines = getDeadlines();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Términos y Plazos
            <Badge variant="secondary" className="ml-auto">
              {workflowConfig?.shortLabel || workItem.workflow_type}
            </Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      {deadlines.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">Sin términos pendientes</h3>
              <p className="text-muted-foreground text-sm">
                Los plazos y términos se calcularán automáticamente según el tipo de proceso
                y las fechas registradas.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {deadlines.map((deadline) => (
            <Card 
              key={deadline.id} 
              className={cn(
                "transition-colors",
                deadline.isOverdue && "border-destructive bg-destructive/5",
                deadline.isPending && deadline.daysRemaining !== null && deadline.daysRemaining <= 3 && "border-amber-500 bg-amber-50 dark:bg-amber-950/20"
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    {/* Status icon */}
                    <div className={cn(
                      "mt-0.5",
                      deadline.isOverdue && "text-destructive",
                      deadline.isPending && deadline.daysRemaining !== null && deadline.daysRemaining <= 3 && "text-amber-600",
                      !deadline.isOverdue && !deadline.isPending && "text-green-600"
                    )}>
                      {deadline.isOverdue ? (
                        <AlertTriangle className="h-5 w-5" />
                      ) : deadline.daysRemaining === null ? (
                        <CheckCircle className="h-5 w-5" />
                      ) : (
                        <Clock className="h-5 w-5" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="space-y-1">
                      <p className="font-medium">{deadline.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {deadline.description}
                      </p>
                    </div>
                  </div>

                  {/* Date and status */}
                  <div className="text-right flex-shrink-0">
                    {deadline.date && (
                      <p className="font-medium">
                        {format(deadline.date, "d 'de' MMMM, yyyy", { locale: es })}
                      </p>
                    )}
                    {deadline.daysRemaining !== null && (
                      <p className={cn(
                        "text-sm",
                        deadline.isOverdue && "text-destructive",
                        deadline.isPending && deadline.daysRemaining <= 3 && "text-amber-600",
                        deadline.isPending && deadline.daysRemaining > 3 && "text-muted-foreground"
                      )}>
                        {deadline.isOverdue 
                          ? `${Math.abs(deadline.daysRemaining)} días vencido`
                          : `${deadline.daysRemaining} días restantes`}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* CGP Terms Panel placeholder */}
      {workItem.workflow_type === "CGP" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Términos CGP Detallados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              El calculador de términos CGP estará disponible aquí para casos con auto admisorio.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
