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
import { Plus, Upload, AlertCircle, Users } from "lucide-react";
import { Link } from "react-router-dom";

const FILING_TYPES = [
  { value: "Petición", label: "Petición" },
  { value: "Demanda", label: "Demanda" },
  { value: "Acción de Tutela", label: "Acción de Tutela" },
  { value: "Habeas Corpus", label: "Habeas Corpus" },
] as const;

const FILING_METHODS = [
  { value: "EMAIL", label: "Correo electrónico" },
  { value: "PLATFORM", label: "Plataforma digital (URL/webapp)" },
  { value: "PHYSICAL", label: "Envío físico" },
] as const;

interface NewFilingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function NewFilingDialog({ open, onOpenChange, onSuccess }: NewFilingDialogProps) {
  const queryClient = useQueryClient();
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Fetch clients for selection
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
      const filingType = formData.get("filing_type") as string;
      const filingMethod = formData.get("filing_method") as string;
      const targetAuthority = formData.get("target_authority") as string;
      const filingDate = formData.get("filing_date") as string;
      const description = formData.get("description") as string;

      // Get client info for matter
      const { data: client } = await supabase
        .from("clients")
        .select("name, id_number")
        .eq("id", clientId)
        .single();

      if (!client) throw new Error("Cliente no encontrado");

      // First, create a matter for this filing
      const { data: matter, error: matterError } = await supabase
        .from("matters")
        .insert({
          owner_id: user.id,
          client_id: clientId,
          client_name: client.name,
          client_id_number: client.id_number,
          matter_name: `${filingType} - ${targetAuthority || 'Sin autoridad'}`,
          practice_area: filingType === "Acción de Tutela" || filingType === "Habeas Corpus" 
            ? "Constitucional" 
            : "Civil",
        })
        .select()
        .single();

      if (matterError) throw matterError;

      // Calculate SLA dates based on profile settings
      const { data: profile } = await supabase
        .from("profiles")
        .select("sla_receipt_hours, sla_acta_days")
        .eq("id", user.id)
        .single();

      const slaReceiptHours = profile?.sla_receipt_hours || 24;
      const slaActaDays = profile?.sla_acta_days || 5;

      const sentAt = filingDate ? new Date(filingDate) : new Date();
      const slaReceiptDueAt = new Date(sentAt.getTime() + slaReceiptHours * 60 * 60 * 1000);
      const slaActaDueAt = new Date(sentAt.getTime() + slaActaDays * 24 * 60 * 60 * 1000);

      // Upload proof file if provided
      let proofFilePath: string | null = null;
      if (proofFile) {
        setUploading(true);
        const fileExt = proofFile.name.split('.').pop();
        const fileName = `${user.id}/${matter.id}/proof_${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from("lexdocket")
          .upload(fileName, proofFile);

        if (uploadError) throw uploadError;
        proofFilePath = fileName;
        setUploading(false);
      }

      // Create the filing
      const { data: filing, error: filingError } = await supabase
        .from("filings")
        .insert({
          owner_id: user.id,
          matter_id: matter.id,
          client_id: clientId,
          filing_type: filingType,
          filing_method: filingMethod,
          target_authority: targetAuthority || null,
          description: description || null,
          proof_file_path: proofFilePath,
          sent_at: sentAt.toISOString(),
          sla_receipt_due_at: slaReceiptDueAt.toISOString(),
          sla_acta_due_at: slaActaDueAt.toISOString(),
          status: "SENT_TO_REPARTO",
        })
        .select()
        .single();

      if (filingError) throw filingError;

      // Create initial task for follow-up
      await supabase.from("tasks").insert({
        owner_id: user.id,
        filing_id: filing.id,
        title: `Confirmar recibo de ${filingType}`,
        type: "FOLLOW_UP_REPARTO",
        due_at: slaReceiptDueAt.toISOString(),
        auto_generated: true,
      });

      // Create alert for tracking goals
      await supabase.from("alerts").insert({
        owner_id: user.id,
        filing_id: filing.id,
        message: `Nueva radicación creada: ${filingType}. Objetivos pendientes: Número de radicado, Juzgado de conocimiento, Acceso a expediente electrónico.`,
        severity: "INFO",
      });

      return filing;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filings"] });
      queryClient.invalidateQueries({ queryKey: ["matters"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Radicación creada exitosamente");
      onOpenChange(false);
      setProofFile(null);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Error al crear radicación: " + error.message);
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
          <DialogTitle>Nueva Radicación</DialogTitle>
          <DialogDescription>
            Registra una nueva radicación para seguimiento. La radicación se mostrará en el Dashboard.
          </DialogDescription>
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
            {/* Client Selection */}
            <div className="space-y-2">
              <Label htmlFor="client_id">Cliente *</Label>
              <Select name="client_id" required>
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

            {/* Filing Type */}
            <div className="space-y-2">
              <Label htmlFor="filing_type">Tipo de Actuación *</Label>
              <Select name="filing_type" required>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  {FILING_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filing Date */}
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

            {/* Filing Method */}
            <div className="space-y-3">
              <Label>Medio de Radicación *</Label>
              <RadioGroup name="filing_method" defaultValue="EMAIL" className="space-y-2">
                {FILING_METHODS.map((method) => (
                  <div key={method.value} className="flex items-center space-x-2">
                    <RadioGroupItem value={method.value} id={method.value} />
                    <Label htmlFor={method.value} className="font-normal cursor-pointer">
                      {method.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* Target Authority */}
            <div className="space-y-2">
              <Label htmlFor="target_authority">Autoridad Destinataria *</Label>
              <Input
                id="target_authority"
                name="target_authority"
                required
                placeholder="Ej: Juzgado 15 Civil del Circuito de Bogotá, Superintendencia de Industria y Comercio"
              />
              <p className="text-xs text-muted-foreground">
                Autoridad judicial o administrativa a la que se envía la actuación
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Descripción breve del objeto de la radicación..."
                rows={3}
              />
            </div>

            {/* Proof Upload */}
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
                {proofFile && (
                  <span className="text-sm text-muted-foreground truncate max-w-[150px]">
                    {proofFile.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Sube el PDF con la prueba de envío (captura de correo, constancia de plataforma, guía de envío, etc.)
              </p>
            </div>

            {/* Goals Alert */}
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Objetivos de la radicación:</strong>
                <ul className="list-disc list-inside mt-1 text-sm">
                  <li>Obtener el número de radicado (23 dígitos)</li>
                  <li>Identificar el juzgado o autoridad de conocimiento</li>
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
                  Crear Radicación
                </>
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
