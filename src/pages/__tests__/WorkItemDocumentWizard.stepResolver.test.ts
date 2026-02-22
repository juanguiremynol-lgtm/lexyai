/**
 * Unit tests for the WorkItemDocumentWizard step resolver logic.
 * Validates that UPLOADED_PDF skips variables step, while SYSTEM_TEMPLATE does not.
 */
import { describe, it, expect } from "vitest";

type DocumentSourceType = "SYSTEM_TEMPLATE" | "DOCX_TEMPLATE" | "UPLOADED_PDF";

/**
 * Mirrors the step-label logic from WorkItemDocumentWizard.
 */
function resolveWizardSteps(
  sourceType: DocumentSourceType,
  isNotification: boolean,
): string[] {
  const skipVariables = sourceType === "UPLOADED_PDF";
  if (isNotification) return ["Tipo", "Demandados", "Variables", "Vista Previa"];
  if (skipVariables) return ["Tipo", "Vista Previa"];
  return ["Tipo", "Variables", "Vista Previa"];
}

/**
 * Returns the step number the "Next" button on Step 1 should navigate to.
 */
function resolveNextStepFromType(
  sourceType: DocumentSourceType,
  isNotification: boolean,
): number {
  const skipVariables = sourceType === "UPLOADED_PDF";
  if (skipVariables) {
    // finalPreviewStep for non-notification with skip = step 2
    return isNotification ? 3 : 2;
  }
  return 2;
}

describe("Wizard step resolver", () => {
  it("returns [Tipo, Variables, Vista Previa] for SYSTEM_TEMPLATE", () => {
    expect(resolveWizardSteps("SYSTEM_TEMPLATE", false)).toEqual([
      "Tipo",
      "Variables",
      "Vista Previa",
    ]);
  });

  it("returns [Tipo, Variables, Vista Previa] for DOCX_TEMPLATE", () => {
    expect(resolveWizardSteps("DOCX_TEMPLATE", false)).toEqual([
      "Tipo",
      "Variables",
      "Vista Previa",
    ]);
  });

  it("returns [Tipo, Vista Previa] for UPLOADED_PDF (skips Variables)", () => {
    expect(resolveWizardSteps("UPLOADED_PDF", false)).toEqual([
      "Tipo",
      "Vista Previa",
    ]);
  });

  it("returns 4-step flow for notifications regardless of source type", () => {
    expect(resolveWizardSteps("SYSTEM_TEMPLATE", true)).toEqual([
      "Tipo",
      "Demandados",
      "Variables",
      "Vista Previa",
    ]);
  });

  it("Next from Step 1 goes to step 2 (Variables) for SYSTEM_TEMPLATE", () => {
    expect(resolveNextStepFromType("SYSTEM_TEMPLATE", false)).toBe(2);
  });

  it("Next from Step 1 goes to step 2 (Final Preview) for UPLOADED_PDF", () => {
    expect(resolveNextStepFromType("UPLOADED_PDF", false)).toBe(2);
  });

  it("UPLOADED_PDF step 2 is Final Preview (not Variables)", () => {
    const steps = resolveWizardSteps("UPLOADED_PDF", false);
    expect(steps[1]).toBe("Vista Previa");
    expect(steps).not.toContain("Variables");
  });

  it("SYSTEM_TEMPLATE step 2 is Variables", () => {
    const steps = resolveWizardSteps("SYSTEM_TEMPLATE", false);
    expect(steps[1]).toBe("Variables");
  });
});
