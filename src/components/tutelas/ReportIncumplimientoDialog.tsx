import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, Loader2, CalendarIcon, Bell, Gavel } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, addBusinessDays } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { TutelaItem } from "./TutelaCard";

interface ReportIncumplimientoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tutela: TutelaItem | null;
}

export function ReportIncumplimientoDialog({
  open,
  onOpenChange,
  tutela,
}: ReportIncumplimientoDialogProps) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [incumplimientoDate, setIncumplimientoDate] = useState<Date>(new Date());
  const [createDesacato, setCreateDesacato] = useState(true);
  const [createReminders, setCreateReminders] = useState(true);

  const createIncumplimientoMutation = useMutation({
    mutationFn: async () => {
      if (!tutela) throw new Error("No tutela selected");

      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const userId = user.user.id;
      let desacatoId: string | null = null;

      // Step 1: Update work_item with compliance info
      const { error: workItemError } = await supabase
        .from("work_items")
        .update({
          notes: `${tutela.notes || ""}\n\n[INCUMPLIMIENTO ${incumplimientoDate.toISOString()}] ${notes}`.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", tutela.id);

      if (workItemError) throw workItemError;

      // Step 2: Create desacato incident if selected
      if (createDesacato) {
        const { data: desacatoData, error: desacatoError } = await supabase
          .from("desacato_incidents")
          .insert({
            tutela_id: tutela.id,
            owner_id: userId,
            phase: "DESACATO_RADICACION",
            notes: notes.trim() || null,
            incumplimiento_reportado: true,
            incumplimiento_date: incumplimientoDate.toISOString(),
            incumplimiento_notes: notes.trim() || null,
            radicacion_date: new Date().toISOString().split("T")[0],
          })
          .select("id")
          .single();

        if (desacatoError) throw desacatoError;
        desacatoId = desacatoData.id;
      }

      // Step 3: Create reminder alerts if selected
      if (createReminders) {
        const reminderDays = [1, 3]; // +1 day and +3 days
        const alertPromises = reminderDays.map(async (days) => {
          const fireAt = addBusinessDays(new Date(), days);
          
          // Create alert rule
          const { error: ruleError } = await supabase
            .from("alert_rules")
            .insert({
              owner_id: userId,
              entity_type: "TUTELA",
              entity_id: tutela.id,
              rule_kind: "DESACATO_REMINDER",
              title: `Recordatorio: Desacato tutela +${days} día${days > 1 ? "s" : ""}`,
              description: `Seguimiento al incidente de desacato para tutela ${tutela.radicado || "sin radicado"}`,
              first_fire_at: fireAt.toISOString(),
              next_fire_at: fireAt.toISOString(),
              channels: ["IN_APP"],
              active: true,
            });

          if (ruleError) console.error("Error creating alert rule:", ruleError);

          // Create alert instance
          const { error: instanceError } = await supabase
            .from("alert_instances")
            .insert({
              owner_id: userId,
              entity_type: "TUTELA",
              entity_id: tutela.id,
              title: `Seguimiento Desacato +${days}d`,
              message: `Han pasado ${days} día${days > 1 ? "s" : ""} desde que se reportó incumplimiento. Verifique avance del incidente de desacato para: ${tutela.demandantes || "Accionante"} vs ${tutela.demandados || "Accionado"}`,
              severity: days === 1 ? "INFO" : "WARN",
              status: "PENDING",
              fired_at: fireAt.toISOString(),
            });

          if (instanceError) console.error("Error creating alert instance:", instanceError);
        });

        await Promise.all(alertPromises);
      }

      // Step 4: Create critical alert for immediate attention
      const { error: alertError } = await supabase.from("alerts").insert({
        owner_id: userId,
        severity: "CRITICAL",
        message: `⚠️ INCUMPLIMIENTO REPORTADO: Tutela ${tutela.radicado || ""} - ${tutela.demandantes || "Accionante"} vs ${tutela.demandados || "Accionado"}. ${createDesacato ? "Incidente de desacato iniciado." : ""}`,
      });

      if (alertError) console.error("Error creating alert:", alertError);

      return { desacatoId, createDesacato };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["desacatos"] });
      queryClient.invalidateQueries({ queryKey: ["tutelas"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alert-instances"] });
      
      const message = result.createDesacato
        ? "Incumplimiento reportado e incidente de desacato iniciado"
        : "Incumplimiento reportado correctamente";
      
      toast.success(message);
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      toast.error("Error al reportar incumplimiento: " + error.message);
    },
  });

  const resetForm = () => {
    setNotes("");
    setIncumplimientoDate(new Date());
    setCreateDesacato(true);
    setCreateReminders(true);
  };

  const handleSubmit = () => {
    createIncumplimientoMutation.mutate();
  };

  if (!tutela) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
            Reportar Incumplimiento de Fallo
          </DialogTitle>
          <DialogDescription>
            Marque este fallo como no cumplido por el accionado para activar el proceso de desacato.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Tutela info */}
          <div className="bg-muted/50 p-3 rounded-lg space-y-1">
            <p className="text-sm font-medium flex items-center gap-2">
              <Gavel className="h-4 w-4 text-purple-500" />
              Tutela origen:
            </p>
            <p className="text-sm text-muted-foreground font-mono">
              {tutela.radicado || "Sin radicado"}
            </p>
            {tutela.demandantes && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Accionante:</span> {tutela.demandantes}
              </p>
            )}
            {tutela.demandados && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Accionado:</span> {tutela.demandados}
              </p>
            )}
            {tutela.courtName && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Juzgado:</span> {tutela.courtName}
              </p>
            )}
          </div>

          {/* Date picker */}
          <div className="space-y-2">
            <Label>Fecha de reporte de incumplimiento</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !incumplimientoDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {incumplimientoDate ? (
                    format(incumplimientoDate, "PPP", { locale: es })
                  ) : (
                    "Seleccionar fecha"
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={incumplimientoDate}
                  onSelect={(date) => date && setIncumplimientoDate(date)}
                  initialFocus
                  locale={es}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Motivo del incumplimiento</Label>
            <Textarea
              id="notes"
              placeholder="Describa los hechos que evidencian el incumplimiento del fallo..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Options */}
          <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
            <Label className="text-sm font-medium">Acciones automáticas</Label>
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="createDesacato"
                checked={createDesacato}
                onCheckedChange={(checked) => setCreateDesacato(!!checked)}
              />
              <label
                htmlFor="createDesacato"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
              >
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Iniciar incidente de desacato automáticamente
              </label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="createReminders"
                checked={createReminders}
                onCheckedChange={(checked) => setCreateReminders(!!checked)}
              />
              <label
                htmlFor="createReminders"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
              >
                <Bell className="h-4 w-4 text-blue-500" />
                Crear recordatorios (+1 día, +3 días)
              </label>
            </div>
          </div>

          {/* Warning box */}
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-400 font-medium">
              ⚠️ Esta acción no se puede deshacer
            </p>
            <p className="text-xs text-red-600 dark:text-red-500 mt-1">
              Al reportar incumplimiento, se creará un registro permanente y se activará
              el seguimiento del incidente de desacato en el pipeline.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetForm();
            }}
            disabled={createIncumplimientoMutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createIncumplimientoMutation.isPending}
            className="bg-red-600 hover:bg-red-700"
          >
            {createIncumplimientoMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <AlertTriangle className="h-4 w-4 mr-2" />
            )}
            Reportar Incumplimiento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
