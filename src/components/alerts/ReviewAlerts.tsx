import { useEffect, useState } from "react";
import { useReviewChecks } from "@/hooks/use-review-checks";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, RefreshCw, Clock } from "lucide-react";
import { Link } from "react-router-dom";

export function ReviewAlerts() {
  const { checkResult, generateReviewTasks } = useReviewChecks();
  const [dismissed, setDismissed] = useState(false);

  // Auto-generate tasks on first load
  useEffect(() => {
    if (checkResult && !dismissed) {
      const totalNeeding = 
        (checkResult.processesNeedingReview || 0) + 
        (checkResult.filingsNeedingReview || 0);
      
      // Auto-generate if there are items needing review
      if (totalNeeding > 0 || checkResult.estadosImportDue) {
        generateReviewTasks.mutate();
      }
    }
  }, [checkResult?.processesNeedingReview, checkResult?.filingsNeedingReview]);

  if (!checkResult) return null;

  const { processesNeedingReview, filingsNeedingReview, estadosImportDue } = checkResult;
  const totalNeeding = processesNeedingReview + filingsNeedingReview;

  if (totalNeeding === 0 && !estadosImportDue) return null;
  if (dismissed) return null;

  return (
    <div className="space-y-3">
      {totalNeeding > 0 && (
        <Alert variant="default" className="border-status-warning/50 bg-status-warning/10">
          <Clock className="h-4 w-4" />
          <AlertTitle className="flex items-center gap-2">
            Revisión Semanal Pendiente
            <Badge variant="secondary">{totalNeeding}</Badge>
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {processesNeedingReview > 0 && `${processesNeedingReview} proceso(s)`}
              {processesNeedingReview > 0 && filingsNeedingReview > 0 && " y "}
              {filingsNeedingReview > 0 && `${filingsNeedingReview} radicación(es)`}
              {" "}sin revisar en los últimos 7 días.
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/tasks">Ver Tareas</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {estadosImportDue && (
        <Alert variant="default" className="border-primary/50 bg-primary/10">
          <FileSpreadsheet className="h-4 w-4" />
          <AlertTitle>Importación de Estados Pendiente</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>Ha pasado más de 2 semanas desde la última importación de estados.</span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings?tab=estados">Importar Ahora</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
