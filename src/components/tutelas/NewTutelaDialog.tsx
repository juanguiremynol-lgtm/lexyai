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
import { Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

interface NewTutelaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  onSuccess?: () => void;
  defaultClientId?: string;
}

export function NewTutelaDialog({ open, onOpenChange, onBack, onSuccess, defaultClientId }: NewTutelaDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    clientId: defaultClientId || "",
    demandantes: "",
    demandados: "",
    courtName: "",
    radicado: "",
    description: "",
  });

  // Fetch clients for select
  const { data: clients } = useQuery({
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

  const createTutelaMutation = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      // Create matter first
      const { data: matter, error: matterError } = await supabase
        .from("matters")
        .insert({
          owner_id: user.user.id,
          client_id: formData.clientId || null,
          client_name: formData.demandantes || "Accionante",
          matter_name: `Tutela vs ${formData.demandados || "Accionado"}`,
          practice_area: "Constitucional",
        })
        .select()
        .single();

      if (matterError) throw matterError;

      // Create filing with tutela type
      const { data: filing, error: filingError } = await supabase
        .from("filings")
        .insert({
          owner_id: user.user.id,
          matter_id: matter.id,
          client_id: formData.clientId || null,
          filing_type: "TUTELA",
          status: "DRAFTED",
          demandantes: formData.demandantes,
          demandados: formData.demandados,
          court_name: formData.courtName,
          radicado: formData.radicado || null,
          description: formData.description,
        })
        .select()
        .single();

      if (filingError) throw filingError;

      return filing;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tutelas"] });
      queryClient.invalidateQueries({ queryKey: ["filings"] });
      toast.success("Tutela creada exitosamente");
      onOpenChange(false);
      setFormData({
        clientId: "",
        demandantes: "",
        demandados: "",
        courtName: "",
        radicado: "",
        description: "",
      });
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Error al crear tutela: " + error.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <DialogTitle>Nueva Acción de Tutela</DialogTitle>
              <DialogDescription>
                Registre una nueva acción de tutela para seguimiento
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createTutelaMutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="clientId">Cliente</Label>
            <Select
              value={formData.clientId}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, clientId: value }))}
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="demandantes">Accionante</Label>
              <Input
                id="demandantes"
                value={formData.demandantes}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, demandantes: e.target.value }))
                }
                placeholder="Nombre del accionante"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="demandados">Accionado</Label>
              <Input
                id="demandados"
                value={formData.demandados}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, demandados: e.target.value }))
                }
                placeholder="Entidad o persona accionada"
                required
              />
            </div>
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
                placeholder="Juzgado asignado"
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
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Descripción breve del caso"
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
            <Button type="submit" disabled={createTutelaMutation.isPending}>
              {createTutelaMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Crear Tutela
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
