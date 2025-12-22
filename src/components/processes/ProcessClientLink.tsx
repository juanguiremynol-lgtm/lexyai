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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Link as LinkIcon, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
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

  const linkMutation = useMutation({
    mutationFn: async (clientId: string | null) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ client_id: clientId })
        .eq("id", processId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cambiar Cliente</DialogTitle>
              <DialogDescription>
                Radicado: {processRadicado}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
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
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleLink} disabled={linkMutation.isPending}>
                {linkMutation.isPending ? "Guardando..." : "Guardar"}
              </Button>
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
      <Dialog open={open} onOpenChange={setOpen}>
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
          <div className="space-y-4 py-4">
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
              <Button variant="outline" className="w-full" asChild>
                <Link to="/clients">
                  <Plus className="h-4 w-4 mr-2" />
                  Crear Nuevo Cliente
                </Link>
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleLink}
              disabled={!selectedClientId || linkMutation.isPending}
            >
              {linkMutation.isPending ? "Vinculando..." : "Vincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
