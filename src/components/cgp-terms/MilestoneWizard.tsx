/**
 * Milestone Registration Wizard
 * 
 * A step-by-step wizard for registering CGP milestones with dates
 * and triggering the creation of corresponding terms.
 */

import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar as CalendarIcon, Check, ChevronRight, AlertTriangle, Gavel } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCreateMilestone } from "@/hooks/use-cgp-terms";
import { CgpMilestoneType, MILESTONE_LABELS } from "@/lib/cgp-terms-engine";

interface MilestoneWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filingId?: string;
  processId?: string;
  ownerId: string;
  suggestedMilestones?: CgpMilestoneType[];
  onComplete?: () => void;
}

interface MilestoneEntry {
  type: CgpMilestoneType;
  occurred: boolean;
  eventDate: Date | undefined;
  inAudience: boolean;
  notes: string;
}

const COMMON_MILESTONES: CgpMilestoneType[] = [
  'AUTO_ADMISORIO_NOTIFICADO',
  'MANDAMIENTO_EJECUTIVO_NOTIFICADO',
  'TRASLADO_DEMANDA_NOTIFICADO',
  'CONTESTACION_PRESENTADA',
  'AUDIENCIA_CELEBRADA',
];

export function MilestoneWizard({
  open,
  onOpenChange,
  filingId,
  processId,
  ownerId,
  suggestedMilestones = COMMON_MILESTONES,
  onComplete,
}: MilestoneWizardProps) {
  const [step, setStep] = useState(0);
  const [entries, setEntries] = useState<MilestoneEntry[]>(() =>
    suggestedMilestones.map((type) => ({
      type,
      occurred: false,
      eventDate: undefined,
      inAudience: false,
      notes: '',
    }))
  );
  const [saving, setSaving] = useState(false);

  const createMilestone = useCreateMilestone();

  const currentEntry = entries[step];
  const isLastStep = step === entries.length - 1;
  const hasOccurredMilestones = entries.some((e) => e.occurred);

  const updateEntry = (updates: Partial<MilestoneEntry>) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === step ? { ...e, ...updates } : e))
    );
  };

  const handleNext = () => {
    if (isLastStep) {
      handleSave();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    setStep((s) => Math.max(0, s - 1));
  };

  const handleSkip = () => {
    onOpenChange(false);
  };

  const handleSave = async () => {
    setSaving(true);
    
    // Save all occurred milestones
    for (const entry of entries) {
      if (entry.occurred && entry.eventDate) {
        await createMilestone.mutateAsync({
          ownerId,
          milestone: {
            filing_id: filingId || null,
            process_id: processId || null,
            milestone_type: entry.type,
            occurred: true,
            event_date: format(entry.eventDate, 'yyyy-MM-dd'),
            in_audience: entry.inAudience,
            notes: entry.notes || null,
          },
        });
      }
    }

    setSaving(false);
    onOpenChange(false);
    onComplete?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-primary" />
            Registrar Hitos CGP
          </DialogTitle>
          <DialogDescription>
            Paso {step + 1} de {entries.length} — Registre los hitos procesales para calcular términos
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="flex gap-1 mb-4">
          {entries.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < step ? "bg-primary" : i === step ? "bg-primary/50" : "bg-muted"
              )}
            />
          ))}
        </div>

        <div className="space-y-6 py-4">
          {/* Milestone question */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">
                ¿Ocurrió: {MILESTONE_LABELS[currentEntry.type]}?
              </Label>
              <Switch
                checked={currentEntry.occurred}
                onCheckedChange={(checked) => updateEntry({ occurred: checked })}
              />
            </div>

            {currentEntry.occurred && (
              <>
                {/* Date picker */}
                <div className="space-y-2">
                  <Label>Fecha del hito</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !currentEntry.eventDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {currentEntry.eventDate ? (
                          format(currentEntry.eventDate, "PPP", { locale: es })
                        ) : (
                          "Seleccione una fecha"
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={currentEntry.eventDate}
                        onSelect={(date) => updateEntry({ eventDate: date })}
                        disabled={(date) => date > new Date()}
                        locale={es}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* In audience switch */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>¿Ocurrió en audiencia?</Label>
                    <p className="text-xs text-muted-foreground">
                      Si fue en audiencia, el término empieza inmediatamente
                    </p>
                  </div>
                  <Switch
                    checked={currentEntry.inAudience}
                    onCheckedChange={(checked) => updateEntry({ inAudience: checked })}
                  />
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  <Label>Notas (opcional)</Label>
                  <Textarea
                    placeholder="Información adicional sobre el hito..."
                    value={currentEntry.notes}
                    onChange={(e) => updateEntry({ notes: e.target.value })}
                    rows={2}
                  />
                </div>

                {/* Warning if no date */}
                {currentEntry.occurred && !currentEntry.eventDate && (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Se requiere fecha para calcular términos
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={handleSkip} disabled={saving}>
            Omitir por ahora
          </Button>
          <div className="flex gap-2 ml-auto">
            {step > 0 && (
              <Button variant="outline" onClick={handleBack} disabled={saving}>
                Anterior
              </Button>
            )}
            <Button
              onClick={handleNext}
              disabled={saving || (currentEntry.occurred && !currentEntry.eventDate)}
            >
              {saving ? (
                "Guardando..."
              ) : isLastStep ? (
                <>
                  <Check className="h-4 w-4 mr-1" />
                  Guardar
                </>
              ) : (
                <>
                  Siguiente
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </DialogFooter>

        {/* Summary badges */}
        {hasOccurredMilestones && (
          <div className="border-t pt-4 mt-2">
            <p className="text-xs text-muted-foreground mb-2">Hitos marcados como ocurridos:</p>
            <div className="flex flex-wrap gap-1">
              {entries
                .filter((e) => e.occurred)
                .map((e) => (
                  <Badge key={e.type} variant="secondary" className="text-xs">
                    {MILESTONE_LABELS[e.type]}
                    {e.eventDate && ` • ${format(e.eventDate, 'dd/MM/yy')}`}
                  </Badge>
                ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
