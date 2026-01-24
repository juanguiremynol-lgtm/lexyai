/**
 * Deadlines Tab - Shows terms/deadlines for the work item
 * Supports CPACA with first-class deadline management
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  Calendar, 
  Clock,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Info,
  Calculator,
} from "lucide-react";
import { format, differenceInDays, isPast, isFuture } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useCpacaDeadlines } from "@/hooks/use-cpaca-deadlines";
import { supabase } from "@/integrations/supabase/client";

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
  urgencyLabel?: string;
  urgencyColor?: string;
  isCpaca?: boolean;
  deadlineType?: string;
  triggerEvent?: string;
  businessDaysCount?: number;
}

export function DeadlinesTab({ workItem }: DeadlinesTabProps) {
  const workflowConfig = WORKFLOW_TYPES[workItem.workflow_type];
  const isCpaca = workItem.workflow_type === "CPACA";
  
  // Use CPACA deadlines hook for CPACA items
  const { 
    deadlines: cpacaDeadlines, 
    isLoading: isCpacaLoading,
    recalculate,
    isRecalculating,
    markAsMet,
    isMarkingMet,
  } = useCpacaDeadlines(isCpaca ? workItem.id : undefined);

  // Fetch work_item_deadlines from database
  const { data: dbDeadlines, isLoading: isDbLoading } = useQuery({
    queryKey: ["work-item-deadlines", workItem.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_item_deadlines")
        .select("*")
        .eq("work_item_id", workItem.id)
        .order("deadline_date", { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!workItem.id,
  });

  // Calculate legacy deadlines based on workflow type
  const getLegacyDeadlines = (): Deadline[] => {
    const deadlines: Deadline[] = [];
    const now = new Date();

    // For Peticiones - 15 business day rule
    if (workItem.workflow_type === "PETICION" && workItem.filing_date) {
      const filingDate = new Date(workItem.filing_date);
      const deadline = new Date(filingDate);
      deadline.setDate(deadline.getDate() + 21); // Approx 15 business days
      
      const daysRemaining = differenceInDays(deadline, now);
      
      deadlines.push({
        id: "peticion-deadline",
        label: "Plazo de Respuesta",
        date: deadline,
        description: "15 días hábiles para respuesta según Ley 1755 de 2015",
        isOverdue: isPast(deadline),
        isPending: isFuture(deadline),
        daysRemaining: daysRemaining,
        urgencyLabel: daysRemaining < 0 ? "VENCIDO" : daysRemaining <= 3 ? "URGENTE" : undefined,
        urgencyColor: daysRemaining < 0 ? "destructive" : daysRemaining <= 3 ? "warning" : undefined,
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
        urgencyLabel: daysRemaining < 0 ? "VENCIDO" : daysRemaining <= 2 ? "URGENTE" : undefined,
        urgencyColor: daysRemaining < 0 ? "destructive" : daysRemaining <= 2 ? "warning" : undefined,
      });
    }

    // For CGP - auto admisorio deadline
    if (workItem.workflow_type === "CGP" && workItem.filing_date && !workItem.auto_admisorio_date) {
      const filingDate = new Date(workItem.filing_date);
      const deadline = new Date(filingDate);
      deadline.setDate(deadline.getDate() + 30);
      
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

    return deadlines;
  };

  // Convert CPACA deadlines from hook to Deadline format
  const getCpacaFormattedDeadlines = (): Deadline[] => {
    if (!cpacaDeadlines || cpacaDeadlines.length === 0) return [];
    
    return cpacaDeadlines.map(d => ({
      id: d.id,
      label: d.label,
      date: new Date(d.deadline_date),
      description: d.description || "",
      isOverdue: d.business_days_remaining < 0,
      isPending: d.business_days_remaining >= 0,
      daysRemaining: d.business_days_remaining,
      urgencyLabel: d.urgency.label,
      urgencyColor: d.urgency.color,
      isCpaca: true,
      deadlineType: d.deadline_type,
      triggerEvent: d.trigger_event,
      businessDaysCount: d.business_days_count || undefined,
    }));
  };

  // Convert DB deadlines to Deadline format
  const getDbFormattedDeadlines = (): Deadline[] => {
    if (!dbDeadlines || dbDeadlines.length === 0) return [];
    const now = new Date();
    
    return dbDeadlines
      .filter(d => d.status === "PENDING")
      .map(d => {
        const deadlineDate = new Date(d.deadline_date);
        const daysRemaining = differenceInDays(deadlineDate, now);
        
        return {
          id: d.id,
          label: d.label,
          date: deadlineDate,
          description: d.description || "",
          isOverdue: isPast(deadlineDate),
          isPending: isFuture(deadlineDate),
          daysRemaining,
          urgencyLabel: daysRemaining < 0 ? "VENCIDO" : daysRemaining <= 1 ? "CRÍTICO" : daysRemaining <= 3 ? "URGENTE" : daysRemaining <= 5 ? "PRÓXIMO" : undefined,
          urgencyColor: daysRemaining < 0 ? "destructive" : daysRemaining <= 3 ? "warning" : undefined,
          isCpaca: workItem.workflow_type === "CPACA",
          deadlineType: d.deadline_type,
          triggerEvent: d.trigger_event,
          businessDaysCount: d.business_days_count || undefined,
        };
      });
  };

  // Combine all deadlines
  const getAllDeadlines = (): Deadline[] => {
    // For CPACA, prefer the enhanced deadlines from the hook
    if (isCpaca && cpacaDeadlines.length > 0) {
      return getCpacaFormattedDeadlines();
    }
    
    // Check DB deadlines
    const fromDb = getDbFormattedDeadlines();
    if (fromDb.length > 0) {
      return fromDb;
    }
    
    // Fallback to legacy calculation
    return getLegacyDeadlines();
  };

  const deadlines = getAllDeadlines();
  const isLoading = isCpacaLoading || isDbLoading;

  // Add completed milestone dates as reference
  const completedDates: Deadline[] = [];
  if (workItem.auto_admisorio_date) {
    completedDates.push({
      id: "auto-admisorio-received",
      label: "Auto Admisorio",
      date: new Date(workItem.auto_admisorio_date),
      description: "Fecha del auto admisorio",
      isOverdue: false,
      isPending: false,
      daysRemaining: null,
    });
  }

  const getUrgencyBadge = (deadline: Deadline) => {
    if (!deadline.urgencyLabel) return null;
    
    const variants: Record<string, "destructive" | "secondary" | "outline"> = {
      destructive: "destructive",
      warning: "secondary",
    };
    
    return (
      <Badge variant={variants[deadline.urgencyColor || ""] || "outline"} className="text-xs">
        {deadline.urgencyLabel}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
        </Card>
        {[1, 2].map(i => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Términos y Plazos
                <Badge variant="secondary" className="ml-2">
                  {workflowConfig?.shortLabel || workItem.workflow_type}
                </Badge>
              </CardTitle>
              
              {isCpaca && (
                <div className="flex gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => recalculate()}
                        disabled={isRecalculating}
                      >
                        <RefreshCw className={cn("h-4 w-4 mr-2", isRecalculating && "animate-spin")} />
                        Recalcular
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Recalcular plazos considerando días hábiles y festivos colombianos
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          </CardHeader>
        </Card>

        {deadlines.length === 0 && completedDates.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold mb-2">Sin términos pendientes</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Los plazos y términos se calcularán automáticamente según el tipo de proceso
                  y las fechas registradas.
                </p>
                {isCpaca && (
                  <Button variant="outline" onClick={() => recalculate()} disabled={isRecalculating}>
                    <Calculator className="h-4 w-4 mr-2" />
                    Generar Plazos CPACA
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Pending deadlines */}
            {deadlines.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Plazos Pendientes ({deadlines.length})
                </h3>
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
                            !deadline.isOverdue && deadline.daysRemaining !== null && deadline.daysRemaining > 3 && "text-muted-foreground"
                          )}>
                            {deadline.isOverdue ? (
                              <AlertTriangle className="h-5 w-5" />
                            ) : (
                              <Clock className="h-5 w-5" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">{deadline.label}</p>
                              {getUrgencyBadge(deadline)}
                              {deadline.isCpaca && (
                                <Badge variant="outline" className="text-xs">
                                  CPACA
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {deadline.description}
                            </p>
                            {deadline.businessDaysCount && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Info className="h-3 w-3" />
                                Calculado con {deadline.businessDaysCount} días hábiles
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Date and actions */}
                        <div className="text-right flex-shrink-0 space-y-2">
                          {deadline.date && (
                            <>
                              <p className="font-medium">
                                {format(deadline.date, "d 'de' MMMM, yyyy", { locale: es })}
                              </p>
                              {deadline.daysRemaining !== null && (
                                <p className={cn(
                                  "text-sm",
                                  deadline.isOverdue && "text-destructive",
                                  deadline.isPending && deadline.daysRemaining <= 3 && "text-amber-600",
                                  deadline.isPending && deadline.daysRemaining > 3 && "text-muted-foreground"
                                )}>
                                  {deadline.isOverdue 
                                    ? `${Math.abs(deadline.daysRemaining)} días vencido`
                                    : `${deadline.daysRemaining} días hábiles`}
                                </p>
                              )}
                            </>
                          )}
                          
                          {deadline.isCpaca && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => markAsMet(deadline.id)}
                              disabled={isMarkingMet}
                              className="text-xs"
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Cumplido
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Completed dates as reference */}
            {completedDates.length > 0 && (
              <div className="space-y-3 mt-6">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Fechas Registradas
                </h3>
                {completedDates.map((item) => (
                  <Card key={item.id} className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CheckCircle className="h-5 w-5 text-green-600" />
                          <div>
                            <p className="font-medium">{item.label}</p>
                            <p className="text-sm text-muted-foreground">{item.description}</p>
                          </div>
                        </div>
                        {item.date && (
                          <p className="font-medium">
                            {format(item.date, "d 'de' MMMM, yyyy", { locale: es })}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* CPACA Info Card */}
        {isCpaca && (
          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="h-4 w-4" />
                Cálculo de Términos CPACA
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>• <strong>Art. 199 CPACA:</strong> 2 días hábiles desde notificación electrónica + día siguiente</p>
              <p>• <strong>Traslado demanda:</strong> 30 días hábiles (+15 si prórroga)</p>
              <p>• <strong>Reforma demanda:</strong> 10 días hábiles después del traslado</p>
              <p>• <strong>Traslado excepciones:</strong> 3 días hábiles</p>
              <p>• <strong>Apelación sentencia:</strong> 10 días hábiles</p>
              <p>• <strong>Apelación auto:</strong> 3 días hábiles</p>
            </CardContent>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}
