import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Scale, FileText, AlertCircle } from "lucide-react";

interface ClassificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  radicado: string | null;
  currentType: "filing" | "process";
  onClassify: (hasAutoAdmisorio: boolean) => void;
}

export function ClassificationDialog({
  open,
  onOpenChange,
  radicado,
  currentType,
  onClassify,
}: ClassificationDialogProps) {
  const isConvertingToProcess = currentType === "filing";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Clasificación del Radicado
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              {radicado ? (
                <>Radicado: <span className="font-mono font-semibold">{radicado}</span></>
              ) : (
                "Sin radicado asignado"
              )}
            </span>
            <span className="block">
              {isConvertingToProcess
                ? "Para mover esta radicación a proceso, confirma si ya tiene auto admisorio."
                : "Para mover este proceso a radicación, confirma su estado."}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm font-medium text-foreground mb-3">
            ¿Este radicado tiene Auto Admisorio?
          </p>
          <div className="grid gap-3">
            <Button
              variant="outline"
              className="h-auto py-4 justify-start gap-3 hover:bg-emerald-500/10 hover:border-emerald-500/50"
              onClick={() => onClassify(true)}
            >
              <Scale className="h-5 w-5 text-emerald-600" />
              <div className="text-left">
                <p className="font-medium">Sí, tiene Auto Admisorio</p>
                <p className="text-xs text-muted-foreground">
                  Se clasificará como Proceso y pasará a seguimiento activo
                </p>
              </div>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-4 justify-start gap-3 hover:bg-blue-500/10 hover:border-blue-500/50"
              onClick={() => onClassify(false)}
            >
              <FileText className="h-5 w-5 text-blue-600" />
              <div className="text-left">
                <p className="font-medium">No, aún no tiene Auto Admisorio</p>
                <p className="text-xs text-muted-foreground">
                  Se mantendrá como Radicación pendiente de confirmación
                </p>
              </div>
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
