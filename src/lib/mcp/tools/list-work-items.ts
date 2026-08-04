import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { canonicalWorkflowType, errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_work_items",
  title: "Listar asuntos (work items)",
  description:
    "Lists the signed-in user's active legal matters (asuntos) from Andromeda. Supports optional text search and workflow_type filter (CGP, CPACA, LABORAL, PENAL_906, TUTELA, PETICION, GOV_PROCEDURE ("PENAL" se acepta como alias de PENAL_906)).",
  inputSchema: {
    search: z.string().trim().optional().describe("Free-text match on radicado, título, partes, o autoridad."),
    workflow_type: z.string().trim().optional().describe("Filter by workflow_type, e.g. CGP, CPACA, LABORAL, PENAL_906, TUTELA, PETICION, GOV_PROCEDURE ("PENAL" se acepta como alias de PENAL_906)."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, workflow_type, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    let q = sb
      .from("work_items")
      .select("id, radicado, workflow_type, stage, status, authority_name, authority_city, demandantes, demandados, title, last_action_date, last_action_description, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(limit ?? 25);
    if (workflow_type) q = q.eq("workflow_type", canonicalWorkflowType(workflow_type));
    if (search) {
      const s = `%${search}%`;
      q = q.or(`radicado.ilike.${s},title.ilike.${s},authority_name.ilike.${s},demandantes.ilike.${s},demandados.ilike.${s}`);
    }
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return textResult(`Encontrados ${data?.length ?? 0} asuntos.`, { items: data ?? [] });
  },
});