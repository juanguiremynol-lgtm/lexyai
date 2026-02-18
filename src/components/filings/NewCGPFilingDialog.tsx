import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Plus, Upload, AlertCircle, Users, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { createUserAlert } from "@/lib/alerts/create-user-alert";

const CGP_SUBTYPES = [
  { value: "Demanda Declarativa", label: "Demanda Declarativa" },
  { value: "Demanda Ejecutiva", label: "Demanda Ejecutiva" },
  { value: "Verbal Sumario", label: "Verbal Sumario" },
  { value: "Verbal", label: "Verbal" },
  { value: "Ejecutivo con Título Hipotecario", label: "Ejecutivo con Título Hipotecario" },
  { value: "Monitorio", label: "Monitorio" },
  { value: "Divisorio", label: "Divisorio" },
  { value: "Sucesión", label: "Sucesión" },
  { value: "Expropiación", label: "Expropiación" },
  { value: "Deslinde y Amojonamiento", label: "Deslinde y Amojonamiento" },
  { value: "Otro CGP", label: "Otro CGP" },
] as const;

const FILING_METHODS = [
  { value: "EMAIL", label: "Correo electrónico" },
  { value: "PLATFORM", label: "Plataforma digital (URL/webapp)" },
  { value: "PHYSICAL", label: "Envío físico" },
] as const;

interface NewCGPFilingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  onSuccess?: () => void;
  defaultClientId?: string;
}

export function NewCGPFilingDialog({
  open,
  onOpenChange,
  onBack,
  onSuccess,
  defaultClientId,
}: NewCGPFilingDialogProps) {
  const queryClient = useQueryClient();
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: clients, isLoading: clientsLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, id_number")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const createFiling = useMutation({
    mutationFn: async (formData: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const clientId = formData.get("client_id") as string;
      const filingSubtype = formData.get("filing_subtype") as string;
      const filingMethod = formData.get("filing_method") as string;
      const targetAuthority = formData.get("target_authority") as string;
      const filingDate = formData.get("filing_date") as string;
      const description = formData.get("description") as string;
      const demandantes = formData.get("demandantes") as string;
      const demandados = formData.get("demandados") as string;

      const { data: client } = await supabase
        .from("clients")
        .select("name, id_number")
        .eq("id", clientId)
        .single();

      if (!client) throw new Error("Cliente no encontrado");

      const { data: matter, error: matterError } = await supabase
        .from("matters")
        .insert({
          owner_id: user.id,
          client_id: clientId,
          client_name: client.name,
          client_id_number: client.id_number,
          matter_name: `${filingSubtype} - ${targetAuthority || 'Sin autoridad'}`,
          practice_area: "Civil",
        })
        .select()
        .single();

      if (matterError) throw matterError;

      const sentAt = filingDate ? new Date(filingDate) : new Date();

      // Create a work_item instead of filing
      const { data: workItem, error: workItemError } = await supabase
        .from("work_items")
        .insert({
          owner_id: user.id,
          matter_id: matter.id,
          client_id: clientId,
          workflow_type: "CGP",
          stage: "FILING",
          status: "ACTIVE",
          source: "MANUAL",
          title: `${filingSubtype} - ${demandantes || 'Demandante'}`,
          description: description || null,
          demandantes: demandantes || null,
          demandados: demandados || null,
          authority_name: targetAuthority || null,
          filing_date: sentAt.toISOString(),
          monitoring_enabled: true,
        })
        .select()
        .single();

      if (workItemError) throw workItemError;

      // Create unified notification for CGP filing
      await createUserAlert({
        userId: user.id,
        workItemId: workItem.id,
        alertType: 'HITO_ALCANZADO',
        severity: 'info',
        title: `Demanda CGP radicada: ${filingSubtype}`,
        body: `Objetivos pendientes: Número de radicado, Juzgado de conocimiento, Acceso a expediente electrónico.`,
        metadata: { filing_subtype: filingSubtype, authority: targetAuthority },
        dedupeKey: `CGP_CREATED_${workItem.id}`,
      });

      return workItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["matters"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Demanda CGP creada exitosamente");
      onOpenChange(false);
      setProofFile(null);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Error al crear demanda: " + error.message);
      setUploading(false);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    createFiling.mutate(new FormData(e.currentTarget));
  };

  const noClients = !clientsLoading && (!clients || clients.length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <DialogTitle>Nueva Demanda CGP</DialogTitle>
              <DialogDescription>
                Proceso judicial bajo el Código General del Proceso
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {noClients ? (
          <div className="py-8 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">No hay clientes registrados</h3>
            <p className="text-muted-foreground mt-2">
              Debes crear un cliente antes de crear una radicación.
            </p>
            <Button asChild className="mt-4">
              <Link to="/clients" onClick={() => onOpenChange(false)}>
                <Plus className="mr-2 h-4 w-4" />
                Crear Cliente
              </Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="client_id">Cliente *</Label>
              <Select name="client_id" required defaultValue={defaultClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name} {client.id_number && `(${client.id_number})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filing_subtype">Tipo de Demanda *</Label>
              <Select name="filing_subtype" required>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tipo de demanda" />
                </SelectTrigger>
                <SelectContent>
                  {CGP_SUBTYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="demandantes">Demandante(s)</Label>
                <Input
                  id="demandantes"
                  name="demandantes"
                  placeholder="Nombre del demandante"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="demandados">Demandado(s)</Label>
                <Input
                  id="demandados"
                  name="demandados"
                  placeholder="Nombre del demandado"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filing_date">Fecha de Radicación *</Label>
              <Input
                id="filing_date"
                name="filing_date"
                type="date"
                required
                defaultValue={new Date().toISOString().split('T')[0]}
              />
            </div>

            <div className="space-y-3">
              <Label>Medio de Radicación *</Label>
              <RadioGroup name="filing_method" defaultValue="EMAIL" className="space-y-2">
                {FILING_METHODS.map((method) => (
                  <div key={method.value} className="flex items-center space-x-2">
                    <RadioGroupItem value={method.value} id={`cgp-${method.value}`} />
                    <Label htmlFor={`cgp-${method.value}`} className="font-normal cursor-pointer">
                      {method.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="target_authority">Juzgado / Oficina de Reparto *</Label>
              <Input
                id="target_authority"
                name="target_authority"
                required
                placeholder="Ej: Oficina de Reparto Civil de Bogotá, Juzgado 15 Civil del Circuito"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción / Pretensiones</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Descripción breve del objeto de la demanda..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="proof_file">Prueba de Envío (PDF)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="proof_file"
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                  className="flex-1"
                />
              </div>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Objetivos de la radicación CGP:</strong>
                <ul className="list-disc list-inside mt-1 text-sm">
                  <li>Obtener el número de radicado (23 dígitos)</li>
                  <li>Identificar el juzgado de conocimiento</li>
                  <li>Obtener acceso al expediente electrónico</li>
                </ul>
              </AlertDescription>
            </Alert>

            <Button
              type="submit"
              className="w-full"
              disabled={createFiling.isPending || uploading}
            >
              {createFiling.isPending || uploading ? (
                <>
                  <Upload className="mr-2 h-4 w-4 animate-spin" />
                  {uploading ? "Subiendo archivo..." : "Creando..."}
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Crear Demanda CGP
                </>
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
