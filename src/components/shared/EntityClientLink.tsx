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

type EntityType = "peticion" | "tutela" | "filing" | "process";

interface EntityClientLinkProps {
  entityId: string;
  entityType: EntityType;
  entityLabel: string;
  currentClientId?: string | null;
  currentClientName?: string | null;
  onLinked?: () => void;
  compact?: boolean;
}

export function EntityClientLink({
  entityId,
  entityType,
  entityLabel,
  currentClientId,
  currentClientName,
  onLinked,
  compact = false,
}: EntityClientLinkProps) {
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

  const getTableName = (type: EntityType): "peticiones" | "filings" | "monitored_processes" => {
    switch (type) {
      case "peticion":
        return "peticiones";
      case "tutela":
      case "filing":
        return "filings";
      case "process":
        return "monitored_processes";
    }
  };

  const getQueryKey = (type: EntityType): string => {
    switch (type) {
      case "peticion":
        return "peticiones";
      case "tutela":
        return "tutelas";
      case "filing":
        return "filings";
      case "process":
        return "monitored-processes";
    }
  };

  const linkMutation = useMutation({
    mutationFn: async (clientId: string | null) => {
      const tableName = getTableName(entityType);
      const { error } = await supabase
        .from(tableName)
        .update({ client_id: clientId })
        .eq("id", entityId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [getQueryKey(entityType)] });
      if (entityType === "process") {
        queryClient.invalidateQueries({ queryKey: ["unlinked-processes"] });
      }
      setOpen(false);
      toast.success("Cliente vinculado");
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

  const handleUnlink = () => {
    linkMutation.mutate(null);
  };

  if (currentClientId && currentClientName) {
    if (compact) {
      return (
        <Badge
          variant="secondary"
          className="flex items-center gap-1 cursor-pointer hover:bg-secondary/80"
          onClick={() => setOpen(true)}
        >
          <Users className="h-3 w-3" />
          {currentClientName}
        </Badge>
      );
    }

    return (
      <>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {currentClientName}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Cambiar
          </Button>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cambiar Cliente</DialogTitle>
              <DialogDescription>
                {entityLabel}
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
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="destructive" onClick={handleUnlink} disabled={linkMutation.isPending}>
                Desvincular
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleLink} disabled={linkMutation.isPending}>
                {linkMutation.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (compact) {
    return (
      <Badge
        variant="outline"
        className="flex items-center gap-1 cursor-pointer text-amber-600 border-amber-300 hover:bg-amber-50"
        onClick={() => setOpen(true)}
      >
        <AlertTriangle className="h-3 w-3" />
        Sin cliente
      </Badge>
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
              Vincular a Cliente
            </DialogTitle>
            <DialogDescription>
              {entityLabel}
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
