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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { 
  MEDIOS_DE_CONTROL, 
  CPACA_PHASES,
  type MedioDeControl,
  type CpacaPhase 
} from "@/lib/cpaca-constants";

interface NewCpacaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewCpacaDialog({ open, onOpenChange }: NewCpacaDialogProps) {
  const queryClient = useQueryClient();
  
  // Form state
  const [titulo, setTitulo] = useState("");
  const [radicado, setRadicado] = useState("");
  const [medioDeControl, setMedioDeControl] = useState<MedioDeControl>("NULIDAD_RESTABLECIMIENTO");
  const [medioDeControlCustom, setMedioDeControlCustom] = useState("");
  const [conciliacionRequisito, setConciliacionRequisito] = useState(true);
  const [agotamientoViaGubernativa, setAgotamientoViaGubernativa] = useState(false);
  const [demandantes, setDemandantes] = useState("");
  const [demandados, setDemandados] = useState("");
  const [despachoNombre, setDespachoNombre] = useState("");
  const [despachoCiudad, setDespachoCiudad] = useState("");
  const [despachoEmail, setDespachoEmail] = useState("");
  const [fechaEventoCaducidad, setFechaEventoCaducidad] = useState("");
  const [notas, setNotas] = useState("");
  
  // Client selection
  const [clientTab, setClientTab] = useState<"existing" | "new">("existing");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientIdNumber, setNewClientIdNumber] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");

  // Fetch clients
  const { data: clients } = useQuery({
    queryKey: ["clients-list"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");
      
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .eq("owner_id", user.user.id)
        .order("name");
      
      if (error) throw error;
      return data;
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      let clientId = selectedClientId || null;

      // Create new client if needed
      if (clientTab === "new" && newClientName.trim()) {
        const { data: newClient, error: clientError } = await supabase
          .from("clients")
          .insert({
            owner_id: user.user.id,
            name: newClientName.trim(),
            id_number: newClientIdNumber.trim() || null,
            email: newClientEmail.trim() || null,
          })
          .select("id")
          .single();
        
        if (clientError) throw clientError;
        clientId = newClient.id;
      }

      // Determine initial phase
      let initialPhase: CpacaPhase = "PRECONTENCIOSO";
      const medioInfo = MEDIOS_DE_CONTROL[medioDeControl];
      
      if (!medioInfo.requiresConciliacion && !conciliacionRequisito) {
        initialPhase = "DEMANDA_POR_RADICAR";
      }

      // Create CPACA process
      const { data, error } = await supabase
        .from("cpaca_processes")
        .insert({
          owner_id: user.user.id,
          client_id: clientId,
          titulo: titulo.trim() || null,
          radicado: radicado.trim() || null,
          medio_de_control: medioDeControl,
          medio_de_control_custom: medioDeControl === "OTRO" ? medioDeControlCustom.trim() : null,
          conciliacion_requisito: conciliacionRequisito,
          agotamiento_via_gubernativa: agotamientoViaGubernativa,
          demandantes: demandantes.trim() || null,
          demandados: demandados.trim() || null,
          despacho_nombre: despachoNombre.trim() || null,
          despacho_ciudad: despachoCiudad.trim() || null,
          despacho_email: despachoEmail.trim() || null,
          fecha_evento_caducidad_base: fechaEventoCaducidad || null,
          notas: notas.trim() || null,
          phase: initialPhase,
        })
        .select("id")
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpaca-processes"] });
      queryClient.invalidateQueries({ queryKey: ["clients-list"] });
      toast.success("Proceso CPACA creado");
      resetForm();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Error al crear: " + error.message);
    },
  });

  const resetForm = () => {
    setTitulo("");
    setRadicado("");
    setMedioDeControl("NULIDAD_RESTABLECIMIENTO");
    setMedioDeControlCustom("");
    setConciliacionRequisito(true);
    setAgotamientoViaGubernativa(false);
    setDemandantes("");
    setDemandados("");
    setDespachoNombre("");
    setDespachoCiudad("");
    setDespachoEmail("");
    setFechaEventoCaducidad("");
    setNotas("");
    setClientTab("existing");
    setSelectedClientId("");
    setNewClientName("");
    setNewClientIdNumber("");
    setNewClientEmail("");
  };

  // Update conciliacion requirement based on medio de control
  const handleMedioChange = (value: MedioDeControl) => {
    setMedioDeControl(value);
    const medioInfo = MEDIOS_DE_CONTROL[value];
    setConciliacionRequisito(medioInfo.requiresConciliacion);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Nuevo Proceso CPACA</DialogTitle>
          <DialogDescription>
            Crear un nuevo proceso contencioso administrativo
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6 py-4">
            {/* Basic info */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Información básica</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="titulo">Título / Referencia</Label>
                  <Input
                    id="titulo"
                    placeholder="Ej: Nulidad Resolución 123"
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="radicado">Radicado (si existe)</Label>
                  <Input
                    id="radicado"
                    placeholder="23 dígitos"
                    value={radicado}
                    onChange={(e) => setRadicado(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Medio de Control</Label>
                <Select value={medioDeControl} onValueChange={handleMedioChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MEDIOS_DE_CONTROL).map(([key, info]) => (
                      <SelectItem key={key} value={key}>
                        <div>
                          <span>{info.label}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({info.description})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {medioDeControl === "OTRO" && (
                <div className="space-y-2">
                  <Label htmlFor="medioCustom">Especificar medio de control</Label>
                  <Input
                    id="medioCustom"
                    value={medioDeControlCustom}
                    onChange={(e) => setMedioDeControlCustom(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Prerequisites */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Requisitos de procedibilidad</h4>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label>Conciliación extrajudicial requerida</Label>
                  <p className="text-xs text-muted-foreground">
                    Según el medio de control seleccionado
                  </p>
                </div>
                <Switch
                  checked={conciliacionRequisito}
                  onCheckedChange={setConciliacionRequisito}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Agotamiento vía gubernativa</Label>
                  <p className="text-xs text-muted-foreground">
                    Para nulidad y restablecimiento del derecho
                  </p>
                </div>
                <Switch
                  checked={agotamientoViaGubernativa}
                  onCheckedChange={setAgotamientoViaGubernativa}
                />
              </div>
            </div>

            {/* Caducidad */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Control de caducidad</h4>
              
              <div className="space-y-2">
                <Label htmlFor="fechaCaducidad">
                  Fecha base para cálculo de caducidad
                </Label>
                <p className="text-xs text-muted-foreground">
                  Notificación del acto, hecho dañoso, terminación contrato, etc.
                </p>
                <Input
                  id="fechaCaducidad"
                  type="date"
                  value={fechaEventoCaducidad}
                  onChange={(e) => setFechaEventoCaducidad(e.target.value)}
                />
              </div>
            </div>

            {/* Parties */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Partes</h4>
              
              <div className="space-y-2">
                <Label htmlFor="demandantes">Demandante(s)</Label>
                <Textarea
                  id="demandantes"
                  placeholder="Nombres de los demandantes"
                  value={demandantes}
                  onChange={(e) => setDemandantes(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="demandados">Demandado(s)</Label>
                <Textarea
                  id="demandados"
                  placeholder="Entidades demandadas"
                  value={demandados}
                  onChange={(e) => setDemandados(e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            {/* Court info */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Despacho judicial</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="despacho">Nombre del despacho</Label>
                  <Input
                    id="despacho"
                    placeholder="Juzgado / Tribunal"
                    value={despachoNombre}
                    onChange={(e) => setDespachoNombre(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ciudad">Ciudad</Label>
                  <Input
                    id="ciudad"
                    value={despachoCiudad}
                    onChange={(e) => setDespachoCiudad(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Correo del despacho</Label>
                <Input
                  id="email"
                  type="email"
                  value={despachoEmail}
                  onChange={(e) => setDespachoEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Client */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Cliente</h4>
              
              <Tabs value={clientTab} onValueChange={(v) => setClientTab(v as "existing" | "new")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="existing">Cliente existente</TabsTrigger>
                  <TabsTrigger value="new">Nuevo cliente</TabsTrigger>
                </TabsList>
                
                <TabsContent value="existing" className="space-y-4 pt-4">
                  <Select value={selectedClientId} onValueChange={setSelectedClientId}>
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
                </TabsContent>
                
                <TabsContent value="new" className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="newClientName">Nombre *</Label>
                    <Input
                      id="newClientName"
                      value={newClientName}
                      onChange={(e) => setNewClientName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="newClientId">Cédula/NIT</Label>
                      <Input
                        id="newClientId"
                        value={newClientIdNumber}
                        onChange={(e) => setNewClientIdNumber(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="newClientEmail">Correo</Label>
                      <Input
                        id="newClientEmail"
                        type="email"
                        value={newClientEmail}
                        onChange={(e) => setNewClientEmail(e.target.value)}
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notas">Notas adicionales</Label>
              <Textarea
                id="notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Crear proceso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
