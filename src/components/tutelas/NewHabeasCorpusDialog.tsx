import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ArrowLeft, AlertTriangle, Users, Plus } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

interface NewHabeasCorpusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  onSuccess?: () => void;
  defaultClientId?: string;
}

export function NewHabeasCorpusDialog({
  open,
  onOpenChange,
  onBack,
  onSuccess,
  defaultClientId,
}: NewHabeasCorpusDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    clientId: defaultClientId || "",
    detenido: "",
    lugarDetencion: "",
    autoridadCaptora: "",
    fechaCaptura: "",
    motivoCaptura: "",
    courtName: "",
    radicado: "",
    description: "",
  });

  // Fetch clients for select
  const { data: clients, isLoading: clientsLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const createHabeasCorpusMutation = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      if (!formData.clientId) {
        throw new Error("Debe seleccionar un cliente");
      }

      // Create matter first
      const { data: matter, error: matterError } = await supabase
        .from("matters")
        .insert({
          owner_id: user.user.id,
          client_id: formData.clientId,
          client_name: formData.detenido || "Detenido",
          matter_name: `Habeas Corpus - ${formData.detenido || "Detenido"}`,
          practice_area: "Constitucional",
        })
        .select()
        .single();

      if (matterError) throw matterError;

      // Create work_item with TUTELA type and habeas corpus title
      const { data: workItem, error: workItemError } = await supabase
        .from("work_items")
        .insert({
          owner_id: user.user.id,
          matter_id: matter.id,
          client_id: formData.clientId,
          workflow_type: "TUTELA",
          stage: "FILING",
          status: "ACTIVE",
          source: "MANUAL",
          title: `Habeas Corpus - ${formData.detenido || "Detenido"}`,
          demandantes: formData.detenido,
          demandados: formData.autoridadCaptora,
          authority_name: formData.courtName || null,
          radicado: formData.radicado || null,
          description: JSON.stringify({
            lugarDetencion: formData.lugarDetencion,
            fechaCaptura: formData.fechaCaptura,
            motivoCaptura: formData.motivoCaptura,
            detalle: formData.description,
          }),
          monitoring_enabled: true,
        })
        .select()
        .single();

      if (workItemError) throw workItemError;

      // Create critical alert (Habeas Corpus is time-sensitive - 36 hours)
      await supabase.from("alerts").insert({
        owner_id: user.user.id,
        message: `URGENTE: Habeas Corpus radicado para ${formData.detenido || "detenido"}. Término de 36 horas para resolver.`,
        severity: "CRITICAL",
      });

      return workItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["tutelas"] });
      toast.success("Habeas Corpus creado exitosamente");
      onOpenChange(false);
      resetForm();
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Error al crear: " + error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      clientId: "",
      detenido: "",
      lugarDetencion: "",
      autoridadCaptora: "",
      fechaCaptura: "",
      motivoCaptura: "",
      courtName: "",
      radicado: "",
      description: "",
    });
  };

  const noClients = !clientsLoading && (!clients || clients.length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <DialogTitle>Nuevo Habeas Corpus</DialogTitle>
              <DialogDescription>
                Acción para proteger la libertad personal (Art. 30 Constitución)
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {noClients ? (
          <div className="py-8 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">No hay clientes registrados</h3>
            <p className="text-muted-foreground mt-2">
              Debes crear un cliente antes de crear un Habeas Corpus.
            </p>
            <Button asChild className="mt-4">
              <Link to="/clients" onClick={() => onOpenChange(false)}>
                <Plus className="mr-2 h-4 w-4" />
                Crear Cliente
              </Link>
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createHabeasCorpusMutation.mutate();
            }}
            className="space-y-4"
          >
            <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Acción urgente:</strong> El Habeas Corpus debe resolverse en máximo 36 horas.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="clientId">Cliente *</Label>
              <Select
                value={formData.clientId}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, clientId: value }))}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione un cliente" />
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

            <div className="space-y-2">
              <Label htmlFor="detenido">Nombre del Detenido *</Label>
              <Input
                id="detenido"
                value={formData.detenido}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, detenido: e.target.value }))
                }
                placeholder="Nombre completo del detenido"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fechaCaptura">Fecha/Hora de Captura</Label>
                <Input
                  id="fechaCaptura"
                  type="datetime-local"
                  value={formData.fechaCaptura}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, fechaCaptura: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="autoridadCaptora">Autoridad Captora *</Label>
                <Input
                  id="autoridadCaptora"
                  value={formData.autoridadCaptora}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, autoridadCaptora: e.target.value }))
                  }
                  placeholder="Ej: Policía Nacional, CTI, Ejército"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lugarDetencion">Lugar de Detención *</Label>
              <Input
                id="lugarDetencion"
                value={formData.lugarDetencion}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, lugarDetencion: e.target.value }))
                }
                placeholder="Dirección o URI del lugar de detención"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="motivoCaptura">Motivo de la Captura</Label>
              <Input
                id="motivoCaptura"
                value={formData.motivoCaptura}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, motivoCaptura: e.target.value }))
                }
                placeholder="Ej: Orden judicial, flagrancia, captura administrativa"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="courtName">Juzgado</Label>
                <Input
                  id="courtName"
                  value={formData.courtName}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, courtName: e.target.value }))
                  }
                  placeholder="Juzgado asignado (si ya se conoce)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="radicado">Radicado</Label>
                <Input
                  id="radicado"
                  value={formData.radicado}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, radicado: e.target.value }))
                  }
                  placeholder="Número de radicado"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción / Circunstancias</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Descripción detallada de las circunstancias de la captura y la situación actual..."
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createHabeasCorpusMutation.isPending}>
                {createHabeasCorpusMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Crear Habeas Corpus
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
