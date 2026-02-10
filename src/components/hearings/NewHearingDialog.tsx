/**
 * NewHearingDialog — Create a hearing linked to a work item.
 * Wires into alert_instances + email_outbox via hearing-alerts.ts.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2, Video } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createHearingAlerts } from "@/lib/hearing-alerts";

interface NewHearingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultWorkItemId?: string;
}

export function NewHearingDialog({ open, onOpenChange, defaultWorkItemId }: NewHearingDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [workItemId, setWorkItemId] = useState<string>(defaultWorkItemId || "");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("09:00");
  const [location, setLocation] = useState("");
  const [isVirtual, setIsVirtual] = useState(false);
  const [virtualLink, setVirtualLink] = useState("");
  const [teamsLink, setTeamsLink] = useState("");
  const [notes, setNotes] = useState("");
  const [emailAlerts, setEmailAlerts] = useState(false);

  // Fetch work items for dropdown
  const { data: workItems } = useQuery({
    queryKey: ["work-items-dropdown-hearings"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return [];

      const { data, error } = await supabase
        .from("work_items")
        .select("id, title, radicado, workflow_type, demandantes, demandados, authority_name")
        .eq("owner_id", user.user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!date) throw new Error("Seleccione una fecha");
      if (!title.trim()) throw new Error("Ingrese un título");

      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      // Get user profile for email + org
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id, reminder_email, default_alert_email, email_reminders_enabled")
        .eq("id", user.user.id)
        .single();

      // Build scheduled_at
      const [hours, minutes] = time.split(":").map(Number);
      const scheduledAt = new Date(date);
      scheduledAt.setHours(hours, minutes, 0, 0);

      const orgId = profile?.organization_id || null;

      // Insert hearing
      const { data: hearing, error } = await supabase
        .from("hearings")
        .insert({
          owner_id: user.user.id,
          title: title.trim(),
          scheduled_at: scheduledAt.toISOString(),
          location: location.trim() || null,
          is_virtual: isVirtual,
          virtual_link: isVirtual ? virtualLink.trim() || null : null,
          teams_link: teamsLink.trim() || null,
          notes: notes.trim() || null,
          work_item_id: workItemId || null,
          organization_id: orgId,
        })
        .select()
        .single();

      if (error) throw error;

      // Create alerts
      const alertEmail = profile?.reminder_email || profile?.default_alert_email || user.user.email;
      const shouldEmail = emailAlerts && (profile?.email_reminders_enabled !== false) && !!alertEmail;

      await createHearingAlerts({
        ownerId: user.user.id,
        hearingId: hearing.id,
        workItemId: workItemId || null,
        organizationId: orgId,
        title: title.trim(),
        scheduledAt,
        location: location.trim() || null,
        isVirtual,
        virtualLink: isVirtual ? virtualLink.trim() || null : null,
        emailEnabled: shouldEmail,
        userEmail: shouldEmail ? alertEmail : null,
        reminderHoursBefore: [24, 1],
      });

      return hearing;
    },
    onSuccess: () => {
      toast.success("Audiencia creada exitosamente");
      queryClient.invalidateQueries({ queryKey: ["hearings"] });
      resetForm();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Error al crear audiencia");
    },
  });

  const resetForm = () => {
    setTitle("");
    setWorkItemId(defaultWorkItemId || "");
    setDate(undefined);
    setTime("09:00");
    setLocation("");
    setIsVirtual(false);
    setVirtualLink("");
    setTeamsLink("");
    setNotes("");
    setEmailAlerts(false);
  };

  const canSubmit = title.trim() && date && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Audiencia</DialogTitle>
          <DialogDescription>
            Programe una audiencia y reciba alertas automáticas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="hearing-title">Título *</Label>
            <Input
              id="hearing-title"
              placeholder="Ej: Audiencia inicial — Proceso García vs EPS"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Work Item */}
          <div className="space-y-2">
            <Label>Proceso vinculado</Label>
            <Select value={workItemId || "__none__"} onValueChange={(v) => setWorkItemId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccione un proceso (opcional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin vincular</SelectItem>
                {workItems?.map((wi) => {
                  const parties = wi.demandantes || wi.demandados || "";
                  const label = wi.radicado || wi.title || wi.id.slice(0, 8);
                  return (
                    <SelectItem key={wi.id} value={wi.id}>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{label}</span>
                          {wi.workflow_type && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                              {wi.workflow_type}
                            </span>
                          )}
                        </div>
                        {parties && (
                          <span className="text-xs text-muted-foreground truncate max-w-[350px]">
                            {parties}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fecha *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground",
                  )}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP", { locale: es }) : "Seleccionar"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={setDate} locale={es}
                    disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hearing-time">Hora</Label>
              <Input id="hearing-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          {/* Virtual toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="is-virtual">Audiencia virtual</Label>
            <Switch id="is-virtual" checked={isVirtual} onCheckedChange={setIsVirtual} />
          </div>

          {/* Location or Virtual Link */}
          {isVirtual ? (
            <div className="space-y-2">
              <Label htmlFor="virtual-link">Enlace de videoconferencia</Label>
              <Input id="virtual-link" placeholder="https://meet.google.com/..." value={virtualLink}
                onChange={(e) => setVirtualLink(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="location">Lugar</Label>
              <Input id="location" placeholder="Ej: Juzgado 3 Civil, Piso 2" value={location}
                onChange={(e) => setLocation(e.target.value)} />
            </div>
          )}

          {/* Videoconference Link (Teams, Meet, Zoom, etc.) */}
          <div className="space-y-2">
            <Label htmlFor="teams-link" className="flex items-center gap-2">
              <Video className="h-4 w-4" />
              Enlace de audiencia virtual (Teams, Meet, Zoom, etc.)
            </Label>
            <Input
              id="teams-link"
              type="url"
              placeholder="https://teams.microsoft.com/... o meet.google.com/... o zoom.us/..."
              value={teamsLink}
              onChange={(e) => setTeamsLink(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Se mostrará un aviso en el dashboard cuando llegue el día y hora de la audiencia.
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="hearing-notes">Notas</Label>
            <Textarea id="hearing-notes" placeholder="Observaciones adicionales..." value={notes}
              onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {/* Email alerts toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
            <div>
              <p className="text-sm font-medium">Alertas por email</p>
              <p className="text-xs text-muted-foreground">Recibir recordatorio 24h y 1h antes</p>
            </div>
            <Switch checked={emailAlerts} onCheckedChange={setEmailAlerts} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {createMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creando...</>
            ) : (
              "Crear Audiencia"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
