import { useState } from "react";
import { NewFilingTypeSelector, FilingCategory } from "./NewFilingTypeSelector";
import { NewCGPFilingDialog } from "./NewCGPFilingDialog";
import { NewTutelaDialog } from "@/components/tutelas/NewTutelaDialog";
import { NewHabeasCorpusDialog } from "@/components/tutelas/NewHabeasCorpusDialog";
import { NewPeticionDialog } from "@/components/peticiones/NewPeticionDialog";
import { NewAdminProcessDialog } from "@/components/pipeline/NewAdminProcessDialog";

interface UnifiedFilingCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialType?: FilingCategory;
}

export function UnifiedFilingCreator({
  open,
  onOpenChange,
  onSuccess,
  initialType,
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
      />
    );
  }

  return null;
}
