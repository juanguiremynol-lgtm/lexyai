/**
 * PostCreationDocumentPrompt — Modal shown after work item creation
 * offering to generate contract/poder immediately
 */

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, FileText, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getWorkflowTypeLabel } from "@/lib/legal-document-templates";

export interface PostCreationDocumentPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItemId: string;
  workItemTitle?: string;
  workflowType?: string;
  radicado?: string;
  clientName?: string;
}

export function PostCreationDocumentPrompt({
  open,
  onOpenChange,
  workItemId,
  workItemTitle,
  workflowType,
  radicado,
  clientName,
}: PostCreationDocumentPromptProps) {
  const navigate = useNavigate();

  const handleGenerateContract = () => {
    onOpenChange(false);
    navigate(`/app/work-items/${workItemId}/documents/new?type=contrato_servicios&from=creation`);
  };

  const handleGeneratePoder = () => {
    onOpenChange(false);
    navigate(`/app/work-items/${workItemId}/documents/new?type=poder_especial&from=creation`);
  };

  const handleSkip = () => {
    onOpenChange(false);
    navigate(`/app/work-items/${workItemId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            Expediente creado exitosamente
          </DialogTitle>
          <DialogDescription className="space-y-1">
            <span className="block">
              {clientName || workItemTitle || 'Nuevo expediente'}
              {workflowType && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {getWorkflowTypeLabel(workflowType)}
                </Badge>
              )}
            </span>
            {radicado && (
              <span className="block text-xs text-muted-foreground">{radicado}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm font-medium">¿Desea generar documentos ahora?</p>

          <button
            onClick={handleGenerateContract}
            className="w-full text-left rounded-lg border border-border p-4 hover:border-primary/40 hover:bg-muted/30 transition-all group"
          >
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm group-hover:text-primary transition-colors">
                  Generar Contrato de Servicios
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cree el contrato de prestación de servicios. Los datos que ingresó se usarán para auto-completar el documento.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors mt-0.5" />
            </div>
          </button>

          <button
            onClick={handleGeneratePoder}
            className="w-full text-left rounded-lg border border-border p-4 hover:border-primary/40 hover:bg-muted/30 transition-all group"
          >
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm group-hover:text-primary transition-colors">
                  Generar Poder Especial
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cree el poder especial para representar a su cliente en este proceso.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors mt-0.5" />
            </div>
          </button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleSkip} className="text-muted-foreground">
            Ir al expediente (generar después)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
