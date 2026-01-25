/**
 * Admin Data Lifecycle Tab - Recycle bin with enhanced controls
 * Uses organization_id for multi-tenant scoping (not owner_id)
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
  Trash2, 
  RotateCcw, 
  Loader2, 
  FileText,
  Scale,
  Gavel,
  Briefcase,
  Building2,
  AlertTriangle,
  Search,
  Users,
  AlertCircle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useRestoreWorkItems } from "@/hooks/use-restore-work-items";
import { useDeleteWorkItems } from "@/hooks/use-delete-work-items";
import { useOrganization } from "@/contexts/OrganizationContext";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type WorkflowType = Database["public"]["Enums"]["workflow_type"];

const WORKFLOW_ICONS: Record<WorkflowType, React.ElementType> = {
  CGP: Scale,
  CPACA: Scale,
  TUTELA: Gavel,
  PETICION: FileText,
  GOV_PROCEDURE: Building2,
  LABORAL: Briefcase,
};

const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  CGP: "CGP",
  CPACA: "CPACA",
  TUTELA: "Tutela",
  PETICION: "Petición",
  GOV_PROCEDURE: "Administrativo",
  LABORAL: "Laboral",
};

interface ArchivedItem {
  id: string;
  workflow_type: WorkflowType;
  radicado: string | null;
  title: string | null;
  authority_name: string | null;
  deleted_at: string;
  deleted_by: string | null;
  delete_reason: string | null;
  client?: { name: string } | null;
}

interface ArchivedClient {
  id: string;
  name: string;
  id_number: string | null;
  deleted_at: string;
  deleted_by: string | null;
}

export function AdminDataLifecycleTab() {
  const { organization } = useOrganization();
  const [selectedWorkItems, setSelectedWorkItems] = useState<Set<string>>(new Set());
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [hardDeleteDialogOpen, setHardDeleteDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteType, setDeleteType] = useState<"work_items" | "clients">("work_items");
  const [searchQuery, setSearchQuery] = useState("");

  const { restoreBulk, isRestoring } = useRestoreWorkItems({
    onSuccess: () => setSelectedWorkItems(new Set()),
  });

  const { bulkDelete, isDeleting } = useDeleteWorkItems({
    onSuccess: () => {
      setSelectedWorkItems(new Set());
      setHardDeleteDialogOpen(false);
      setConfirmText("");
    },
  });

  // Fetch archived work items - using organization_id for multi-tenant scoping
  const { data: archivedWorkItems, isLoading: loadingWorkItems } = useQuery({
    queryKey: ["admin-archived-work-items", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];

      const { data, error } = await supabase
        .from("work_items")
        .select(`
          id,
          workflow_type,
          radicado,
          title,
          authority_name,
          deleted_at,
          deleted_by,
          delete_reason,
          client:clients(name)
        `)
        .eq("organization_id", organization.id)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });

      if (error) throw error;
      return (data || []) as ArchivedItem[];
    },
    enabled: !!organization?.id,
  });

  // Fetch archived clients - using organization_id for multi-tenant scoping
  const { data: archivedClients, isLoading: loadingClients } = useQuery({
    queryKey: ["admin-archived-clients", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];

      const { data, error } = await supabase
        .from("clients")
        .select("id, name, id_number, deleted_at, deleted_by")
        .eq("organization_id", organization.id)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });

      if (error) throw error;
      return (data || []) as ArchivedClient[];
    },
    enabled: !!organization?.id,
  });

  // Filter items by search
  const filteredWorkItems = archivedWorkItems?.filter(item => 
    !searchQuery || 
    item.radicado?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.client?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const filteredClients = archivedClients?.filter(client =>
    !searchQuery ||
    client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.id_number?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const toggleWorkItemSelection = (id: string) => {
    const newSelected = new Set(selectedWorkItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedWorkItems(newSelected);
  };

  const toggleClientSelection = (id: string) => {
    const newSelected = new Set(selectedClients);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedClients(newSelected);
  };

  const handleRestore = () => {
    if (selectedWorkItems.size > 0) {
      restoreBulk(Array.from(selectedWorkItems));
    }
  };

  const handleOpenHardDelete = (type: "work_items" | "clients") => {
    setDeleteType(type);
    setHardDeleteDialogOpen(true);
  };

  const handleHardDelete = () => {
    const ids = deleteType === "work_items" 
      ? Array.from(selectedWorkItems) 
      : Array.from(selectedClients);
    
    if (ids.length > 0 && confirmText === `DELETE ${ids.length}`) {
      bulkDelete(ids);
    }
  };

  const selectedCount = deleteType === "work_items" ? selectedWorkItems.size : selectedClients.size;

  // Defensive check: if organization context is not ready
  if (!organization?.id) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Contexto de Organización
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Cargando contexto de organización...
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Las acciones destructivas están deshabilitadas hasta que se cargue el contexto.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por radicado, título o cliente..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs defaultValue="work-items">
        <TabsList>
          <TabsTrigger value="work-items" className="gap-2">
            <Scale className="h-4 w-4" />
            Procesos ({filteredWorkItems.length})
          </TabsTrigger>
          <TabsTrigger value="clients" className="gap-2">
            <Users className="h-4 w-4" />
            Clientes ({filteredClients.length})
          </TabsTrigger>
        </TabsList>

        {/* Work Items Tab */}
        <TabsContent value="work-items">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5" />
                Procesos Archivados
              </CardTitle>
              <CardDescription>
                Elementos archivados de toda la organización. Puedes restaurarlos o eliminarlos permanentemente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingWorkItems ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : filteredWorkItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Trash2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No hay procesos archivados en la organización</p>
                </div>
              ) : (
                <>
                  {/* Bulk actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground">
                      {filteredWorkItems.length} elemento{filteredWorkItems.length !== 1 ? "s" : ""}
                    </span>
                    <div className="flex-1" />
                    {selectedWorkItems.size > 0 && (
                      <>
                        <Badge variant="secondary">{selectedWorkItems.size} seleccionado{selectedWorkItems.size !== 1 ? "s" : ""}</Badge>
                        <Button variant="outline" size="sm" onClick={() => setSelectedWorkItems(new Set())}>
                          Limpiar
                        </Button>
                        <Button 
                          variant="default" 
                          size="sm" 
                          onClick={handleRestore}
                          disabled={isRestoring}
                        >
                          {isRestoring ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4 mr-2" />
                          )}
                          Restaurar
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm" 
                          onClick={() => handleOpenHardDelete("work_items")}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Eliminar Permanentemente
                        </Button>
                      </>
                    )}
                    {selectedWorkItems.size === 0 && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setSelectedWorkItems(new Set(filteredWorkItems.map(i => i.id)))}
                      >
                        Seleccionar todo
                      </Button>
                    )}
                  </div>

                  <Separator />

                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {filteredWorkItems.map((item) => {
                        const Icon = WORKFLOW_ICONS[item.workflow_type] || FileText;
                        const isSelected = selectedWorkItems.has(item.id);

                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer",
                              isSelected 
                                ? "bg-primary/5 border-primary/30" 
                                : "hover:bg-muted/50"
                            )}
                            onClick={() => toggleWorkItemSelection(item.id)}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleWorkItemSelection(item.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <Icon className="h-4 w-4 mt-1 text-muted-foreground flex-shrink-0" />
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-xs">
                                  {WORKFLOW_LABELS[item.workflow_type]}
                                </Badge>
                                {item.radicado && (
                                  <span className="font-mono text-sm">{item.radicado}</span>
                                )}
                              </div>
                              {item.title && (
                                <p className="text-sm truncate">{item.title}</p>
                              )}
                              {item.client?.name && (
                                <p className="text-xs text-muted-foreground">Cliente: {item.client.name}</p>
                              )}
                              {item.delete_reason && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                  Razón: {item.delete_reason}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                Archivado {formatDistanceToNow(new Date(item.deleted_at), { 
                                  addSuffix: true, 
                                  locale: es 
                                })}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Clients Tab */}
        <TabsContent value="clients">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Clientes Archivados
              </CardTitle>
              <CardDescription>
                Clientes archivados de toda la organización.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingClients ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : filteredClients.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No hay clientes archivados en la organización</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground">
                      {filteredClients.length} cliente{filteredClients.length !== 1 ? "s" : ""}
                    </span>
                    <div className="flex-1" />
                    {selectedClients.size > 0 && (
                      <>
                        <Badge variant="secondary">{selectedClients.size} seleccionado{selectedClients.size !== 1 ? "s" : ""}</Badge>
                        <Button variant="outline" size="sm" onClick={() => setSelectedClients(new Set())}>
                          Limpiar
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm" 
                          onClick={() => handleOpenHardDelete("clients")}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Eliminar Permanentemente
                        </Button>
                      </>
                    )}
                  </div>

                  <Separator />

                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2">
                      {filteredClients.map((client) => {
                        const isSelected = selectedClients.has(client.id);

                        return (
                          <div
                            key={client.id}
                            className={cn(
                              "flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer",
                              isSelected 
                                ? "bg-primary/5 border-primary/30" 
                                : "hover:bg-muted/50"
                            )}
                            onClick={() => toggleClientSelection(client.id)}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleClientSelection(client.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <Users className="h-4 w-4 mt-1 text-muted-foreground flex-shrink-0" />
                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="font-medium">{client.name}</p>
                              {client.id_number && (
                                <p className="text-sm text-muted-foreground">{client.id_number}</p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                Archivado {formatDistanceToNow(new Date(client.deleted_at), { 
                                  addSuffix: true, 
                                  locale: es 
                                })}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Hard delete confirmation dialog */}
      <AlertDialog open={hardDeleteDialogOpen} onOpenChange={setHardDeleteDialogOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 text-destructive">
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <AlertDialogTitle className="text-lg">
                Eliminar permanentemente
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-4 pt-4">
              <p>
                Estás a punto de eliminar permanentemente <strong>{selectedCount} elemento{selectedCount !== 1 ? "s" : ""}</strong>.
              </p>

              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 space-y-2">
                <div className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div className="text-sm space-y-1">
                    <p className="font-medium">Esta acción es IRREVERSIBLE:</p>
                    <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                      <li>Todos los datos asociados serán eliminados</li>
                      <li>No podrás recuperar estos datos</li>
                      <li>La acción quedará en el historial de auditoría</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm">
                  Escribe <code className="bg-muted px-1.5 py-0.5 rounded text-destructive font-mono">DELETE {selectedCount}</code> para confirmar:
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                  placeholder={`DELETE ${selectedCount}`}
                  className="w-full px-3 py-2 border rounded-md font-mono text-sm"
                  disabled={isDeleting}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel 
              disabled={isDeleting}
              onClick={() => setConfirmText("")}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleHardDelete}
              disabled={confirmText !== `DELETE ${selectedCount}` || isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Eliminando...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar permanentemente
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
