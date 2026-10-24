import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { canonicalWorkflowType, errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_workflow_stages",
  title: "Catálogo de etapas por tipo de proceso",
  description:
    "Read-only. Lists the stored stage codes for a workflow type exactly as the server validates them: the live database catalogue (with transitions) for catalog-governed workflows (PETICION, GOV_PROCEDURE), and the application vocabulary for litigation workflows. Only stages with movable=true can be targets; for CGP the matter's cgp_phase follows the target stage. Regressions are never allowed through the assistant.",
  inputSchema: {
    workflow_type: z.string().trim().min(2).describe("Tipo de proceso: CGP, CPACA, LABORAL, PENAL_906, TUTELA, PETICION, GOV_PROCEDURE, EJECUTIVO."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ workflow_type }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const wf = canonicalWorkflowType(workflow_type);
    const { data, error } = await sbForUser(ctx).rpc("mcp_list_workflow_stages", { p_workflow_type: wf });
    if (error) return errorResult(error.message);
    const r = (data ?? {}) as { stages?: unknown[] };
    return textResult(`${r.stages?.length ?? 0} etapas para ${wf}.`, r as Record<string, unknown>);
  },
});
