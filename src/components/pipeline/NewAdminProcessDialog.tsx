import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ADMIN_ACTUACION_TYPES, ADMIN_PROCESS_PHASES_ORDER } from "@/lib/admin-constants";
import { COLOMBIAN_DEPARTMENTS } from "@/lib/constants";

interface NewAdminProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewAdminProcessDialog({ open, onOpenChange }: NewAdminProcessDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    radicado: "",
    expediente_administrativo: "",
    autoridad: "",
    entidad: "",
    dependencia: "",
    tipo_actuacion: "",
    department: "",
    municipality: "",
    demandantes: "",
    demandados: "",
    correo_autoridad: "",
    notes: "",
    client_id: "",
  });

  // Fetch clients for linking
  const { data: clients } = useQuery({
    queryKey: ["clients-for-admin-process"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return [];
      
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .eq("owner_id", user.user.id)
        .order("name");
      
      if (error) throw error;
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { error } = await supabase.from("monitored_processes").insert({
        owner_id: user.user.id,
        process_type: "ADMINISTRATIVE",
        radicado: formData.radicado || `ADMIN-${Date.now()}`,
        expediente_administrativo: formData.expediente_administrativo || null,
        autoridad: formData.autoridad || null,
        entidad: formData.entidad || null,
        dependencia: formData.dependencia || null,
        tipo_actuacion: formData.tipo_actuacion || null,
        department: formData.department || null,
        municipality: formData.municipality || null,
        demandantes: formData.demandantes || null,
        demandados: formData.demandados || null,
        correo_autoridad: formData.correo_autoridad || null,
        notes: formData.notes || null,
        client_id: formData.client_id || null,
        admin_phase: ADMIN_PROCESS_PHASES_ORDER[0],
        monitoring_enabled: true,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-pipeline-processes"] });
      toast.success("Proceso administrativo creado");
      onOpenChange(false);
      setFormData({
        radicado: "",
        expediente_administrativo: "",
        autoridad: "",
        entidad: "",
        dependencia: "",
        tipo_actuacion: "",
        department: "",
        municipality: "",
        demandantes: "",
        demandados: "",
        correo_autoridad: "",
        notes: "",
        client_id: "",
      });
    },
    onError: () => toast.error("Error al crear proceso"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Proceso Administrativo</DialogTitle>
          <DialogDescription>
            Crea un nuevo proceso ante autoridad administrativa (inspecciones, superintendencias, etc.)
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Expediente */}
            <div className="space-y-2">
              <Label htmlFor="expediente">Expediente Administrativo</Label>
              <Input
                id="expediente"
                value={formData.expediente_administrativo}
                onChange={(e) => setFormData(prev => ({ ...prev, expediente_administrativo: e.target.value }))}
                placeholder="Número de expediente"
              />
            </div>

            {/* Radicado */}
            <div className="space-y-2">
              <Label htmlFor="radicado">Radicado (opcional)</Label>
              <Input
                id="radicado"
                value={formData.radicado}
                onChange={(e) => setFormData(prev => ({ ...prev, radicado: e.target.value }))}
                placeholder="Se genera automáticamente si está vacío"
              />
            </div>

            {/* Authority */}
            <div className="space-y-2">
              <Label htmlFor="autoridad">Autoridad</Label>
              <Input
                id="autoridad"
                value={formData.autoridad}
                onChange={(e) => setFormData(prev => ({ ...prev, autoridad: e.target.value }))}
                placeholder="Ej: Secretaría de Movilidad"
              />
            </div>

            {/* Entity */}
            <div className="space-y-2">
              <Label htmlFor="entidad">Entidad</Label>
              <Input
                id="entidad"
                value={formData.entidad}
                onChange={(e) => setFormData(prev => ({ ...prev, entidad: e.target.value }))}
                placeholder="Ej: Alcaldía de Medellín"
              />
            </div>

            {/* Dependencia */}
            <div className="space-y-2">
              <Label htmlFor="dependencia">Dependencia / Despacho</Label>
              <Input
                id="dependencia"
                value={formData.dependencia}
                onChange={(e) => setFormData(prev => ({ ...prev, dependencia: e.target.value }))}
                placeholder="Oficina específica"
              />
            </div>

            {/* Tipo Actuación */}
            <div className="space-y-2">
              <Label htmlFor="tipo_actuacion">Tipo de Actuación</Label>
              <Select
                value={formData.tipo_actuacion}
                onValueChange={(value) => setFormData(prev => ({ ...prev, tipo_actuacion: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_ACTUACION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Department */}
            <div className="space-y-2">
              <Label htmlFor="department">Departamento</Label>
              <Select
                value={formData.department}
                onValueChange={(value) => setFormData(prev => ({ ...prev, department: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {COLOMBIAN_DEPARTMENTS.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Municipality */}
            <div className="space-y-2">
              <Label htmlFor="municipality">Ciudad/Municipio</Label>
              <Input
                id="municipality"
                value={formData.municipality}
                onChange={(e) => setFormData(prev => ({ ...prev, municipality: e.target.value }))}
                placeholder="Ciudad"
              />
            </div>

            {/* Client */}
            <div className="space-y-2">
              <Label htmlFor="client">Cliente</Label>
              <Select
                value={formData.client_id}
                onValueChange={(value) => setFormData(prev => ({ ...prev, client_id: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Vincular a cliente (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="correo_autoridad">Correo de Notificaciones</Label>
              <Input
                id="correo_autoridad"
                type="email"
                value={formData.correo_autoridad}
                onChange={(e) => setFormData(prev => ({ ...prev, correo_autoridad: e.target.value }))}
                placeholder="correo@entidad.gov.co"
              />
            </div>
          </div>

          {/* Parties */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="demandantes">Investigado / Administrado</Label>
              <Input
                id="demandantes"
                value={formData.demandantes}
                onChange={(e) => setFormData(prev => ({ ...prev, demandantes: e.target.value }))}
                placeholder="Nombre del investigado"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="demandados">Denunciante / Quejoso</Label>
              <Input
                id="demandados"
                value={formData.demandados}
                onChange={(e) => setFormData(prev => ({ ...prev, demandados: e.target.value }))}
                placeholder="Nombre (si aplica)"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notas</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Observaciones adicionales"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creando..." : "Crear Proceso"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
