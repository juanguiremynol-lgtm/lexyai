import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  Archive, 
  RotateCcw, 
  Trash2, 
  Loader2, 
  FileText,
  Scale,
  Gavel,
  Briefcase,
  Building2,
  AlertTriangle,
  Shield,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useRestoreWorkItems } from "@/hooks/use-restore-work-items";
import { useDeleteWorkItems } from "@/hooks/use-delete-work-items";
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
  PENAL_906: Shield,
};

const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  CGP: "CGP",
  CPACA: "CPACA",
  TUTELA: "Tutela",
  PETICION: "Petición",
  GOV_PROCEDURE: "Administrativo",
  LABORAL: "Laboral",
  PENAL_906: "Penal",
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

export function ArchivedItemsSection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hardDeleteDialogOpen, setHardDeleteDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const { restoreBulk, isRestoring } = useRestoreWorkItems({
    onSuccess: () => setSelectedIds(new Set()),
  });

  const { bulkDelete, isDeleting } = useDeleteWorkItems({
    onSuccess: () => {
      setSelectedIds(new Set());
      setHardDeleteDialogOpen(false);
      setConfirmText("");
    },
  });

  // Fetch archived work items
  const { data: archivedItems, isLoading } = useQuery({
    queryKey: ["archived-work-items"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

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
        .eq("owner_id", user.id)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });

      if (error) throw error;
      return (data || []) as ArchivedItem[];
    },
  });

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    if (archivedItems) {
      setSelectedIds(new Set(archivedItems.map((item) => item.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleRestore = () => {
    if (selectedIds.size > 0) {
      restoreBulk(Array.from(selectedIds));
    }
  };

  const handleHardDelete = () => {
    if (selectedIds.size > 0 && confirmText === `DELETE ${selectedIds.size}`) {
      bulkDelete(Array.from(selectedIds));
    }
  };

  const selectedCount = selectedIds.size;
  const isValid = confirmText === `DELETE ${selectedCount}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="h-5 w-5" />
          Elementos Archivados
        </CardTitle>
        <CardDescription>
          Elementos que han sido archivados (eliminación suave). Puedes restaurarlos o eliminarlos permanentemente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !archivedItems || archivedItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Archive className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No hay elementos archivados</p>
          </div>
        ) : (
          <>
            {/* Bulk actions bar */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">
                {archivedItems.length} elemento{archivedItems.length !== 1 ? "s" : ""} archivado{archivedItems.length !== 1 ? "s" : ""}
              </span>
              <div className="flex-1" />
              {selectedCount > 0 && (
                <>
                  <Badge variant="secondary">{selectedCount} seleccionado{selectedCount !== 1 ? "s" : ""}</Badge>
                  <Button variant="outline" size="sm" onClick={clearSelection}>
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
                    onClick={() => setHardDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Eliminar permanentemente
                  </Button>
                </>
              )}
              {selectedCount === 0 && (
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Seleccionar todo
                </Button>
              )}
            </div>

            <Separator />

            {/* Items list */}
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {archivedItems.map((item) => {
                  const Icon = WORKFLOW_ICONS[item.workflow_type] || FileText;
                  const isSelected = selectedIds.has(item.id);

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer",
                        isSelected 
                          ? "bg-primary/5 border-primary/30" 
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => toggleSelection(item.id)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelection(item.id)}
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
                        {item.authority_name && (
                          <p className="text-xs text-muted-foreground truncate">{item.authority_name}</p>
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
                        <li>Todos los documentos y archivos serán eliminados</li>
                        <li>Actuaciones y eventos serán eliminados</li>
                        <li>No podrás recuperar estos datos</li>
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
                disabled={!isValid || isDeleting}
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
      </CardContent>
    </Card>
  );
}
