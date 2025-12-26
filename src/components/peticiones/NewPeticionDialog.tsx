import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { addBusinessDays } from "@/lib/colombian-holidays";
import { PETICION_DEADLINE_DAYS } from "@/lib/peticiones-constants";

interface NewPeticionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  onSuccess?: () => void;
}

export function NewPeticionDialog({ open, onOpenChange, onBack, onSuccess }: NewPeticionDialogProps) {
  const queryClient = useQueryClient();
  const [entityName, setEntityName] = useState("");
  const [entityType, setEntityType] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [entityEmail, setEntityEmail] = useState("");
  const [entityAddress, setEntityAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [radicado, setRadicado] = useState("");
  const [filedAt, setFiledAt] = useState<Date | undefined>(undefined);
  const [clientId, setClientId] = useState<string>("");

  // Fetch clients for dropdown
  const { data: clients } = useQuery({
    queryKey: ["clients-dropdown"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return [];
      
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .eq("owner_id", user.user.id)
        .order("name");
      
      if (error) throw error;
      return data;
    },
  });

  const createPeticion = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      // Calculate deadline if filedAt is provided
      let deadlineAt: Date | null = null;
      if (filedAt) {
        deadlineAt = addBusinessDays(filedAt, PETICION_DEADLINE_DAYS);
      }

      const { data, error } = await supabase
        .from("peticiones")
        .insert({
          owner_id: user.user.id,
          entity_name: entityName,
          entity_type: entityType,
          entity_email: entityEmail || null,
          entity_address: entityAddress || null,
          subject,
          description: description || null,
          radicado: radicado || null,
          filed_at: filedAt?.toISOString() || null,
          deadline_at: deadlineAt?.toISOString() || null,
          client_id: clientId || null,
          phase: filedAt ? "PETICION_RADICADA" : "PETICION_RADICADA",
        })
        .select()
        .single();

      if (error) throw error;

      // Create initial alert for the peticion if it has a deadline
      if (deadlineAt) {
        await supabase.from("peticion_alerts").insert({
          owner_id: user.user.id,
          peticion_id: data.id,
          alert_type: "DEADLINE_WARNING",
          severity: "INFO",
          message: `Petición radicada. Vence el ${format(deadlineAt, "dd/MM/yyyy")}`,
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["peticiones"] });
      toast.success("Petición creada exitosamente");
      resetForm();
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Error al crear petición: " + error.message);
    },
  });

  const resetForm = () => {
    setEntityName("");
    setEntityType("PUBLIC");
    setEntityEmail("");
    setEntityAddress("");
    setSubject("");
    setDescription("");
    setRadicado("");
    setFiledAt(undefined);
    setClientId("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entityName.trim()) {
      toast.error("El nombre de la entidad es requerido");
      return;
    }
    if (!subject.trim()) {
      toast.error("El asunto es requerido");
      return;
    }
    createPeticion.mutate();
  };

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
              <DialogTitle>Nueva Petición</DialogTitle>
              <DialogDescription>
                Registre una nueva petición (Derecho de Petición Art. 23 Constitución)
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Entity Information */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="entityName">Nombre de la Entidad *</Label>
              <Input
                id="entityName"
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                placeholder="Ej: Ministerio de Hacienda"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entityType">Tipo de Entidad</Label>
              <Select value={entityType} onValueChange={(v) => setEntityType(v as "PUBLIC" | "PRIVATE")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC">Entidad Pública</SelectItem>
                  <SelectItem value="PRIVATE">Entidad Privada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="entityEmail">Correo de la Entidad</Label>
              <Input
                id="entityEmail"
                type="email"
                value={entityEmail}
                onChange={(e) => setEntityEmail(e.target.value)}
                placeholder="correo@entidad.gov.co"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientId">Cliente</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin cliente</SelectItem>
                  {clients?.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="entityAddress">Dirección de la Entidad</Label>
            <Input
              id="entityAddress"
              value={entityAddress}
              onChange={(e) => setEntityAddress(e.target.value)}
              placeholder="Calle 123 # 45-67, Bogotá"
            />
          </div>

          {/* Peticion Details */}
          <div className="space-y-2">
            <Label htmlFor="subject">Asunto *</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ej: Solicitud de información sobre..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción detallada de la petición..."
              rows={3}
            />
          </div>

          {/* Filing Information */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="radicado">Número de Radicado</Label>
              <Input
                id="radicado"
                value={radicado}
                onChange={(e) => setRadicado(e.target.value)}
                placeholder="Ej: 20240001234"
              />
            </div>
            <div className="space-y-2">
              <Label>Fecha de Radicación</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !filedAt && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filedAt ? format(filedAt, "dd/MM/yyyy", { locale: es }) : "Seleccionar fecha"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={filedAt}
                    onSelect={setFiledAt}
                    initialFocus
                    locale={es}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {filedAt && (
            <div className="p-3 bg-muted/50 rounded-lg text-sm">
              <p className="text-muted-foreground">
                <strong>Fecha límite de respuesta:</strong>{" "}
                {format(addBusinessDays(filedAt, PETICION_DEADLINE_DAYS), "dd/MM/yyyy", { locale: es })}
                {" "}(15 días hábiles)
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createPeticion.isPending}>
              {createPeticion.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Crear Petición
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
