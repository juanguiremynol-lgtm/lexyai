import { useState } from "react";
import { NewFilingTypeSelector, FilingCategory } from "./NewFilingTypeSelector";
import { RadicadoBranchStep, type RadicadoBranch } from "./RadicadoBranchStep";
import { NewCGPFilingDialog } from "./NewCGPFilingDialog";
import { NewCGPWithRadicadoDialog } from "./NewCGPWithRadicadoDialog";
import { NewTutelaDialog } from "@/components/tutelas/NewTutelaDialog";
import { NewHabeasCorpusDialog } from "@/components/tutelas/NewHabeasCorpusDialog";
import { NewPeticionDialog } from "@/components/peticiones/NewPeticionDialog";
import { NewAdminProcessDialog } from "@/components/pipeline/NewAdminProcessDialog";
import { NewCpacaDialog } from "@/components/cpaca/NewCpacaDialog";

// Judicial workflow types that support radicado branching
const JUDICIAL_TYPES_WITH_BRANCHING: FilingCategory[] = ["CGP"];
// TUTELA already has radicado branching built into its dialog
// CPACA has optional radicado in its form
// HABEAS_CORPUS uses the same flow as TUTELA

const WORKFLOW_LABELS: Record<string, string> = {
  CGP: "Nueva Demanda CGP",
  CPACA: "Nuevo Proceso CPACA",
};

interface UnifiedFilingCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialType?: FilingCategory;
  clientId?: string;
  clientName?: string;
}

type Step = "select" | "radicado_branch" | "dialog";

export function UnifiedFilingCreator({
  open,
  onOpenChange,
  onSuccess,
  initialType,
  clientId,
  clientName,
}: UnifiedFilingCreatorProps) {
  const [selectedType, setSelectedType] = useState<FilingCategory | null>(initialType || null);
  const [step, setStep] = useState<Step>(initialType ? (JUDICIAL_TYPES_WITH_BRANCHING.includes(initialType) ? "radicado_branch" : "dialog") : "select");
  const [radicadoBranch, setRadicadoBranch] = useState<RadicadoBranch | null>(null);

  const handleSelectType = (type: FilingCategory) => {
    setSelectedType(type);
    if (JUDICIAL_TYPES_WITH_BRANCHING.includes(type)) {
      setStep("radicado_branch");
    } else {
      setStep("dialog");
    }
  };

  const handleBranchSelect = (branch: RadicadoBranch) => {
    setRadicadoBranch(branch);
    setStep("dialog");
  };

  const handleBackToBranch = () => {
    setRadicadoBranch(null);
    setStep("radicado_branch");
  };

  const handleBackToSelect = () => {
    setSelectedType(null);
    setRadicadoBranch(null);
    setStep("select");
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedType(initialType || null);
      setRadicadoBranch(null);
      setStep(initialType ? (JUDICIAL_TYPES_WITH_BRANCHING.includes(initialType) ? "radicado_branch" : "dialog") : "select");
    }
    onOpenChange(isOpen);
  };

  const handleSuccess = () => {
    setSelectedType(initialType || null);
    setRadicadoBranch(null);
    setStep(initialType ? (JUDICIAL_TYPES_WITH_BRANCHING.includes(initialType) ? "radicado_branch" : "dialog") : "select");
    onSuccess?.();
  };

  // Step 1: Type selector
  if (step === "select") {
    return (
      <NewFilingTypeSelector
        open={open}
        onOpenChange={handleClose}
        onSelectType={handleSelectType}
      />
    );
  }

  // Step 2: Radicado branching (judicial types only)
  if (step === "radicado_branch" && selectedType) {
    return (
      <RadicadoBranchStep
        open={open}
        onOpenChange={handleClose}
        onSelect={handleBranchSelect}
        onBack={initialType ? undefined : handleBackToSelect}
        workflowLabel={WORKFLOW_LABELS[selectedType] || selectedType}
      />
    );
  }

  // Step 3: Specific dialog
  if (step === "dialog" && selectedType) {
    const backHandler = initialType
      ? undefined
      : JUDICIAL_TYPES_WITH_BRANCHING.includes(selectedType)
        ? handleBackToBranch
        : handleBackToSelect;

    // CGP with radicado branching
    if (selectedType === "CGP") {
      if (radicadoBranch === "with_radicado") {
        return (
          <NewCGPWithRadicadoDialog
            open={open}
            onOpenChange={handleClose}
            onBack={backHandler}
            onSuccess={handleSuccess}
            defaultClientId={clientId}
          />
        );
      }
      // without_radicado → existing filing dialog
      return (
        <NewCGPFilingDialog
          open={open}
          onOpenChange={handleClose}
          onBack={backHandler}
          onSuccess={handleSuccess}
          defaultClientId={clientId}
        />
      );
    }

    // CPACA
    if (selectedType === "CPACA") {
      return (
        <NewCpacaDialog
          open={open}
          onOpenChange={handleClose}
          onBack={backHandler}
          onSuccess={handleSuccess}
          defaultClientId={clientId}
        />
      );
    }

    // TUTELA (has built-in radicado branching)
    if (selectedType === "TUTELA") {
      return (
        <NewTutelaDialog
          open={open}
          onOpenChange={handleClose}
          onBack={backHandler}
          onSuccess={handleSuccess}
          defaultClientId={clientId}
        />
      );
    }

    // Habeas Corpus
    if (selectedType === "HABEAS_CORPUS") {
      return (
        <NewHabeasCorpusDialog
          open={open}
          onOpenChange={handleClose}
          onBack={backHandler}
          onSuccess={handleSuccess}
          defaultClientId={clientId}
        />
      );
    }

    // Petición
    if (selectedType === "PETICION") {
      return (
        <NewPeticionDialog
          open={open}
          onOpenChange={handleClose}
          onBack={backHandler}
          onSuccess={handleSuccess}
          defaultClientId={clientId}
        />
      );
    }

    // Administrativo
    if (selectedType === "ADMINISTRATIVO") {
      return (
        <NewAdminProcessDialog
          open={open}
          onOpenChange={handleClose}
          onBack={backHandler}
          onSuccess={handleSuccess}
          defaultClientId={clientId}
        />
      );
    }
  }

  return null;
}
