/**
 * OrgAlertDefaultsManager — Admin UI to set default alert policies for new work items
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Bell, Save } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";

interface AlertDefaults {
  id?: string;
  staleness_alert_enabled: boolean;
  staleness_threshold_days: number;
  new_actuacion_alert: boolean;
  new_estado_alert: boolean;
  task_due_alert: boolean;
  alert_channels: string[];
  email_digest_enabled: boolean;
  alert_cadence_days: number;
  applies_to_workflow_types: string[];
}

const DEFAULT_VALUES: AlertDefaults = {
  staleness_alert_enabled: true,
  staleness_threshold_days: 30,
  new_actuacion_alert: true,
  new_estado_alert: true,
  task_due_alert: true,
  alert_channels: ["in_app"],
  email_digest_enabled: false,
  alert_cadence_days: 3,
  applies_to_workflow_types: [],
};

const CHANNEL_OPTIONS = [
  { value: "in_app", label: "En la app" },
  { value: "email", label: "Correo electrónico" },
];

const WORKFLOW_OPTIONS = [
  { value: "CGP", label: "CGP" },
  { value: "CPACA", label: "CPACA" },
  { value: "Laboral", label: "Laboral" },
  { value: "Penal", label: "Penal" },
  { value: "Tutelas", label: "Tutelas" },
  { value: "Peticiones", label: "Peticiones" },
  { value: "Proceso Administrativo", label: "Administrativo" },
];

export function OrgAlertDefaultsManager() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AlertDefaults>(DEFAULT_VALUES);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["org-alert-defaults", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return null;
      const { data, error } = await supabase
        .from("org_alert_defaults")
        .select("*")
        .eq("organization_id", organization.id)
        .maybeSingle();
      if (error) throw error;
      return data as (AlertDefaults & { id: string }) | null;
    },
    enabled: !!organization?.id,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        id: existing.id,
        staleness_alert_enabled: existing.staleness_alert_enabled,
        staleness_threshold_days: existing.staleness_threshold_days,
        new_actuacion_alert: existing.new_actuacion_alert,
        new_estado_alert: existing.new_estado_alert,
        task_due_alert: existing.task_due_alert,
        alert_channels: existing.alert_channels || ["in_app"],
        email_digest_enabled: existing.email_digest_enabled,
        alert_cadence_days: existing.alert_cadence_days,
        applies_to_workflow_types: existing.applies_to_workflow_types || [],
      });
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !organization?.id) throw new Error("No autenticado");

      const payload = {
        organization_id: organization.id,
        updated_by: user.id,
        staleness_alert_enabled: form.staleness_alert_enabled,
        staleness_threshold_days: form.staleness_threshold_days,
        new_actuacion_alert: form.new_actuacion_alert,
        new_estado_alert: form.new_estado_alert,
        task_due_alert: form.task_due_alert,
        alert_channels: form.alert_channels,
        email_digest_enabled: form.email_digest_enabled,
        alert_cadence_days: form.alert_cadence_days,
        applies_to_workflow_types: form.applies_to_workflow_types,
      };

      if (form.id) {
        const { error } = await supabase
          .from("org_alert_defaults")
          .update(payload as any)
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("org_alert_defaults")
          .insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Política de alertas guardada");
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ["org-alert-defaults"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const update = <K extends keyof AlertDefaults>(key: K, value: AlertDefaults[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const toggleChannel = (ch: string) => {
    const current = form.alert_channels;
    const next = current.includes(ch) ? current.filter(c => c !== ch) : [...current, ch];
    update("alert_channels", next);
  };

  const toggleWorkflow = (wf: string) => {
    const current = form.applies_to_workflow_types;
    const next = current.includes(wf) ? current.filter(w => w !== wf) : [...current, wf];
    update("applies_to_workflow_types", next);
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Cargando...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Política de Alertas por Defecto
        </CardTitle>
        <CardDescription>
          Configure las alertas que se aplican automáticamente a nuevos asuntos creados por miembros de la organización.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Alert types */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Tipos de alerta habilitados</h4>
          
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <p className="text-sm font-medium">Inactividad prolongada</p>
              <p className="text-xs text-muted-foreground">Alertar si no hay actividad en N días</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  className="w-16 h-8 text-sm"
                  value={form.staleness_threshold_days}
                  onChange={e => update("staleness_threshold_days", parseInt(e.target.value) || 30)}
                />
                <span className="text-xs text-muted-foreground">días</span>
              </div>
              <Switch
                checked={form.staleness_alert_enabled}
                onCheckedChange={v => update("staleness_alert_enabled", v)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <p className="text-sm font-medium">Nueva actuación</p>
              <p className="text-xs text-muted-foreground">Notificar cuando se registre una nueva actuación</p>
            </div>
            <Switch checked={form.new_actuacion_alert} onCheckedChange={v => update("new_actuacion_alert", v)} />
          </div>

          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <p className="text-sm font-medium">Nuevo estado</p>
              <p className="text-xs text-muted-foreground">Notificar cuando se publique un nuevo estado</p>
            </div>
            <Switch checked={form.new_estado_alert} onCheckedChange={v => update("new_estado_alert", v)} />
          </div>

          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <p className="text-sm font-medium">Vencimiento de tarea</p>
              <p className="text-xs text-muted-foreground">Recordar tareas próximas a vencer</p>
            </div>
            <Switch checked={form.task_due_alert} onCheckedChange={v => update("task_due_alert", v)} />
          </div>
        </div>

        <Separator />

        {/* Channels */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Canales de notificación</h4>
          <div className="flex gap-2">
            {CHANNEL_OPTIONS.map(ch => (
              <Badge
                key={ch.value}
                variant={form.alert_channels.includes(ch.value) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleChannel(ch.value)}
              >
                {ch.label}
              </Badge>
            ))}
          </div>

          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <p className="text-sm font-medium">Resumen diario por correo</p>
              <p className="text-xs text-muted-foreground">Enviar un resumen consolidado diario</p>
            </div>
            <Switch checked={form.email_digest_enabled} onCheckedChange={v => update("email_digest_enabled", v)} />
          </div>

          <div className="flex items-center gap-3">
            <Label className="text-sm">Cadencia de recordatorios:</Label>
            <Input
              type="number"
              min={1}
              max={30}
              className="w-16 h-8 text-sm"
              value={form.alert_cadence_days}
              onChange={e => update("alert_cadence_days", parseInt(e.target.value) || 3)}
            />
            <span className="text-xs text-muted-foreground">días</span>
          </div>
        </div>

        <Separator />

        {/* Workflow scope */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Aplica a tipos de proceso (vacío = todos)</h4>
          <div className="flex flex-wrap gap-2">
            {WORKFLOW_OPTIONS.map(wf => (
              <Badge
                key={wf.value}
                variant={form.applies_to_workflow_types.includes(wf.value) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleWorkflow(wf.value)}
              >
                {wf.label}
              </Badge>
            ))}
          </div>
        </div>

        {/* Save */}
        <Button onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? "Guardando..." : "Guardar Política"}
        </Button>
      </CardContent>
    </Card>
  );
}
