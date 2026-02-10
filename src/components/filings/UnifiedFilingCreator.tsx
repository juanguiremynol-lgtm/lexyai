import { useState } from "react";
import { NewFilingTypeSelector, FilingCategory } from "./NewFilingTypeSelector";
import { RadicadoBranchStep, type RadicadoBranch } from "./RadicadoBranchStep";
import { JudicialWithRadicadoDialog } from "./JudicialWithRadicadoDialog";
import { NewCGPFilingDialog } from "./NewCGPFilingDialog";
import { NewLaboralFilingDialog } from "./NewLaboralFilingDialog";
import { NewTutelaDialog } from "@/components/tutelas/NewTutelaDialog";
import { NewHabeasCorpusDialog } from "@/components/tutelas/NewHabeasCorpusDialog";
import { NewPeticionDialog } from "@/components/peticiones/NewPeticionDialog";
import { NewAdminProcessDialog } from "@/components/pipeline/NewAdminProcessDialog";
import { NewCpacaDialog } from "@/components/cpaca/NewCpacaDialog";

// Judicial workflow types that get the "¿Ya tiene radicado?" branching step
const JUDICIAL_TYPES_WITH_BRANCHING: FilingCategory[] = ["CGP", "LABORAL", "CPACA", "TUTELA"];

const WORKFLOW_LABELS: Record<string, string> = {
  CGP: "Nueva Demanda CGP",
  LABORAL: "Nuevo Proceso Laboral",
  CPACA: "Nuevo Proceso CPACA",
  TUTELA: "Nueva Acción de Tutela",
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
  const [step, setStep] = useState<Step>(
    initialType
      ? JUDICIAL_TYPES_WITH_BRANCHING.includes(initialType) ? "radicado_branch" : "dialog"
      : "select"
  );
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

  const resetState = () => {
    setSelectedType(initialType || null);
    setRadicadoBranch(null);
    setStep(
      initialType
        ? JUDICIAL_TYPES_WITH_BRANCHING.includes(initialType) ? "radicado_branch" : "dialog"
        : "select"
    );
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetState();
    onOpenChange(isOpen);
  };

  const handleSuccess = () => {
    resetState();
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

  // Step 3: Specific dialog based on type + branch
  if (step === "dialog" && selectedType) {
    const backHandler = initialType
      ? undefined
      : JUDICIAL_TYPES_WITH_BRANCHING.includes(selectedType)
        ? handleBackToBranch
        : handleBackToSelect;

    // ── With radicado path → generic JudicialWithRadicadoDialog ──
    if (radicadoBranch === "with_radicado" && JUDICIAL_TYPES_WITH_BRANCHING.includes(selectedType)) {
      return (
        <JudicialWithRadicadoDialog
          open={open}
          onOpenChange={handleClose}
          onBack={backHandler}
          onSuccess={handleSuccess}
          defaultClientId={clientId}
          workflowKey={selectedType as "CGP" | "LABORAL" | "CPACA" | "TUTELA"}
        />
      );
    }

    // ── Without radicado (filing) paths ──

    // CGP filing
    if (selectedType === "CGP") {
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

    // LABORAL filing
    if (selectedType === "LABORAL") {
      return (
        <NewLaboralFilingDialog
          open={open}
          onOpenChange={handleClose}
          onBack={backHandler}
          onSuccess={handleSuccess}
          defaultClientId={clientId}
        />
      );
    }

    // CPACA filing (existing dialog with optional radicado)
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

    // TUTELA filing (existing dialog with built-in radicado flow)
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
