/**
 * MilestonesChecklist - Visual checklist of key legal milestones
 * 
 * Shows completion status for critical milestones:
 * - Filing proof (Acta/Constancia de radicación)
 * - Radicado assigned (23-digit)
 * - Auto Admisorio (when applicable)
 * - Electronic file link (OneDrive/SharePoint)
 * 
 * Enhanced with "Set Now" buttons to complete milestones and auto-complete reminders.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  CheckCircle2, 
  Circle, 
  FileText, 
  Hash, 
  Gavel, 
  Link2,
  Target,
  ExternalLink,
  Plus,
  Calendar as CalendarIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";

import type { WorkItem } from "@/types/work-item";
import { useCompleteReminder, useSyncReminders } from "@/hooks/use-work-item-reminders";
import { isValidRadicado } from "@/lib/reminders/reminder-service";

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
  editable?: boolean;
  reminderType?: string;
}

type MilestoneModalType = 'acta_reparto' | 'radicado' | 'auto_admisorio' | 'expediente' | null;

// Milestones that can be toggled with one click (no required data entry)
const ONE_CLICK_MILESTONES = new Set(['acta_reparto', 'auto_admisorio']);

export function MilestonesChecklist({ workItem, compact = false }: MilestonesChecklistProps) {
  const queryClient = useQueryClient();
  const [activeModal, setActiveModal] = useState<MilestoneModalType>(null);
  
  // Form state
  const [actaDate, setActaDate] = useState('');
  const [actaNotes, setActaNotes] = useState('');
  const [radicado, setRadicado] = useState('');
  const [autoAdmisorioDate, setAutoAdmisorioDate] = useState('');
  const [autoAdmisorioRef, setAutoAdmisorioRef] = useState('');
  const [expedienteUrl, setExpedienteUrl] = useState('');
  
  const syncReminders = useSyncReminders();
  
  // Mutation to update work item
  const updateMilestoneMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const source = (workItem as any)._source || 'work_items';
      
      // Update based on source table
      if (source === 'work_items') {
        const { error } = await supabase
          .from('work_items')
          .update(updates)
          .eq('id', workItem.id);
        if (error) throw error;
      } else if (source === 'cgp_items') {
        // Map fields for legacy table
        const legacyUpdates: Record<string, any> = {};
        if (updates.authority_name) legacyUpdates.court_name = updates.authority_name;
        if (updates.radicado) legacyUpdates.radicado = updates.radicado;
        if (updates.auto_admisorio_date) legacyUpdates.auto_admisorio_date = updates.auto_admisorio_date;
        if (updates.expediente_url) legacyUpdates.expediente_url = updates.expediente_url;
        if (updates.acta_reparto_received_at) legacyUpdates.acta_reparto_received_at = updates.acta_reparto_received_at;
        
        const { error } = await supabase
          .from('cgp_items')
          .update(legacyUpdates)
          .eq('id', workItem.id);
        if (error) throw error;
      } else if (source === 'cpaca_processes') {
        const legacyUpdates: Record<string, any> = {};
        if (updates.radicado) legacyUpdates.radicado = updates.radicado;
        if (updates.auto_admisorio_date) legacyUpdates.fecha_auto_admisorio = updates.auto_admisorio_date;
        
        const { error } = await supabase
          .from('cpaca_processes')
          .update(legacyUpdates)
          .eq('id', workItem.id);
        if (error) throw error;
      }
      
      return updates;
    },
    onSuccess: async (updates) => {
      toast.success("Hito actualizado correctamente");
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["cgp-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["cpaca-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["tutelas-work-items"] });
      
      // Sync reminders to auto-complete if milestone is now done
      const updatedWorkItem = {
        ...workItem,
        ...updates,
      };
      await syncReminders.mutateAsync(updatedWorkItem);
      
      setActiveModal(null);
      resetForms();
    },
    onError: (error: Error) => {
      toast.error("Error al actualizar: " + error.message);
    },
  });
  
  const resetForms = () => {
    setActaDate('');
    setActaNotes('');
    setRadicado('');
    setAutoAdmisorioDate('');
    setAutoAdmisorioRef('');
    setExpedienteUrl('');
  };
  
  const handleSubmitActaReparto = () => {
    if (!actaDate) {
      toast.error("Ingresa la fecha del acta de reparto");
      return;
    }
    updateMilestoneMutation.mutate({
      acta_reparto_received_at: new Date(actaDate).toISOString(),
      acta_reparto_notes: actaNotes || null,
    });
  };
  
  const handleSubmitRadicado = () => {
    if (!radicado) {
      toast.error("Ingresa el número de radicado");
      return;
    }
    if (!isValidRadicado(radicado)) {
      toast.error("El radicado debe tener 23 dígitos y terminar en 00 o 01");
      return;
    }
    updateMilestoneMutation.mutate({
      radicado,
      radicado_verified: true,
    });
  };
  
  const handleSubmitAutoAdmisorio = () => {
    if (!autoAdmisorioDate) {
      toast.error("Ingresa la fecha del auto admisorio");
      return;
    }
    updateMilestoneMutation.mutate({
      auto_admisorio_date: new Date(autoAdmisorioDate).toISOString(),
    });
  };
  
  const handleSubmitExpediente = () => {
    if (!expedienteUrl) {
      toast.error("Ingresa el enlace del expediente");
      return;
    }
    // Basic URL validation
    try {
      new URL(expedienteUrl);
    } catch {
      toast.error("Ingresa un enlace válido (URL completa)");
      return;
    }
    updateMilestoneMutation.mutate({
      expediente_url: expedienteUrl,
    });
  };
  
  // Define milestones based on workflow type
  const getMilestones = (): Milestone[] => {
    const baseMilestones: Milestone[] = [];
    const wt = workItem.workflow_type;
    
    // Acta de Reparto - for judicial workflows
    if (wt === "CGP" || wt === "CPACA" || wt === "TUTELA" || wt === "LABORAL") {
      const hasActa = !!(workItem as any).acta_reparto_received_at || !!workItem.authority_name;
      baseMilestones.push({
        id: "acta_reparto",
        label: "Acta de Reparto",
        description: "Constancia de radicación ante el juzgado",
        completed: hasActa,
        value: workItem.authority_name || ((workItem as any).acta_reparto_received_at 
          ? `Recibida ${format(new Date((workItem as any).acta_reparto_received_at), 'dd/MM/yyyy')}`
          : null),
        icon: FileText,
        importance: "critical",
        editable: !hasActa,
        reminderType: 'ACTA_REPARTO_PENDING',
      });
    }
    
    // Radicado - critical for CGP/CPACA/TUTELA/LABORAL
    if (wt === "CGP" || wt === "CPACA" || wt === "TUTELA" || wt === "LABORAL") {
      const hasRadicado = isValidRadicado(workItem.radicado);
      baseMilestones.push({
        id: "radicado",
        label: "Número de Radicado",
        description: "23 dígitos del proceso judicial",
        completed: hasRadicado,
        value: workItem.radicado,
        icon: Hash,
        importance: "critical",
        editable: !hasRadicado,
        reminderType: 'RADICADO_PENDING',
      });
    }

    // Electronic file - for judicial workflows
    if (wt === "CGP" || wt === "CPACA" || wt === "TUTELA" || wt === "LABORAL") {
      baseMilestones.push({
        id: "expediente",
        label: "Expediente Electrónico",
        description: "Enlace al expediente digital",
        completed: !!workItem.expediente_url,
        linkUrl: workItem.expediente_url,
        icon: Link2,
        importance: "high",
        editable: !workItem.expediente_url,
        reminderType: 'EXPEDIENTE_PENDING',
      });
    }

    // Auto Admisorio - for CGP/CPACA/TUTELA/LABORAL
    if (wt === "CGP" || wt === "CPACA" || wt === "TUTELA" || wt === "LABORAL") {
      const hasAutoAdmisorio = workItem.cgp_phase === "PROCESS" || !!workItem.auto_admisorio_date;
      baseMilestones.push({
        id: "auto_admisorio",
        label: "Auto Admisorio",
        description: hasAutoAdmisorio ? "Demanda admitida" : "Pendiente de admisión",
        completed: hasAutoAdmisorio,
        value: workItem.auto_admisorio_date 
          ? format(new Date(workItem.auto_admisorio_date), 'dd/MM/yyyy')
          : null,
        icon: Gavel,
        importance: "critical",
        editable: !hasAutoAdmisorio,
        reminderType: 'AUTO_ADMISORIO_PENDING',
      });
    }

    // For PETICION - different milestones (no reminders)
    if (wt === "PETICION") {
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
    if (wt === "GOV_PROCEDURE") {
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

  // Quick-toggle milestone with one click (defaults to today's date)
  const handleQuickToggle = (milestoneId: string, currentlyCompleted: boolean) => {
    if (currentlyCompleted) {
      // Uncheck: clear the field
      if (milestoneId === 'acta_reparto') {
        updateMilestoneMutation.mutate({ acta_reparto_received_at: null, acta_reparto_notes: null });
      } else if (milestoneId === 'auto_admisorio') {
        updateMilestoneMutation.mutate({ auto_admisorio_date: null });
      }
    } else {
      // Check: set to today
      const today = new Date().toISOString();
      if (milestoneId === 'acta_reparto') {
        updateMilestoneMutation.mutate({ acta_reparto_received_at: today });
      } else if (milestoneId === 'auto_admisorio') {
        updateMilestoneMutation.mutate({ auto_admisorio_date: today });
      }
    }
  };

  const openMilestoneModal = (milestoneId: string) => {
    if (milestoneId === 'acta_reparto') setActiveModal('acta_reparto');
    else if (milestoneId === 'radicado') setActiveModal('radicado');
    else if (milestoneId === 'auto_admisorio') setActiveModal('auto_admisorio');
    else if (milestoneId === 'expediente') setActiveModal('expediente');
  };

  return (
    <>
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
              {/* Status icon - clickable for one-click milestones */}
              {ONE_CLICK_MILESTONES.has(milestone.id) ? (
                <button
                  type="button"
                  onClick={() => handleQuickToggle(milestone.id, milestone.completed)}
                  disabled={updateMilestoneMutation.isPending}
                  className="shrink-0 mt-0.5 cursor-pointer hover:scale-110 transition-transform disabled:opacity-50"
                  title={milestone.completed ? "Desmarcar" : "Marcar como completado (hoy)"}
                >
                  {milestone.completed ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Circle className={cn(
                      "h-5 w-5",
                      milestone.importance === "critical" ? "text-amber-500" : "text-muted-foreground"
                    )} />
                  )}
                </button>
              ) : milestone.completed ? (
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
                  <div className="mt-1 flex items-center gap-2">
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
                    {/* Allow editing details even when completed */}
                    {ONE_CLICK_MILESTONES.has(milestone.id) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 text-[10px] px-1.5"
                        onClick={() => openMilestoneModal(milestone.id)}
                      >
                        Editar fecha
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {milestone.description}
                    </p>
                    {milestone.editable && !ONE_CLICK_MILESTONES.has(milestone.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => openMilestoneModal(milestone.id)}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Registrar
                      </Button>
                    )}
                    {milestone.editable && ONE_CLICK_MILESTONES.has(milestone.id) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => openMilestoneModal(milestone.id)}
                      >
                        Con fecha específica
                      </Button>
                    )}
                  </div>
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
      
      {/* Acta de Reparto Modal */}
      <Dialog open={activeModal === 'acta_reparto'} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Acta de Reparto</DialogTitle>
            <DialogDescription>
              Ingresa la fecha en que recibiste la constancia de radicación.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="acta-date">Fecha del Acta *</Label>
              <Input
                id="acta-date"
                type="date"
                value={actaDate}
                onChange={(e) => setActaDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acta-notes">Notas (opcional)</Label>
              <Textarea
                id="acta-notes"
                placeholder="Observaciones adicionales..."
                value={actaNotes}
                onChange={(e) => setActaNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveModal(null)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmitActaReparto}
              disabled={updateMilestoneMutation.isPending}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Radicado Modal */}
      <Dialog open={activeModal === 'radicado'} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Número de Radicado</DialogTitle>
            <DialogDescription>
              Ingresa el número de radicado de 23 dígitos del proceso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="radicado">Número de Radicado *</Label>
              <Input
                id="radicado"
                placeholder="11001310300120230012300"
                value={radicado}
                onChange={(e) => setRadicado(e.target.value.replace(/[^0-9]/g, ''))}
                maxLength={23}
              />
              <p className="text-xs text-muted-foreground">
                23 dígitos, termina en 00 o 01
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveModal(null)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmitRadicado}
              disabled={updateMilestoneMutation.isPending}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Auto Admisorio Modal */}
      <Dialog open={activeModal === 'auto_admisorio'} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Auto Admisorio</DialogTitle>
            <DialogDescription>
              Ingresa la fecha del auto de admisión de la demanda.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="auto-date">Fecha del Auto *</Label>
              <Input
                id="auto-date"
                type="date"
                value={autoAdmisorioDate}
                onChange={(e) => setAutoAdmisorioDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auto-ref">Referencia (opcional)</Label>
              <Input
                id="auto-ref"
                placeholder="Número o referencia del auto..."
                value={autoAdmisorioRef}
                onChange={(e) => setAutoAdmisorioRef(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveModal(null)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmitAutoAdmisorio}
              disabled={updateMilestoneMutation.isPending}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Expediente Modal */}
      <Dialog open={activeModal === 'expediente'} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Expediente Electrónico</DialogTitle>
            <DialogDescription>
              Ingresa el enlace al expediente digital (OneDrive, SharePoint, etc.).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="expediente-url">Enlace del Expediente *</Label>
              <Input
                id="expediente-url"
                type="url"
                placeholder="https://..."
                value={expedienteUrl}
                onChange={(e) => setExpedienteUrl(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveModal(null)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmitExpediente}
              disabled={updateMilestoneMutation.isPending}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
