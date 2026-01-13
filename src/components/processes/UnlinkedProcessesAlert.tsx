import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Link as LinkIcon, Users, Trash2, Loader2 } from "lucide-react";
import { ProcessClientLink } from "./ProcessClientLink";
import { formatDateColombia } from "@/lib/constants";
import { toast } from "sonner";
import { useState } from "react";

interface UnlinkedProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  created_at: string;
}

export function UnlinkedProcessesAlert() {
  const [processToDelete, setProcessToDelete] = useState<UnlinkedProcess | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLinkDialogOpen, setBulkLinkDialogOpen] = useState(false);
  const [bulkClientId, setBulkClientId] = useState<string>("");
  const queryClient = useQueryClient();

  const { data: unlinkedProcesses, refetch } = useQuery({
    queryKey: ["unlinked-processes"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("monitored_processes")
        .select("id, radicado, despacho_name, created_at")
        .eq("owner_id", user.id)
        .is("client_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as UnlinkedProcess[];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-for-bulk-link"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, id_number")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (processId: string) => {
      const { error } = await supabase
        .from("monitored_processes")
        .delete()
        .eq("id", processId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unlinked-processes"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success("Proceso eliminado de la lista de monitoreo");
      setProcessToDelete(null);
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const bulkLinkMutation = useMutation({
    mutationFn: async ({ processIds, clientId }: { processIds: string[]; clientId: string }) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ client_id: clientId })
        .in("id", processIds);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unlinked-processes"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success(`${selectedIds.size} proceso(s) vinculados exitosamente`);
      setSelectedIds(new Set());
      setBulkLinkDialogOpen(false);
      setBulkClientId("");
    },
    onError: (error) => {
      toast.error("Error al vincular: " + error.message);
    },
  });

  const handleSelectAll = () => {
    if (!unlinkedProcesses) return;
    if (selectedIds.size === unlinkedProcesses.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unlinkedProcesses.map(p => p.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleBulkLink = () => {
    if (!bulkClientId) {
      toast.error("Seleccione un cliente");
      return;
    }
    bulkLinkMutation.mutate({
      processIds: Array.from(selectedIds),
      clientId: bulkClientId,
    });
  };

  if (!unlinkedProcesses || unlinkedProcesses.length === 0) {
    return null;
  }

  const allSelected = selectedIds.size === unlinkedProcesses.length;
  const someSelected = selectedIds.size > 0;

  return (
    <>
      <Alert variant="default" className="border-amber-300 bg-amber-50">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-800 flex items-center justify-between">
          <span>{unlinkedProcesses.length} proceso(s) sin vincular a cliente</span>
          {someSelected && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setBulkLinkDialogOpen(true)}
              className="ml-4"
            >
              <LinkIcon className="h-4 w-4 mr-1" />
              Vincular {selectedIds.size} seleccionados
            </Button>
          )}
        </AlertTitle>
        <AlertDescription className="text-amber-700">
          <p className="mb-3">
            Vincule estos procesos a un cliente para organizar mejor su información.
          </p>
          <ScrollArea className="max-h-[200px]">
            <div className="space-y-2 pr-4">
              {unlinkedProcesses.map((process) => (
                <div key={process.id} className="flex items-center justify-between bg-white p-2 rounded border gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Checkbox
                      checked={selectedIds.has(process.id)}
                      onCheckedChange={() => handleSelectOne(process.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <code className="text-xs block truncate">{process.radicado}</code>
                      {process.despacho_name && (
                        <p className="text-xs text-muted-foreground truncate">{process.despacho_name}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <ProcessClientLink
                      processId={process.id}
                      processRadicado={process.radicado}
                      onLinked={() => refetch()}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setProcessToDelete(process)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          {unlinkedProcesses.length > 1 && (
            <div className="mt-3 flex items-center gap-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={handleSelectAll}
                id="select-all"
              />
              <label htmlFor="select-all" className="text-sm cursor-pointer">
                Seleccionar todos
              </label>
            </div>
          )}
        </AlertDescription>
      </Alert>

      <AlertDialog open={!!processToDelete} onOpenChange={(open) => !open && setProcessToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar proceso?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el proceso <strong>{processToDelete?.radicado}</strong> de la lista de monitoreo.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => processToDelete && deleteMutation.mutate(processToDelete.id)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Link Dialog */}
      <Dialog open={bulkLinkDialogOpen} onOpenChange={setBulkLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Vincular {selectedIds.size} Procesos
            </DialogTitle>
            <DialogDescription>
              Seleccione el cliente al que desea vincular los procesos seleccionados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Select value={bulkClientId} onValueChange={setBulkClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name} {client.id_number && `(${client.id_number})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              Procesos a vincular:
              <ul className="mt-2 space-y-1 max-h-32 overflow-auto">
                {Array.from(selectedIds).map(id => {
                  const p = unlinkedProcesses.find(proc => proc.id === id);
                  return p ? (
                    <li key={id} className="font-mono text-xs">{p.radicado}</li>
                  ) : null;
                })}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkLinkDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleBulkLink}
              disabled={!bulkClientId || bulkLinkMutation.isPending}
            >
              {bulkLinkMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Vinculando...
                </>
              ) : (
                <>
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Vincular
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UnlinkedProcessesPage() {
  const [processToDelete, setProcessToDelete] = useState<UnlinkedProcess | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLinkDialogOpen, setBulkLinkDialogOpen] = useState(false);
  const [bulkClientId, setBulkClientId] = useState<string>("");
  const queryClient = useQueryClient();

  const { data: unlinkedProcesses, isLoading, refetch } = useQuery({
    queryKey: ["unlinked-processes"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("monitored_processes")
        .select("id, radicado, despacho_name, created_at")
        .eq("owner_id", user.id)
        .is("client_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as UnlinkedProcess[];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-for-bulk-link"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, id_number")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (processId: string) => {
      const { error } = await supabase
        .from("monitored_processes")
        .delete()
        .eq("id", processId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unlinked-processes"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success("Proceso eliminado de la lista de monitoreo");
      setProcessToDelete(null);
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const bulkLinkMutation = useMutation({
    mutationFn: async ({ processIds, clientId }: { processIds: string[]; clientId: string }) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ client_id: clientId })
        .in("id", processIds);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unlinked-processes"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success(`${selectedIds.size} proceso(s) vinculados exitosamente`);
      setSelectedIds(new Set());
      setBulkLinkDialogOpen(false);
      setBulkClientId("");
    },
    onError: (error) => {
      toast.error("Error al vincular: " + error.message);
    },
  });

  const handleSelectAll = () => {
    if (!unlinkedProcesses) return;
    if (selectedIds.size === unlinkedProcesses.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unlinkedProcesses.map(p => p.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleBulkLink = () => {
    if (!bulkClientId) {
      toast.error("Seleccione un cliente");
      return;
    }
    bulkLinkMutation.mutate({
      processIds: Array.from(selectedIds),
      clientId: bulkClientId,
    });
  };

  const allSelected = unlinkedProcesses && selectedIds.size === unlinkedProcesses.length;
  const someSelected = selectedIds.size > 0;

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-serif font-bold">Procesos Sin Vincular</h1>
            <p className="text-muted-foreground">
              Vincule procesos a clientes para organizar mejor su información
            </p>
          </div>
          {someSelected && (
            <Button onClick={() => setBulkLinkDialogOpen(true)}>
              <LinkIcon className="h-4 w-4 mr-2" />
              Vincular {selectedIds.size} seleccionados
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LinkIcon className="h-5 w-5" />
              Procesos Pendientes de Vinculación
            </CardTitle>
            <CardDescription>
              Estos procesos no están asociados a ningún cliente
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Cargando...</div>
            ) : unlinkedProcesses?.length === 0 ? (
              <div className="text-center py-12">
                <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <h3 className="mt-4 text-lg font-medium">Todos los procesos están vinculados</h3>
                <p className="text-muted-foreground">
                  No hay procesos pendientes de vincular a un cliente
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Radicado</TableHead>
                    <TableHead>Despacho</TableHead>
                    <TableHead>Agregado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unlinkedProcesses?.map((process) => (
                    <TableRow key={process.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(process.id)}
                          onCheckedChange={() => handleSelectOne(process.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <code className="text-sm bg-muted px-2 py-1 rounded">
                          {process.radicado}
                        </code>
                      </TableCell>
                      <TableCell>{process.despacho_name || "—"}</TableCell>
                      <TableCell>{formatDateColombia(process.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <ProcessClientLink
                            processId={process.id}
                            processRadicado={process.radicado}
                            onLinked={() => refetch()}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setProcessToDelete(process)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!processToDelete} onOpenChange={(open) => !open && setProcessToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar proceso?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el proceso <strong>{processToDelete?.radicado}</strong> de la lista de monitoreo.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => processToDelete && deleteMutation.mutate(processToDelete.id)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Link Dialog */}
      <Dialog open={bulkLinkDialogOpen} onOpenChange={setBulkLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Vincular {selectedIds.size} Procesos
            </DialogTitle>
            <DialogDescription>
              Seleccione el cliente al que desea vincular los procesos seleccionados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Select value={bulkClientId} onValueChange={setBulkClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name} {client.id_number && `(${client.id_number})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              Procesos a vincular:
              <ul className="mt-2 space-y-1 max-h-32 overflow-auto">
                {Array.from(selectedIds).map(id => {
                  const p = unlinkedProcesses?.find(proc => proc.id === id);
                  return p ? (
                    <li key={id} className="font-mono text-xs">{p.radicado}</li>
                  ) : null;
                })}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkLinkDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleBulkLink}
              disabled={!bulkClientId || bulkLinkMutation.isPending}
            >
              {bulkLinkMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Vinculando...
                </>
              ) : (
                <>
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Vincular
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
