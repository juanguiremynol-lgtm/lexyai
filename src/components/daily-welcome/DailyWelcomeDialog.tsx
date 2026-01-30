/**
 * DailyWelcomeDialog Component
 * 
 * Displays the AI-generated daily welcome message in a modal dialog.
 * Features:
 * - Shows personalized greeting with activity summary
 * - Dismiss for today option
 * - Quick stats about new activity
 * - Links to relevant work items
 */

import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Sun, 
  FileText, 
  Gavel, 
  X, 
  ChevronRight,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { useDailyWelcome, DailyWelcomeAlert } from '@/hooks/useDailyWelcome';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface WorkItemSummary {
  id: string;
  radicado: string;
  workflow_type: string;
  estados_count: number;
  actuaciones_count: number;
}

export function DailyWelcomeDialog() {
  const { 
    welcomeAlert, 
    shouldShowDialog, 
    dismissForToday, 
    isLoading,
    isBusinessDay,
    nonBusinessDayReason 
  } = useDailyWelcome();
  
  const navigate = useNavigate();

  // Don't render anything if not a business day or no dialog to show
  if (!isBusinessDay || !shouldShowDialog || !welcomeAlert) {
    return null;
  }

  const payload = welcomeAlert.payload;
  const workItems = (payload?.work_items || []) as WorkItemSummary[];
  const totalActivity = (payload?.new_estados_count || 0) + (payload?.new_actuaciones_count || 0);

  const handleWorkItemClick = (workItemId: string) => {
    dismissForToday();
    navigate(`/app/work-items/${workItemId}`);
  };

  const handleViewAllAlerts = () => {
    dismissForToday();
    navigate('/app/alerts');
  };

  const getWorkflowIcon = (type: string) => {
    switch (type) {
      case 'CGP':
      case 'LABORAL':
        return <Gavel className="h-4 w-4" />;
      case 'PETICION':
        return <FileText className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getWorkflowLabel = (type: string) => {
    const labels: Record<string, string> = {
      CGP: 'Proceso Judicial',
      LABORAL: 'Laboral',
      CPACA: 'CPACA',
      PETICION: 'Petición',
      TUTELA: 'Tutela',
      PENAL_906: 'Penal 906',
    };
    return labels[type] || type;
  };

  return (
    <Dialog open={shouldShowDialog} onOpenChange={(open) => !open && dismissForToday()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Sun className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {welcomeAlert.title.replace('🌅 ', '')}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {format(new Date(welcomeAlert.created_at), "EEEE d 'de' MMMM, yyyy", { locale: es })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] pr-4">
          {/* Activity Stats */}
          {totalActivity > 0 && (
            <div className="flex gap-3 mb-4">
              {payload?.new_estados_count ? (
                <Badge variant="secondary" className="gap-1">
                  <Calendar className="h-3 w-3" />
                  {payload.new_estados_count} estados
                </Badge>
              ) : null}
              {payload?.new_actuaciones_count ? (
                <Badge variant="secondary" className="gap-1">
                  <Gavel className="h-3 w-3" />
                  {payload.new_actuaciones_count} actuaciones
                </Badge>
              ) : null}
              {payload?.work_items_count ? (
                <Badge variant="outline" className="gap-1">
                  <FileText className="h-3 w-3" />
                  {payload.work_items_count} procesos
                </Badge>
              ) : null}
            </div>
          )}

          {/* AI Message */}
          <div className="bg-muted/50 rounded-lg p-4 mb-4">
            <p className="text-sm whitespace-pre-line leading-relaxed">
              {welcomeAlert.message}
            </p>
          </div>

          {/* Work Items with Activity */}
          {workItems.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Procesos con Actividad
                </p>
                {workItems.slice(0, 5).map((wi) => (
                  <button
                    key={wi.id}
                    onClick={() => handleWorkItemClick(wi.id)}
                    className="w-full flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors text-left group"
                  >
                    <div className="flex items-center gap-2">
                      {getWorkflowIcon(wi.workflow_type)}
                      <div>
                        <p className="text-sm font-medium">
                          {wi.radicado || 'Sin radicado'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getWorkflowLabel(wi.workflow_type)}
                          {wi.estados_count > 0 && ` • ${wi.estados_count} estados`}
                          {wi.actuaciones_count > 0 && ` • ${wi.actuaciones_count} actuaciones`}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </button>
                ))}
                {workItems.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center py-1">
                    +{workItems.length - 5} procesos más...
                  </p>
                )}
              </div>
            </>
          )}
        </ScrollArea>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={dismissForToday}
            className="w-full sm:w-auto"
          >
            <X className="h-4 w-4 mr-1" />
            Descartar por hoy
          </Button>
          <Button
            size="sm"
            onClick={handleViewAllAlerts}
            className="w-full sm:w-auto"
          >
            Ver todas las alertas
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
