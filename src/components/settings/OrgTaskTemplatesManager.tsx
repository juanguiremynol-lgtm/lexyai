/**
 * OrgTaskTemplatesManager — Admin UI to create/edit/deactivate org-wide task templates
 * Users consume these templates when creating tasks on work items.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, ListChecks } from "lucide-react";
import { toast } from "sonner";

interface OrgTemplate {
  id: string;
  organization_id: string;
  created_by: string;
  title: string;
  description: string | null;
  priority: string;
  default_cadence_days: number | null;
  category: string;
  workflow_types: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface TemplateForm {
  title: string;
  description: string;
  priority: string;
  default_cadence_days: number;
  category: string;
  workflow_types: string[];
}

const EMPTY_FORM: TemplateForm = {
  title: "",
  description: "",
  priority: "MEDIA",
  default_cadence_days: 3,
  category: "custom",
  workflow_types: [],
};

const WORKFLOW_OPTIONS = [
  { value: "CGP", label: "CGP" },
  { value: "CPACA", label: "CPACA" },
  { value: "Laboral", label: "Laboral" },
  { value: "Penal", label: "Penal" },
  { value: "Tutelas", label: "Tutelas" },
  { value: "Peticiones", label: "Peticiones" },
  { value: "Proceso Administrativo", label: "Administrativo" },
];

export function OrgTaskTemplatesManager() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["org-task-templates", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from("org_task_templates")
        .select("*")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as OrgTemplate[];
    },
    enabled: !!organization?.id,
  });

  const saveMutation = useMutation({
    mutationFn: async (input: TemplateForm & { id?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !organization?.id) throw new Error("No autenticado");

      if (input.id) {
        const { error } = await supabase
          .from("org_task_templates")
          .update({
            title: input.title,
            description: input.description || null,
            priority: input.priority,
            default_cadence_days: input.default_cadence_days,
            category: input.category,
            workflow_types: input.workflow_types,
          } as any)
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("org_task_templates")
          .insert({
            organization_id: organization.id,
            created_by: user.id,
            title: input.title,
            description: input.description || null,
            priority: input.priority,
            default_cadence_days: input.default_cadence_days,
            category: input.category,
            workflow_types: input.workflow_types,
          } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Plantilla actualizada" : "Plantilla creada");
      queryClient.invalidateQueries({ queryKey: ["org-task-templates"] });
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("org_task_templates")
        .update({ is_active } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-task-templates"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("org_task_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plantilla eliminada");
      queryClient.invalidateQueries({ queryKey: ["org-task-templates"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (t: OrgTemplate) => {
    setEditingId(t.id);
    setForm({
      title: t.title,
      description: t.description || "",
      priority: t.priority,
      default_cadence_days: t.default_cadence_days || 3,
      category: t.category,
      workflow_types: t.workflow_types || [],
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = () => {
    if (!form.title.trim()) {
      toast.error("El título es obligatorio");
      return;
    }
    saveMutation.mutate({ ...form, id: editingId || undefined });
  };

  const toggleWorkflow = (wf: string) => {
    setForm(prev => ({
      ...prev,
      workflow_types: prev.workflow_types.includes(wf)
        ? prev.workflow_types.filter(w => w !== wf)
        : [...prev.workflow_types, wf],
    }));
  };

  const PRIORITY_LABELS: Record<string, string> = { ALTA: "Alta", MEDIA: "Media", BAJA: "Baja" };
  const CATEGORY_LABELS: Record<string, string> = { milestone: "Hito", legal_term: "Término Legal", custom: "Personalizada" };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5" />
              Plantillas de Tareas
            </CardTitle>
            <CardDescription>
              Defina plantillas reutilizables que los miembros del equipo pueden usar al crear tareas.
            </CardDescription>
          </div>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Nueva Plantilla
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : templates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <ListChecks className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>No hay plantillas configuradas.</p>
            <p className="text-xs mt-1">Cree plantillas para estandarizar tareas en su equipo.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map(t => (
              <div key={t.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{t.title}</span>
                    <Badge variant="outline" className="text-xs">{CATEGORY_LABELS[t.category] || t.category}</Badge>
                    <Badge variant="secondary" className="text-xs">{PRIORITY_LABELS[t.priority]}</Badge>
                    {!t.is_active && <Badge variant="destructive" className="text-xs">Inactiva</Badge>}
                  </div>
                  {t.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.description}</p>}
                  {t.workflow_types?.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {t.workflow_types.map(wf => (
                        <Badge key={wf} variant="outline" className="text-[10px] px-1">{wf}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <Switch
                    checked={t.is_active}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: t.id, is_active: checked })}
                  />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(t.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar Plantilla" : "Nueva Plantilla de Tarea"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Título *</Label>
                <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Ej: Contestación de Demanda" />
              </div>
              <div>
                <Label>Descripción</Label>
                <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Prioridad</Label>
                  <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALTA">Alta</SelectItem>
                      <SelectItem value="MEDIA">Media</SelectItem>
                      <SelectItem value="BAJA">Baja</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Categoría</Label>
                  <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="milestone">Hito</SelectItem>
                      <SelectItem value="legal_term">Término Legal</SelectItem>
                      <SelectItem value="custom">Personalizada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cadencia (días)</Label>
                  <Input type="number" min={1} value={form.default_cadence_days} onChange={e => setForm(p => ({ ...p, default_cadence_days: parseInt(e.target.value) || 3 }))} />
                </div>
              </div>
              <div>
                <Label>Tipos de proceso (vacío = todos)</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {WORKFLOW_OPTIONS.map(wf => (
                    <Badge
                      key={wf.value}
                      variant={form.workflow_types.includes(wf.value) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleWorkflow(wf.value)}
                    >
                      {wf.label}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
                {editingId ? "Guardar Cambios" : "Crear Plantilla"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
