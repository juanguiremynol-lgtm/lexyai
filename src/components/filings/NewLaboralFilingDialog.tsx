/**
 * NewLaboralFilingDialog — Filing-mode dialog for LABORAL workflow (no radicado).
 * Creates a work_item with stage=DRAFT and cgp_phase=FILING equivalent.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
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
import { toast } from "sonner";
import { Plus, ArrowLeft, AlertCircle, Loader2, Users } from "lucide-react";
import { Link } from "react-router-dom";

const LABORAL_SUBTYPES = [
  "Ordinario Laboral",
  "Ejecutivo Laboral",
  "Fuero Sindical",
  "Proceso Especial de Cese de Actividades",
  "Otro Laboral",
];

interface NewLaboralFilingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  onSuccess?: () => void;
  defaultClientId?: string;
}

export function NewLaboralFilingDialog({
  open,
  onOpenChange,
  onBack,
  onSuccess,
  defaultClientId,
}: NewLaboralFilingDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: clients, isLoading: clientsLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, id_number").order("name");
      if (error) throw error;
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .maybeSingle();

      const clientId = formData.get("client_id") as string;
      const subtype = formData.get("subtype") as string;
      const demandantes = formData.get("demandantes") as string;
      const demandados = formData.get("demandados") as string;
      const authorityName = formData.get("authority_name") as string;
      const filingDate = formData.get("filing_date") as string;
      const description = formData.get("description") as string;

      const { data: workItem, error } = await (supabase
        .from("work_items") as any)
        .insert({
          owner_id: user.id,
          organization_id: profile?.organization_id,
          workflow_type: "LABORAL",
          stage: "DRAFT",
          status: "ACTIVE",
          source: "MANUAL",
          title: `${subtype || "Laboral"} - ${demandantes || "Demandante"}`,
          demandantes: demandantes || null,
          demandados: demandados || null,
          authority_name: authorityName || null,
          client_id: clientId || null,
          filing_date: filingDate ? new Date(filingDate).toISOString() : null,
          description: description || null,
          monitoring_enabled: true,
          email_linking_enabled: true,
          is_flagged: false,
        })
        .select("id")
        .single();

      if (error) throw error;
      return workItem;
    },
    onSuccess: (workItem) => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["laboral-work-items"] });
      toast.success("Proceso laboral creado exitosamente");
      onOpenChange(false);
      onSuccess?.();
      if (workItem?.id) navigate(`/work-items/${workItem.id}`);
    },
    onError: (error) => {
      toast.error("Error al crear: " + error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    createMutation.mutate(new FormData(e.currentTarget));
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
              <DialogTitle>Nueva Demanda Laboral</DialogTitle>
              <DialogDescription>
                Proceso judicial laboral — sin número de radicado aún
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {noClients ? (
          <div className="py-8 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">No hay clientes registrados</h3>
            <p className="text-muted-foreground mt-2">Debes crear un cliente antes de crear una radicación.</p>
            <Button asChild className="mt-4">
              <Link to="/clients" onClick={() => onOpenChange(false)}>
                <Plus className="mr-2 h-4 w-4" /> Crear Cliente
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
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.id_number && `(${c.id_number})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subtype">Tipo de Proceso *</Label>
              <Select name="subtype" required>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  {LABORAL_SUBTYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="demandantes">Demandante(s)</Label>
                <Input id="demandantes" name="demandantes" placeholder="Nombre del demandante" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="demandados">Demandado(s)</Label>
                <Input id="demandados" name="demandados" placeholder="Nombre del demandado" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filing_date">Fecha de Radicación</Label>
              <Input id="filing_date" name="filing_date" type="date" defaultValue={new Date().toISOString().split('T')[0]} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="authority_name">Juzgado / Oficina de Reparto</Label>
              <Input id="authority_name" name="authority_name" placeholder="Ej: Juzgado 1° Laboral del Circuito de Medellín" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción / Pretensiones</Label>
              <Textarea id="description" name="description" placeholder="Descripción breve..." rows={3} />
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Nota:</strong> El email del despacho aparecerá cuando se identifique el juzgado
                (vía acta de radicación o número de radicado).
              </AlertDescription>
            </Alert>

            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</>
              ) : (
                <><Plus className="mr-2 h-4 w-4" /> Crear Demanda Laboral</>
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
