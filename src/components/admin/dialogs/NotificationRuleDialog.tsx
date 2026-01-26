/**
 * Notification Rule Dialog
 * Create/edit notification rules for organization email alerts
 */

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  createNotificationRule,
  updateNotificationRule,
} from "@/lib/email-notifications/notification-rules-service";
import {
  TRIGGER_EVENTS,
  RECIPIENT_MODES,
  SEVERITY_LEVELS,
  ALERT_CATEGORIES,
  WORKFLOW_TYPES,
  type NotificationRule,
  type NotificationRuleFormData,
  type TriggerEvent,
  type RecipientMode,
  type Severity,
} from "@/lib/email-notifications/types";

interface NotificationRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  rule?: NotificationRule | null;
}

export function NotificationRuleDialog({
  open,
  onOpenChange,
  organizationId,
  rule,
}: NotificationRuleDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = !!rule;
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [triggerEvent, setTriggerEvent] = useState<TriggerEvent>("ON_ALERT_CREATE");
  const [severityMin, setSeverityMin] = useState<Severity>("WARNING");
  const [workflowTypes, setWorkflowTypes] = useState<string[]>([]);
  const [alertCategories, setAlertCategories] = useState<string[]>([]);
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("OWNER");
  const [recipientEmails, setRecipientEmails] = useState<string>("");
  const [useRecipientDirectory, setUseRecipientDirectory] = useState(false);
  const [dedupeWindowMinutes, setDedupeWindowMinutes] = useState(60);
  const [maxPer10Min, setMaxPer10Min] = useState(10);
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (rule) {
        setName(rule.name);
        setDescription(rule.description || "");
        setEnabled(rule.enabled);
        setTriggerEvent(rule.trigger_event);
        setSeverityMin(rule.severity_min);
        setWorkflowTypes(rule.workflow_types || []);
        setAlertCategories(rule.alert_categories || []);
        setRecipientMode(rule.recipient_mode);
        setRecipientEmails(rule.recipient_emails?.join(", ") || "");
        setUseRecipientDirectory(rule.use_recipient_directory);
        setDedupeWindowMinutes(rule.dedupe_window_minutes);
        setMaxPer10Min(rule.max_per_10min);
        setSubjectTemplate(rule.subject_template || "");
        setBodyTemplate(rule.body_template || "");
      } else {
        setName("");
        setDescription("");
        setEnabled(true);
        setTriggerEvent("ON_ALERT_CREATE");
        setSeverityMin("WARNING");
        setWorkflowTypes([]);
        setAlertCategories([]);
        setRecipientMode("OWNER");
        setRecipientEmails("");
        setUseRecipientDirectory(false);
        setDedupeWindowMinutes(60);
        setMaxPer10Min(10);
        setSubjectTemplate("");
        setBodyTemplate("");
      }
    }
  }, [open, rule]);

  const toggleWorkflowType = (wt: string) => {
    setWorkflowTypes((prev) =>
      prev.includes(wt) ? prev.filter((x) => x !== wt) : [...prev, wt]
    );
  };

  const toggleAlertCategory = (cat: string) => {
    setAlertCategories((prev) =>
      prev.includes(cat) ? prev.filter((x) => x !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("El nombre es requerido");
      return;
    }

    setSaving(true);
    try {
      const formData: NotificationRuleFormData = {
        name: name.trim(),
        description: description.trim() || undefined,
        enabled,
        trigger_event: triggerEvent,
        severity_min: severityMin,
        workflow_types: workflowTypes,
        alert_categories: alertCategories,
        recipient_mode: recipientMode,
        recipient_emails: recipientEmails
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
        use_recipient_directory: useRecipientDirectory,
        dedupe_window_minutes: dedupeWindowMinutes,
        max_per_10min: maxPer10Min,
        subject_template: subjectTemplate.trim() || undefined,
        body_template: bodyTemplate.trim() || undefined,
      };

      if (isEditing && rule) {
        await updateNotificationRule(rule.id, formData);
        toast.success("Regla actualizada");
      } else {
        await createNotificationRule(organizationId, formData);
        toast.success("Regla creada");
      }

      queryClient.invalidateQueries({ queryKey: ["notification-rules", organizationId] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Error: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar Regla de Notificación" : "Nueva Regla de Notificación"}
          </DialogTitle>
          <DialogDescription>
            Configure cuándo y a quién enviar notificaciones por email
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label>Nombre *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Alertas críticas a administradores"
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <Label>Activa</Label>
              </div>
            </div>

            <div>
              <Label>Descripción</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descripción opcional de la regla"
                rows={2}
              />
            </div>
          </div>

          {/* Trigger */}
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium">Disparador</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Evento</Label>
                <Select value={triggerEvent} onValueChange={(v) => setTriggerEvent(v as TriggerEvent)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_EVENTS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Severidad mínima</Label>
                <Select value={severityMin} onValueChange={(v) => setSeverityMin(v as Severity)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_LEVELS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium">Filtros</h4>
            <div>
              <Label className="mb-2 block">Tipos de procedimiento (vacío = todos)</Label>
              <div className="flex flex-wrap gap-2">
                {WORKFLOW_TYPES.map((wt) => (
                  <Badge
                    key={wt.value}
                    variant={workflowTypes.includes(wt.value) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleWorkflowType(wt.value)}
                  >
                    {wt.label}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-2 block">Categorías de alerta (vacío = todas)</Label>
              <div className="flex flex-wrap gap-2">
                {ALERT_CATEGORIES.map((cat) => (
                  <Badge
                    key={cat.value}
                    variant={alertCategories.includes(cat.value) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleAlertCategory(cat.value)}
                  >
                    {cat.label}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Recipients */}
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium">Destinatarios</h4>
            <div>
              <Label>Modo de destinatario</Label>
              <Select value={recipientMode} onValueChange={(v) => setRecipientMode(v as RecipientMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECIPIENT_MODES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      <div>
                        <span>{r.label}</span>
                        <span className="text-xs text-muted-foreground ml-2">{r.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {recipientMode === "SPECIFIC" && (
              <div>
                <Label>Emails (separados por coma)</Label>
                <Textarea
                  value={recipientEmails}
                  onChange={(e) => setRecipientEmails(e.target.value)}
                  placeholder="admin@firma.com, abogado@firma.com"
                  rows={2}
                />
              </div>
            )}

            {recipientMode === "DISTRIBUTION" && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="useDirectory"
                  checked={useRecipientDirectory}
                  onCheckedChange={(c) => setUseRecipientDirectory(!!c)}
                />
                <Label htmlFor="useDirectory">
                  Usar directorio de destinatarios de la organización
                </Label>
              </div>
            )}
          </div>

          {/* Throttling */}
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium">Control de frecuencia</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Ventana de deduplicación (minutos)</Label>
                <Input
                  type="number"
                  value={dedupeWindowMinutes}
                  onChange={(e) => setDedupeWindowMinutes(Number(e.target.value))}
                  min={0}
                  max={1440}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  No repetir el mismo email dentro de este período
                </p>
              </div>
              <div>
                <Label>Máximo emails por 10 min</Label>
                <Input
                  type="number"
                  value={maxPer10Min}
                  onChange={(e) => setMaxPer10Min(Number(e.target.value))}
                  min={1}
                  max={100}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Límite de tasa para esta regla
                </p>
              </div>
            </div>
          </div>

          {/* Templates (optional) */}
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium">Plantillas (opcional)</h4>
            <div>
              <Label>Asunto personalizado</Label>
              <Input
                value={subjectTemplate}
                onChange={(e) => setSubjectTemplate(e.target.value)}
                placeholder="[ATENIA] {{alert_title}}"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Variables: {"{{alert_title}}, {{work_item_title}}, {{severity}}"}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando..." : isEditing ? "Actualizar" : "Crear Regla"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
