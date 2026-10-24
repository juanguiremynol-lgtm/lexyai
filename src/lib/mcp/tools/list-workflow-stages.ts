import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { canonicalWorkflowType, errorResult, requireAuth, sbForUser, textResult } from "../shared";
import { appStages } from "../manage-helpers";

export default defineTool({
  name: "list_workflow_stages",
  title: "Catálogo de etapas por tipo de proceso",
  description:
    "Read-only. Lists the legal stages (and catalogued transitions when they exist) for a workflow type, so stage moves can be proposed with valid codes. Regressions are never allowed through the assistant.",
  inputSchema: {
    workflow_type: z.string().trim().min(2).describe("Tipo de proceso: CGP, CPACA, LABORAL, PENAL_906, TUTELA, PETICION, GOV_PROCEDURE, EJECUTIVO."),
    cgp_phase: z.enum(["FILING", "PROCESS"]).optional().describe("Solo CGP: fase actual del asunto (las etapas dependen de ella)."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ workflow_type, cgp_phase }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const wf = canonicalWorkflowType(workflow_type);
    const { data, error } = await sbForUser(ctx).rpc("mcp_list_workflow_stages", { p_workflow_type: wf });
    if (error) return errorResult(error.message);
    const catalog = (data ?? {}) as { stages?: unknown[]; transitions?: unknown[] };
    const governed = (catalog.stages?.length ?? 0) > 0;
    const stages = governed ? catalog.stages ?? [] : appStages(wf, cgp_phase ?? (wf === "CGP" ? "FILING" : null));
    return textResult(`${stages.length} etapas para ${wf}${wf === "CGP" ? ` (fase ${cgp_phase ?? "FILING"})` : ""}.`, {
      workflow_type: wf,
      source: governed ? "catalogo_base_de_datos" : "catalogo_aplicacion",
      stages,
      transitions: governed ? catalog.transitions ?? [] : [],
      rules: "Solo avances dentro del catálogo. Retrocesos y cambios de fase CGP se hacen en la app.",
    });
  },
});
