/**
 * AddSourceDialog — Attach an external provider source or a link-only reference to a work item.
 * Two modes: "connector" (resolve via provider API) and "link" (simple URL bookmark).
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Plug, Link as LinkIcon, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";

interface AddSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItemId: string;
}

export function AddSourceDialog({ open, onOpenChange, workItemId }: AddSourceDialogProps) {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const orgId = organization?.id;

  // Connector mode state
  const [instanceId, setInstanceId] = useState("");
  const [inputType, setInputType] = useState("RADICADO");
  const [inputValue, setInputValue] = useState("");

  // Link mode state
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkKind, setLinkKind] = useState("REFERENCE");

  // Load available instances
  const { data: instances = [] } = useQuery({
    queryKey: ["provider-instances", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("provider_instances")
        .select("id, name, base_url, auth_type, provider_connectors(name, capabilities)")
        .eq("organization_id", orgId)
        .eq("is_enabled", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && open,
  });

  // Resolve & attach source
  const resolveMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("provider-resolve-source", {
        body: {
          work_item_id: workItemId,
          provider_instance_id: instanceId,
          input_type: inputType,
          value: inputValue,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-sources", workItemId] });
      toast.success(`Fuente conectada (case: ${data.provider_case_id || "resuelto"})`);
      resetAndClose();
    },
    onError: (err) => toast.error("Error al resolver: " + err.message),
  });

  // Add link-only reference
  const linkMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("work_item_external_links").insert({
        organization_id: orgId,
        work_item_id: workItemId,
        label: linkLabel || null,
        url: linkUrl,
        kind: linkKind,
        created_by: (await supabase.auth.getUser()).data.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-item-external-links", workItemId] });
      toast.success("Enlace agregado");
      resetAndClose();
    },
    onError: (err) => toast.error("Error: " + err.message),
  });

  function resetAndClose() {
    setInstanceId("");
    setInputType("RADICADO");
    setInputValue("");
    setLinkLabel("");
    setLinkUrl("");
    setLinkKind("REFERENCE");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar Fuente</DialogTitle>
          <DialogDescription>
            Conecta una fuente de datos externa o agrega un enlace de referencia
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="connector" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="connector" className="gap-1">
              <Plug className="h-3 w-3" />
              Proveedor API
            </TabsTrigger>
            <TabsTrigger value="link" className="gap-1">
              <LinkIcon className="h-3 w-3" />
              Enlace
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connector" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Instancia de Proveedor</Label>
              <Select value={instanceId} onValueChange={setInstanceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona proveedor" />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((inst: any) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.name} — {inst.provider_connectors?.name || ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {instances.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No hay proveedores configurados. Configura uno en Ajustes → Proveedores.
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={inputType} onValueChange={setInputType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RADICADO">Radicado</SelectItem>
                    <SelectItem value="URL">URL</SelectItem>
                    <SelectItem value="EXTERNAL_ID">ID Externo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Valor</Label>
                <Input
                  placeholder={inputType === "RADICADO" ? "11001-31-03-001-2025-00001-00" : "https://..."}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => resolveMutation.mutate()}
              disabled={resolveMutation.isPending || !instanceId || !inputValue}
            >
              {resolveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Resolver y Conectar
            </Button>
          </TabsContent>

          <TabsContent value="link" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>URL</Label>
              <Input
                placeholder="https://..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Etiqueta (opcional)</Label>
                <Input
                  placeholder="Expediente digital"
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={linkKind} onValueChange={setLinkKind}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REFERENCE">Referencia</SelectItem>
                    <SelectItem value="MICROSITE">Micrositio</SelectItem>
                    <SelectItem value="JUDGE_LINK">Juzgado</SelectItem>
                    <SelectItem value="PAYMENT">Pago</SelectItem>
                    <SelectItem value="OTHER">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => linkMutation.mutate()}
              disabled={linkMutation.isPending || !linkUrl}
            >
              {linkMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Agregar Enlace
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
