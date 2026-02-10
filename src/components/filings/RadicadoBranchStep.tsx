import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileText, Search } from "lucide-react";

export type RadicadoBranch = "with_radicado" | "without_radicado";

interface RadicadoBranchStepProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (branch: RadicadoBranch) => void;
  onBack?: () => void;
  workflowLabel: string;
}

export function RadicadoBranchStep({
  open,
  onOpenChange,
  onSelect,
  onBack,
  workflowLabel,
}: RadicadoBranchStepProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <DialogTitle>{workflowLabel}</DialogTitle>
              <DialogDescription>
                ¿Ya tiene número de radicado para este proceso?
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 mt-2">
          <Card
            className="cursor-pointer transition-all border-2 border-transparent hover:border-primary/50 hover:bg-accent/50"
            onClick={() => onSelect("with_radicado")}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Search className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">Sí, tengo radicado</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm">
                Ingrese el radicado de 23 dígitos para buscar datos del juzgado
                automáticamente y resolver el email del despacho.
              </CardDescription>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-all border-2 border-transparent hover:border-primary/50 hover:bg-accent/50"
            onClick={() => onSelect("without_radicado")}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted text-muted-foreground">
                  <FileText className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">No tengo radicado</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm">
                Cree el proceso como nueva radicación. El email del despacho
                aparecerá cuando se identifique el juzgado.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
