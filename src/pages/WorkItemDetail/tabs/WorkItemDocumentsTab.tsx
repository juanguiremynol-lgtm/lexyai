/**
 * WorkItemDocumentsTab — Lists generated documents for a work item
 * with create buttons, status badges, delete, and navigation to detail/wizard.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileText, Plus, ChevronDown, ChevronRight, Loader2, Mail, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import type { WorkItem } from "@/types/work-item";

interface Props {
  workItem: WorkItem & { _source?: string };
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "warning" | "success" }> = {
  draft: { label: "Borrador", variant: "secondary" },
  finalized: { label: "Finalizado", variant: "outline" },
  generated: { label: "Generado", variant: "outline" },
  delivered_to_lawyer: { label: "Entregado", variant: "success" },
  sent_for_signature: { label: "Pendiente de firma", variant: "warning" },
  partially_signed: { label: "Parcialmente firmado", variant: "warning" },
  signed: { label: "Firmado", variant: "success" },
  declined: { label: "Rechazado", variant: "destructive" },
  expired: { label: "Vencido", variant: "destructive" },
  revoked: { label: "Revocado", variant: "destructive" },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  poder_especial: "Poder Especial",
  contrato_servicios: "Contrato de Servicios",
  paz_y_salvo: "Paz y Salvo",
  notificacion_personal: "Notificación Personal",
  notificacion_por_aviso: "Notificación por Aviso",
};

export function WorkItemDocumentsTab({ workItem }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["work-item-generated-docs", workItem.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("id, title, document_type, status, created_at, finalized_at, variables")
        .eq("work_item_id", workItem.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      const { data, error } = await supabase.functions.invoke("delete-generated-document", {
        body: { document_id: docId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Error al eliminar");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-item-generated-docs", workItem.id] });
      toast.success("Documento eliminado");
      setDeleteDocId(null);
    },
    onError: (err) => {
      toast.error("Error al eliminar: " + (err as Error).message);
    },
  });

  const goToWizard = (type: string) => {
    navigate(`/app/work-items/${workItem.id}/documents/new?type=${type}`);
  };

  const goToDetail = (docId: string) => {
    navigate(`/app/work-items/${workItem.id}/documents/${docId}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Empty state
  if (!documents || documents.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center space-y-4">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
            <div>
              <h3 className="font-semibold mb-1">No hay documentos generados</h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Genere poderes, contratos u otros documentos legales que se completarán automáticamente con los datos del expediente.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Button onClick={() => goToWizard("poder_especial")}>
                <Plus className="h-4 w-4 mr-2" />
                Generar Poder Especial
              </Button>
              <Button variant="outline" onClick={() => goToWizard("contrato_servicios")}>
                <Plus className="h-4 w-4 mr-2" />
                Generar Contrato
              </Button>
              <Button variant="outline" onClick={() => goToWizard("paz_y_salvo")}>
                <Plus className="h-4 w-4 mr-2" />
                Generar Paz y Salvo
              </Button>
              {workItem.radicado && (
                <>
                  <Button variant="outline" onClick={() => goToWizard("notificacion_personal")}>
                    <Mail className="h-4 w-4 mr-2" />
                    Notificación Personal
                  </Button>
                  <Button variant="outline" onClick={() => goToWizard("notificacion_por_aviso")}>
                    <Mail className="h-4 w-4 mr-2" />
                    Notificación por Aviso
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <NewDocumentDropdown onSelect={goToWizard} hasRadicado={!!workItem.radicado?.trim()} />
      </div>

      {/* Document list */}
      <div className="space-y-3">
        {documents.map((doc) => {
          const status = STATUS_CONFIG[doc.status] || STATUS_CONFIG.draft;
          const vars = (doc.variables || {}) as Record<string, string>;
          const typeLabel = DOC_TYPE_LABELS[doc.document_type] || doc.document_type;
          const isNotif = doc.document_type === 'notificacion_personal' || doc.document_type === 'notificacion_por_aviso';

          return (
            <Card
              key={doc.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => goToDetail(doc.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className={`h-10 w-10 rounded-lg ${isNotif ? 'bg-blue-100 dark:bg-blue-950' : 'bg-primary/10'} flex items-center justify-center shrink-0`}>
                    {isNotif ? <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" /> : <FileText className="h-5 w-5 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium truncate">{typeLabel}</p>
                      <Badge variant={status.variant as any}>{status.label}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      {vars.client_full_name && (
                        <span className="truncate">{vars.client_full_name}</span>
                      )}
                      <span>
                        {format(new Date(doc.created_at), "d MMM yyyy", { locale: es })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteDocId(doc.id);
                      }}
                      title="Eliminar documento"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={!!deleteDocId} onOpenChange={() => setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar documento?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará el documento, sus firmas y registros de auditoría asociados. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteDocId && deleteMutation.mutate(deleteDocId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Reusable dropdown for creating new documents */
export function NewDocumentDropdown({ onSelect, variant = "default", hasRadicado = false }: {
  onSelect: (type: string) => void;
  variant?: "default" | "outline" | "ghost";
  hasRadicado?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm">
          <FileText className="h-4 w-4 mr-2" />
          Generar documento
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onSelect("poder_especial")}>
          <FileText className="h-4 w-4 mr-2" />
          Poder Especial
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("contrato_servicios")}>
          <FileText className="h-4 w-4 mr-2" />
          Contrato de Servicios
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("paz_y_salvo")}>
          <FileText className="h-4 w-4 mr-2" />
          Paz y Salvo
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onSelect("notificacion_personal")} disabled={!hasRadicado}>
          <Mail className="h-4 w-4 mr-2" />
          Notificación Personal (Art. 291)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("notificacion_por_aviso")} disabled={!hasRadicado}>
          <Mail className="h-4 w-4 mr-2" />
          Notificación por Aviso (Art. 292)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
