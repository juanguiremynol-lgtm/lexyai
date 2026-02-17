/**
 * Dialog for creating a new task within a work item
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, Bell, ListChecks, FileText, Gavel } from "lucide-react";
import { useCreateTask, useOrgMembers, type CreateTaskInput } from "@/hooks/use-work-item-tasks";
import { useOrganization } from "@/contexts/OrganizationContext";
import { TASK_TEMPLATES, type TaskTemplate } from "./TaskTemplates";
import { useOrgTaskTemplates, type OrgTaskTemplate } from "@/hooks/use-org-task-templates";

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItemId: string;
}

export function CreateTaskDialog({ open, onOpenChange, workItemId }: CreateTaskDialogProps) {
  const createTask = useCreateTask();
  const { organization } = useOrganization();
  const { data: orgMembers = [] } = useOrgMembers(organization?.id);
  const { data: orgTemplates = [] } = useOrgTaskTemplates();

  // Form state
  const [mode, setMode] = useState<'custom' | 'template'>('custom');
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<'ALTA' | 'MEDIA' | 'BAJA'>('MEDIA');
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertInApp, setAlertInApp] = useState(true);
  const [alertEmail, setAlertEmail] = useState(false);
  const [alertCadence, setAlertCadence] = useState("3");

  const resetForm = () => {
    setMode('custom');
    setSelectedTemplate(null);
    setTitle("");
    setDescription("");
    setPriority('MEDIA');
    setDueDate("");
    setAssignedTo("");
    setAlertEnabled(false);
    setAlertInApp(true);
    setAlertEmail(false);
    setAlertCadence("3");
  };

  const handleTemplateSelect = (template: TaskTemplate) => {
    setSelectedTemplate(template);
    setTitle(template.label);
    setDescription(template.description);
    setAlertCadence(template.defaultCadenceDays.toString());
    setAlertEnabled(true);
    setAlertInApp(true);
  };

  const handleOrgTemplateSelect = (t: OrgTaskTemplate) => {
    setSelectedTemplate({ key: `org_${t.id}`, label: t.title, description: t.description || "", defaultCadenceDays: t.default_cadence_days || 3, category: t.category as any });
    setTitle(t.title);
    setDescription(t.description || "");
    setPriority(t.priority as any);
    setAlertCadence((t.default_cadence_days || 3).toString());
    setAlertEnabled(true);
    setAlertInApp(true);
  };

  const handleSubmit = () => {
    if (!title.trim()) return;

    const channels: string[] = [];
    if (alertInApp) channels.push('IN_APP');
    if (alertEmail) channels.push('EMAIL');

    const input: CreateTaskInput = {
      work_item_id: workItemId,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
      assigned_to: assignedTo || undefined,
      alert_enabled: alertEnabled,
      alert_channels: channels,
      alert_cadence_days: parseInt(alertCadence),
      template_key: selectedTemplate?.key,
    };

    createTask.mutate(input, {
      onSuccess: () => {
        resetForm();
        onOpenChange(false);
      },
    });
  };

  const milestoneTemplates = TASK_TEMPLATES.filter(t => t.category === 'milestone');
  const legalTermTemplates = TASK_TEMPLATES.filter(t => t.category === 'legal_term');

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Nueva Tarea
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Mode selector */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'custom' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setMode('custom'); setSelectedTemplate(null); }}
            >
              Personalizada
            </Button>
            <Button
              variant={mode === 'template' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('template')}
            >
              Desde Plantilla
            </Button>
          </div>

          {/* Template picker */}
          {mode === 'template' && (
            <div className="space-y-3">
              {/* Org templates first */}
              {orgTemplates.length > 0 && (
                <>
                  <Label className="text-sm font-medium">📋 Plantillas de la organización</Label>
                  <div className="flex flex-wrap gap-2">
                    {orgTemplates.map(t => (
                      <Badge
                        key={t.id}
                        variant={selectedTemplate?.key === `org_${t.id}` ? 'default' : 'outline'}
                        className="cursor-pointer hover:bg-primary/10 transition-colors"
                        onClick={() => handleOrgTemplateSelect(t)}
                      >
                        <ListChecks className="h-3 w-3 mr-1" />
                        {t.title}
                      </Badge>
                    ))}
                  </div>
                </>
              )}

              <Label className="text-sm font-medium">Hitos procesales</Label>
              <div className="flex flex-wrap gap-2">
                {milestoneTemplates.map(t => (
                  <Badge
                    key={t.key}
                    variant={selectedTemplate?.key === t.key ? 'default' : 'outline'}
                    className="cursor-pointer hover:bg-primary/10 transition-colors"
                    onClick={() => handleTemplateSelect(t)}
                  >
                    <FileText className="h-3 w-3 mr-1" />
                    {t.label}
                  </Badge>
                ))}
              </div>

              <Label className="text-sm font-medium">Términos legales</Label>
              <div className="flex flex-wrap gap-2">
                {legalTermTemplates.map(t => (
                  <Badge
                    key={t.key}
                    variant={selectedTemplate?.key === t.key ? 'default' : 'outline'}
                    className="cursor-pointer hover:bg-primary/10 transition-colors"
                    onClick={() => handleTemplateSelect(t)}
                  >
                    <Gavel className="h-3 w-3 mr-1" />
                    {t.label}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Title */}
          <div className="space-y-2">
            <Label>Título *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Radicar contestación de demanda"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Descripción</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalles adicionales..."
              rows={2}
            />
          </div>

          {/* Priority & Due Date row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALTA">🔴 Alta</SelectItem>
                  <SelectItem value="MEDIA">🟡 Media</SelectItem>
                  <SelectItem value="BAJA">🟢 Baja</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fecha límite</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Assignment */}
          {orgMembers.length > 1 && (
            <div className="space-y-2">
              <Label>Asignar a</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin asignar (yo)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin asignar (yo)</SelectItem>
                  {orgMembers.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name} {m.role === 'OWNER' || m.role === 'ADMIN' ? '👑' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Alert config */}
          <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Recordatorios</Label>
              </div>
              <Switch
                checked={alertEnabled}
                onCheckedChange={setAlertEnabled}
              />
            </div>

            {alertEnabled && (
              <div className="space-y-3 pl-6 animate-in slide-in-from-top-2">
                <div className="space-y-2">
                  <Label className="text-sm">Canales</Label>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={alertInApp}
                        onCheckedChange={(c) => setAlertInApp(c === true)}
                      />
                      <span className="text-sm">En la aplicación</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={alertEmail}
                        onCheckedChange={(c) => setAlertEmail(c === true)}
                      />
                      <span className="text-sm">Correo electrónico</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Frecuencia</Label>
                  <Select value={alertCadence} onValueChange={setAlertCadence}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Cada 1 día</SelectItem>
                      <SelectItem value="3">Cada 3 días</SelectItem>
                      <SelectItem value="5">Cada 5 días</SelectItem>
                      <SelectItem value="7">Cada 7 días</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || createTask.isPending}>
            {createTask.isPending ? "Creando..." : "Crear Tarea"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
