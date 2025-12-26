import { useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar, Plus, Pencil, Trash2, AlertTriangle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  useAllJudicialSuspensions,
  useCreateJudicialSuspension,
  useUpdateJudicialSuspension,
  useDeleteJudicialSuspension,
} from "@/hooks/use-judicial-suspensions";
import { JudicialTermSuspension, SuspensionScope } from "@/lib/judicial-suspensions";
import { isAfter, isBefore, isWithinInterval, startOfDay } from "date-fns";

const SCOPE_LABELS: Record<SuspensionScope, string> = {
  GLOBAL_JUDICIAL: "Global (todos los asuntos judiciales)",
  BY_JURISDICTION: "Por jurisdicción/ciudad",
  BY_COURT: "Por juzgado específico",
};

interface FormData {
  title: string;
  reason: string;
  start_date: string;
  end_date: string;
  scope: SuspensionScope;
  scope_value: string;
  active: boolean;
}

const initialFormData: FormData = {
  title: "",
  reason: "",
  start_date: "",
  end_date: "",
  scope: "GLOBAL_JUDICIAL",
  scope_value: "",
  active: true,
};

export function JudicialSuspensionsSettings() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSuspension, setEditingSuspension] = useState<JudicialTermSuspension | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(initialFormData);

  const { data: suspensions = [], isLoading } = useAllJudicialSuspensions();
  const createMutation = useCreateJudicialSuspension();
  const updateMutation = useUpdateJudicialSuspension();
  const deleteMutation = useDeleteJudicialSuspension();

  const openCreateDialog = () => {
    setEditingSuspension(null);
    setFormData(initialFormData);
    setIsDialogOpen(true);
  };

  const openEditDialog = (suspension: JudicialTermSuspension) => {
    setEditingSuspension(suspension);
    setFormData({
      title: suspension.title,
      reason: suspension.reason || "",
      start_date: suspension.start_date,
      end_date: suspension.end_date,
      scope: suspension.scope,
      scope_value: suspension.scope_value || "",
      active: suspension.active,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.title || !formData.start_date || !formData.end_date) {
      toast.error("Título y fechas son requeridos");
      return;
    }

    if (formData.scope !== "GLOBAL_JUDICIAL" && !formData.scope_value) {
      toast.error("Debe especificar el valor del alcance");
      return;
    }

    const payload = {
      title: formData.title,
      reason: formData.reason || undefined,
      start_date: formData.start_date,
      end_date: formData.end_date,
      scope: formData.scope,
      scope_value: formData.scope !== "GLOBAL_JUDICIAL" ? formData.scope_value : undefined,
      active: formData.active,
    };

    if (editingSuspension) {
      const result = await updateMutation.mutateAsync({ id: editingSuspension.id, data: payload });
      if (result.success) {
        toast.success("Suspensión actualizada");
        setIsDialogOpen(false);
      } else {
        toast.error(result.error || "Error al actualizar");
      }
    } else {
      const result = await createMutation.mutateAsync(payload);
      if (result.success) {
        toast.success("Suspensión creada");
        setIsDialogOpen(false);
      } else {
        toast.error(result.error || "Error al crear");
      }
    }
  };

  const handleDelete = async (id: string) => {
    const result = await deleteMutation.mutateAsync(id);
    if (result.success) {
      toast.success("Suspensión eliminada");
    } else {
      toast.error(result.error || "Error al eliminar");
    }
    setDeleteConfirmId(null);
  };

  const getStatusBadge = (suspension: JudicialTermSuspension) => {
    const today = startOfDay(new Date());
    const start = startOfDay(parseISO(suspension.start_date));
    const end = startOfDay(parseISO(suspension.end_date));

    if (!suspension.active) {
      return <Badge variant="outline" className="text-muted-foreground">Inactiva</Badge>;
    }

    if (isWithinInterval(today, { start, end })) {
      return <Badge className="bg-amber-500 hover:bg-amber-600">En curso</Badge>;
    }

    if (isBefore(today, start)) {
      return <Badge variant="secondary">Programada</Badge>;
    }

    if (isAfter(today, end)) {
      return <Badge variant="outline" className="text-muted-foreground">Finalizada</Badge>;
    }

    return null;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Suspensión de Términos Judiciales
              </CardTitle>
              <CardDescription>
                Configure períodos donde los términos judiciales no corren (ej. vacancia judicial, paros)
              </CardDescription>
            </div>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Crear suspensión
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium mb-1">Importante: Solo afecta asuntos judiciales</p>
                <p>
                  Las suspensiones aquí configuradas <strong>NO</strong> afectan los términos de 
                  Peticiones ni procesos administrativos, los cuales siguen corriendo con su régimen propio.
                </p>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Cargando...</div>
          ) : suspensions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>No hay suspensiones configuradas</p>
              <p className="text-sm mt-1">Cree una suspensión para configurar períodos de vacancia judicial</p>
            </div>
          ) : (
            <div className="space-y-3">
              {suspensions.map((suspension) => (
                <div
                  key={suspension.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{suspension.title}</span>
                      {getStatusBadge(suspension)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {format(parseISO(suspension.start_date), "d 'de' MMMM yyyy", { locale: es })} — {" "}
                      {format(parseISO(suspension.end_date), "d 'de' MMMM yyyy", { locale: es })}
                    </div>
                    {suspension.reason && (
                      <p className="text-sm text-muted-foreground">{suspension.reason}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Alcance: {SCOPE_LABELS[suspension.scope]}
                      {suspension.scope_value && ` (${suspension.scope_value})`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(suspension)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-destructive"
                      onClick={() => setDeleteConfirmId(suspension.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingSuspension ? "Editar suspensión" : "Nueva suspensión de términos"}
            </DialogTitle>
            <DialogDescription>
              Configure un período donde los términos judiciales no corren
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Título *</Label>
              <Input
                id="title"
                placeholder="Ej: Vacancia judicial 2025-2026"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_date">Fecha inicio *</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_date">Fecha fin *</Label>
                <Input
                  id="end_date"
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="scope">Alcance</Label>
              <Select
                value={formData.scope}
                onValueChange={(value) => setFormData({ ...formData, scope: value as SuspensionScope })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GLOBAL_JUDICIAL">Global (todos los asuntos judiciales)</SelectItem>
                  <SelectItem value="BY_JURISDICTION">Por jurisdicción/ciudad</SelectItem>
                  <SelectItem value="BY_COURT">Por juzgado específico</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.scope !== "GLOBAL_JUDICIAL" && (
              <div className="space-y-2">
                <Label htmlFor="scope_value">
                  {formData.scope === "BY_JURISDICTION" ? "Jurisdicción/Ciudad" : "Nombre del juzgado"}
                </Label>
                <Input
                  id="scope_value"
                  placeholder={formData.scope === "BY_JURISDICTION" ? "Ej: Medellín" : "Ej: Juzgado 1 Civil del Circuito"}
                  value={formData.scope_value}
                  onChange={(e) => setFormData({ ...formData, scope_value: e.target.value })}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="reason">Motivo (opcional)</Label>
              <Textarea
                id="reason"
                placeholder="Ej: Acuerdo CSJXXXXX - Vacancia judicial"
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="space-y-1">
                <Label htmlFor="active">Activa</Label>
                <p className="text-sm text-muted-foreground">
                  Las suspensiones inactivas no afectan los términos
                </p>
              </div>
              <Switch
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingSuspension ? "Guardar cambios" : "Crear suspensión"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar suspensión?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La suspensión será eliminada permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
