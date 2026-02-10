import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar, Clock, Video, MapPin, AlertTriangle, Video as TeamsIcon } from "lucide-react";
import { toast } from "sonner";
import type { ProcessPhase } from "@/lib/constants";

interface HearingPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItemId: string;
  radicado: string | null;
  targetPhase: ProcessPhase;
  onComplete: () => void;
}

const HEARING_PHASES: ProcessPhase[] = [
  "PENDIENTE_AUDIENCIA_INICIAL",
  "PENDIENTE_AUDIENCIA_INSTRUCCION",
  "PENDIENTE_ALEGATOS_SENTENCIA",
];

const PHASE_HEARING_TITLES: Record<string, string> = {
  PENDIENTE_AUDIENCIA_INICIAL: "Audiencia Inicial",
  PENDIENTE_AUDIENCIA_INSTRUCCION: "Audiencia de Instrucción y Juzgamiento",
  PENDIENTE_ALEGATOS_SENTENCIA: "Audiencia de Alegatos y Sentencia",
};

export function HearingPromptDialog({
  open,
  onOpenChange,
  workItemId,
  radicado,
  targetPhase,
  onComplete,
}: HearingPromptDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    title: PHASE_HEARING_TITLES[targetPhase] || "Audiencia",
    scheduled_at: "",
    scheduled_time: "08:00",
    location: "",
    notes: "",
    is_virtual: false,
    virtual_link: "",
    teams_link: "",
  });

  const createHearingMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const scheduledAt = new Date(`${formData.scheduled_at}T${formData.scheduled_time}`);

      // Create the hearing linked to work_item
      const { error: hearingError } = await supabase.from("hearings").insert({
        work_item_id: workItemId,
        owner_id: user.id,
        title: formData.title,
        scheduled_at: scheduledAt.toISOString(),
        location: formData.location || null,
        notes: formData.notes || null,
        is_virtual: formData.is_virtual,
        virtual_link: formData.virtual_link || null,
        teams_link: formData.teams_link || null,
        auto_detected: false,
        reminder_sent: false,
      });

      if (hearingError) throw hearingError;

      // Create an alert for the hearing
      const daysUntil = Math.ceil((scheduledAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      
      const { error: alertError } = await supabase.from("alert_instances").insert({
        owner_id: user.id,
        entity_type: "work_item",
        entity_id: workItemId,
        severity: daysUntil <= 3 ? "critical" : daysUntil <= 7 ? "warn" : "info",
        title: `${formData.title} programada`,
        message: `${formData.title} programada para ${scheduledAt.toLocaleDateString('es-CO')} - Radicado: ${radicado || "Sin radicado"}`,
        status: "active",
      });

      if (alertError) console.error("Error creating alert:", alertError);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-hearings"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alert-instances"] });
      toast.success("Audiencia programada y alerta creada");
      onComplete();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const isHearingPhase = HEARING_PHASES.includes(targetPhase);

  if (!isHearingPhase) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Programar Audiencia
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              El proceso <span className="font-mono font-semibold">{radicado}</span> ha sido
              clasificado a la fase <span className="font-semibold">{PHASE_HEARING_TITLES[targetPhase]}</span>.
            </span>
            <span className="block text-amber-600 dark:text-amber-500 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              Por favor ingresa la fecha y hora de la audiencia para recibir recordatorios.
            </span>
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createHearingMutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="title">Título de la audiencia</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Ej: Audiencia inicial"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Fecha</Label>
              <Input
                id="date"
                type="date"
                value={formData.scheduled_at}
                onChange={(e) => setFormData({ ...formData, scheduled_at: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Hora</Label>
              <Input
                id="time"
                type="time"
                value={formData.scheduled_time}
                onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="is_virtual"
              checked={formData.is_virtual}
              onCheckedChange={(checked) => setFormData({ ...formData, is_virtual: checked })}
            />
            <Label htmlFor="is_virtual" className="flex items-center gap-2">
              <Video className="h-4 w-4" />
              Audiencia virtual
            </Label>
          </div>

          {formData.is_virtual ? (
            <div className="space-y-2">
              <Label htmlFor="virtual_link">Enlace de la reunión</Label>
              <Input
                id="virtual_link"
                type="url"
                value={formData.virtual_link}
                onChange={(e) => setFormData({ ...formData, virtual_link: e.target.value })}
                placeholder="https://..."
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="location" className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Ubicación
              </Label>
              <Input
                id="location"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="Ej: Palacio de Justicia, Sala 301"
              />
            </div>
          )}

          {/* Videoconference Link */}
          <div className="space-y-2">
            <Label htmlFor="teams_link" className="flex items-center gap-2">
              <Video className="h-4 w-4" />
              Enlace de audiencia virtual (Teams, Meet, Zoom, etc.)
            </Label>
            <Input
              id="teams_link"
              type="url"
              value={formData.teams_link}
              onChange={(e) => setFormData({ ...formData, teams_link: e.target.value })}
              placeholder="https://teams.microsoft.com/... o meet.google.com/... o zoom.us/..."
            />
            <p className="text-xs text-muted-foreground">
              Se mostrará un aviso en el dashboard cuando llegue el día y hora.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notas</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Notas adicionales sobre la audiencia..."
              rows={2}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onComplete();
                onOpenChange(false);
              }}
            >
              Omitir por ahora
            </Button>
            <Button type="submit" disabled={createHearingMutation.isPending}>
              <Calendar className="h-4 w-4 mr-2" />
              Programar Audiencia
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { HEARING_PHASES, PHASE_HEARING_TITLES };
