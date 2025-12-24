import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Scale, FileText, AlertCircle, AlertTriangle, ArrowLeft } from "lucide-react";

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
  const [step, setStep] = useState<"confirm" | "classify">("confirm");
  const [pendingChoice, setPendingChoice] = useState<boolean | null>(null);
  
  const isConvertingToProcess = currentType === "filing";

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset state when closing
      setStep("confirm");
      setPendingChoice(null);
    }
    onOpenChange(newOpen);
  };

  const handleClassifyChoice = (hasAutoAdmisorio: boolean) => {
    setPendingChoice(hasAutoAdmisorio);
    setStep("classify");
  };

  const handleConfirmReclassify = () => {
    if (pendingChoice !== null) {
      onClassify(pendingChoice);
      setStep("confirm");
      setPendingChoice(null);
    }
  };

  const handleBack = () => {
    setStep("confirm");
    setPendingChoice(null);
  };

  // Initial confirmation step
  if (step === "confirm") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
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
                onClick={() => handleClassifyChoice(true)}
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
                onClick={() => handleClassifyChoice(false)}
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
            <Button variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Confirmation step before reclassifying
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Confirmar Reclasificación
          </DialogTitle>
          <DialogDescription>
            Esta acción modificará el estado del radicado y no se puede deshacer fácilmente.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-sm font-medium text-foreground mb-2">
              Vas a reclasificar:
            </p>
            <p className="font-mono text-sm text-muted-foreground">
              {radicado || "Sin radicado"}
            </p>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">De:</span>
              <span className="font-medium">
                {isConvertingToProcess ? "Radicación" : "Proceso"}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="font-medium">
                {pendingChoice 
                  ? "Proceso (con Auto Admisorio)" 
                  : "Radicación (sin Auto Admisorio)"}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button 
            variant="ghost" 
            onClick={handleBack}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleConfirmReclassify}
            className="gap-2"
          >
            <AlertTriangle className="h-4 w-4" />
            Confirmar Reclasificación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
