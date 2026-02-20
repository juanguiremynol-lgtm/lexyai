/**
 * WorkItemDocumentsTab — Lists generated documents for a work item
 * with create buttons, status badges, and navigation to detail/wizard.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileText, Plus, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { WorkItem } from "@/types/work-item";

interface Props {
  workItem: WorkItem & { _source?: string };
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "warning" | "success" }> = {
  draft: { label: "Borrador", variant: "secondary" },
  finalized: { label: "Finalizado", variant: "outline" },
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
};

export function WorkItemDocumentsTab({ workItem }: Props) {
  const navigate = useNavigate();

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
        <NewDocumentDropdown onSelect={goToWizard} />
      </div>

      {/* Document list */}
      <div className="space-y-3">
        {documents.map((doc) => {
          const status = STATUS_CONFIG[doc.status] || STATUS_CONFIG.draft;
          const vars = (doc.variables || {}) as Record<string, string>;
          const typeLabel = DOC_TYPE_LABELS[doc.document_type] || doc.document_type;

          return (
            <Card
              key={doc.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => goToDetail(doc.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5 text-primary" />
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
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** Reusable dropdown for creating new documents */
export function NewDocumentDropdown({ onSelect, variant = "default" }: {
  onSelect: (type: string) => void;
  variant?: "default" | "outline" | "ghost";
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
          Poder Especial
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("contrato_servicios")}>
          Contrato de Servicios
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("paz_y_salvo")}>
          Paz y Salvo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
