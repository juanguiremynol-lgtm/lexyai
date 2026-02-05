import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Link as LinkIcon, Plus, Users, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Client } from "@/types/client";

interface ProcessClientLinkProps {
  processId: string;
  processRadicado: string;
  currentClientId?: string | null;
  currentClientName?: string | null;
  onLinked?: () => void;
}

export function ProcessClientLink({
  processId,
  processRadicado,
  currentClientId,
  currentClientName,
  onLinked,
}: ProcessClientLinkProps) {
  const [open, setOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string>(currentClientId || "");
  const [clientTab, setClientTab] = useState<"existing" | "new">("existing");
  const [newClientName, setNewClientName] = useState("");
  const [newClientIdNumber, setNewClientIdNumber] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const queryClient = useQueryClient();

  const { data: clients } = useQuery({
    queryKey: ["clients-for-link"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, id_number")
        .order("name");
      if (error) throw error;
      return data as Pick<Client, "id" | "name" | "id_number">[];
    },
  });

  // Create new client mutation
  const createClientMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const { data, error } = await supabase
        .from("clients")
        .insert({
          owner_id: user.id,
          name: newClientName.trim(),
          id_number: newClientIdNumber.trim() || null,
          email: newClientEmail.trim() || null,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["clients-for-link"] });
      setSelectedClientId(data.id);
      setClientTab("existing");
      setNewClientName("");
      setNewClientIdNumber("");
      setNewClientEmail("");
      toast.success("Cliente creado exitosamente");
    },
    onError: (error) => {
      toast.error("Error al crear cliente: " + error.message);
    },
  });

  const linkMutation = useMutation({
    mutationFn: async (clientId: string | null) => {
      // Update work_items instead of monitored_processes
      const { error } = await supabase
        .from("work_items")
        .update({ client_id: clientId })
        .eq("id", processId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["unlinked-processes"] });
      setOpen(false);
      toast.success("Proceso vinculado al cliente");
      onLinked?.();
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const handleLink = () => {
    if (!selectedClientId) {
      toast.error("Seleccione un cliente");
      return;
    }
    linkMutation.mutate(selectedClientId);
  };

  const handleCreateAndLink = async () => {
    if (!newClientName.trim()) {
      toast.error("Ingrese el nombre del cliente");
      return;
    }
    
    try {
      const result = await createClientMutation.mutateAsync();
      // After creating, link to the new client
      linkMutation.mutate(result.id);
    } catch {
      // Error already handled in mutation
    }
  };

  const resetForm = () => {
    setSelectedClientId(currentClientId || "");
    setClientTab("existing");
    setNewClientName("");
    setNewClientIdNumber("");
    setNewClientEmail("");
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      resetForm();
    }
  };

  if (currentClientId && currentClientName) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {currentClientName}
        </Badge>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Cambiar
        </Button>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cambiar Cliente</DialogTitle>
              <DialogDescription>
                Radicado: {processRadicado}
              </DialogDescription>
            </DialogHeader>
            
            <Tabs value={clientTab} onValueChange={(v) => setClientTab(v as "existing" | "new")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="existing">
                  <Users className="h-4 w-4 mr-2" />
                  Existente
                </TabsTrigger>
                <TabsTrigger value="new">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Nuevo
                </TabsTrigger>
              </TabsList>

              <TabsContent value="existing" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Select value={selectedClientId} onValueChange={setSelectedClientId}>
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
              </TabsContent>

              <TabsContent value="new" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="new-name">Nombre *</Label>
                  <Input
                    id="new-name"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="Nombre completo o razón social"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-id">Cédula / NIT</Label>
                  <Input
                    id="new-id"
                    value={newClientIdNumber}
                    onChange={(e) => setNewClientIdNumber(e.target.value)}
                    placeholder="Número de identificación"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-email">Correo</Label>
                  <Input
                    id="new-email"
                    type="email"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                    placeholder="cliente@ejemplo.com"
                  />
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              {clientTab === "existing" ? (
                <Button onClick={handleLink} disabled={linkMutation.isPending}>
                  {linkMutation.isPending ? "Guardando..." : "Guardar"}
                </Button>
              ) : (
                <Button 
                  onClick={handleCreateAndLink} 
                  disabled={createClientMutation.isPending || linkMutation.isPending || !newClientName.trim()}
                >
                  {(createClientMutation.isPending || linkMutation.isPending) ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creando...
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Crear y Vincular
                    </>
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-amber-600 border-amber-300 hover:bg-amber-50"
      >
        <AlertTriangle className="h-4 w-4 mr-1" />
        Sin Cliente
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LinkIcon className="h-5 w-5" />
              Vincular Proceso a Cliente
            </DialogTitle>
            <DialogDescription>
              El proceso <strong>{processRadicado}</strong> no está vinculado a ningún cliente.
              Vincúlelo para organizar mejor sus procesos.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={clientTab} onValueChange={(v) => setClientTab(v as "existing" | "new")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="existing">
                <Users className="h-4 w-4 mr-2" />
                Cliente Existente
              </TabsTrigger>
              <TabsTrigger value="new">
                <UserPlus className="h-4 w-4 mr-2" />
                Nuevo Cliente
              </TabsTrigger>
            </TabsList>

            <TabsContent value="existing" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Seleccionar Cliente</Label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients?.length === 0 ? (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        No hay clientes. Cree uno primero.
                      </div>
                    ) : (
                      clients?.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name} {client.id_number && `(${client.id_number})`}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              {clients?.length === 0 && (
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => setClientTab("new")}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Crear Nuevo Cliente
                </Button>
              )}
            </TabsContent>

            <TabsContent value="new" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="link-new-name">Nombre del Cliente *</Label>
                <Input
                  id="link-new-name"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Nombre completo o razón social"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="link-new-id">Cédula / NIT</Label>
                <Input
                  id="link-new-id"
                  value={newClientIdNumber}
                  onChange={(e) => setNewClientIdNumber(e.target.value)}
                  placeholder="Número de identificación"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="link-new-email">Correo Electrónico</Label>
                <Input
                  id="link-new-email"
                  type="email"
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  placeholder="cliente@ejemplo.com"
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
            {clientTab === "existing" ? (
              <Button
                onClick={handleLink}
                disabled={!selectedClientId || linkMutation.isPending}
              >
                {linkMutation.isPending ? "Vinculando..." : "Vincular"}
              </Button>
            ) : (
              <Button
                onClick={handleCreateAndLink}
                disabled={!newClientName.trim() || createClientMutation.isPending || linkMutation.isPending}
              >
                {(createClientMutation.isPending || linkMutation.isPending) ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creando...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Crear y Vincular
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
