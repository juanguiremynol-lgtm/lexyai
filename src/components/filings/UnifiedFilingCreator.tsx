import { useState } from "react";
import { NewFilingTypeSelector, FilingCategory } from "./NewFilingTypeSelector";
import { NewCGPFilingDialog } from "./NewCGPFilingDialog";
import { NewTutelaDialog } from "@/components/tutelas/NewTutelaDialog";
import { NewHabeasCorpusDialog } from "@/components/tutelas/NewHabeasCorpusDialog";
import { NewPeticionDialog } from "@/components/peticiones/NewPeticionDialog";
import { NewAdminProcessDialog } from "@/components/pipeline/NewAdminProcessDialog";
import { NewCpacaDialog } from "@/components/cpaca/NewCpacaDialog";

interface UnifiedFilingCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialType?: FilingCategory;
  clientId?: string;
  clientName?: string;
}

export function UnifiedFilingCreator({
  open,
  onOpenChange,
  onSuccess,
  initialType,
  clientId,
  clientName,
}: UnifiedFilingCreatorProps) {
  const [currentStep, setCurrentStep] = useState<"select" | FilingCategory>(
    initialType || "select"
  );

  const handleSelectType = (type: FilingCategory) => {
    setCurrentStep(type);
  };

  const handleBack = () => {
    setCurrentStep("select");
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setCurrentStep(initialType || "select");
    }
    onOpenChange(isOpen);
  };

  const handleSuccess = () => {
    setCurrentStep(initialType || "select");
    onSuccess?.();
  };

  // Type selector
  if (currentStep === "select") {
    return (
      <NewFilingTypeSelector
        open={open}
        onOpenChange={handleClose}
        onSelectType={handleSelectType}
      />
    );
  }

  // CGP Filing Dialog
  if (currentStep === "CGP") {
    return (
      <NewCGPFilingDialog
        open={open}
        onOpenChange={handleClose}
        onBack={initialType ? undefined : handleBack}
        onSuccess={handleSuccess}
        defaultClientId={clientId}
      />
    );
  }

  // CPACA Process Dialog
  if (currentStep === "CPACA") {
    return (
      <NewCpacaDialog
        open={open}
        onOpenChange={handleClose}
        onBack={initialType ? undefined : handleBack}
        onSuccess={handleSuccess}
        defaultClientId={clientId}
      />
    );
  }

  // Tutela Dialog
  if (currentStep === "TUTELA") {
    return (
      <NewTutelaDialog
        open={open}
        onOpenChange={handleClose}
        onBack={initialType ? undefined : handleBack}
        onSuccess={handleSuccess}
        defaultClientId={clientId}
      />
    );
  }

  // Habeas Corpus Dialog
  if (currentStep === "HABEAS_CORPUS") {
    return (
      <NewHabeasCorpusDialog
        open={open}
        onOpenChange={handleClose}
        onBack={initialType ? undefined : handleBack}
        onSuccess={handleSuccess}
        defaultClientId={clientId}
      />
    );
  }

  // Petición Dialog
  if (currentStep === "PETICION") {
    return (
      <NewPeticionDialog
        open={open}
        onOpenChange={handleClose}
        onBack={initialType ? undefined : handleBack}
        onSuccess={handleSuccess}
        defaultClientId={clientId}
      />
    );
  }

  // Administrative Process Dialog
  if (currentStep === "ADMINISTRATIVO") {
    return (
      <NewAdminProcessDialog
        open={open}
        onOpenChange={handleClose}
        onBack={initialType ? undefined : handleBack}
        onSuccess={handleSuccess}
        defaultClientId={clientId}
      />
    );
  }

  return null;
}
