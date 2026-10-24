import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, rpcErrorText, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_freshness_issues",
  title: "Asuntos con consultas fallidas o sin consulta reciente",
  description: "Read-only RLS-scoped keyset page of identifiable matters with latest provider/operation failure or monitored matters without a recent check. Includes IDs, current attempts and per-provider last success. Pass next_after as after until has_more=false; position is not authorization. Current rows, 30-day checks and 90-day successes, no provider calls.",
  inputSchema: { after: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).optional(), work_item_id: z.string().uuid().optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ after, limit, work_item_id }, ctx) => {
    const denied = requireAuth(ctx);
    if (denied) return errorResult(denied);
    const { data, error } = await sbForUser(ctx).rpc("mcp_list_freshness_issues", { p_after: after ?? null, p_limit: limit ?? 50, p_work_item_id: work_item_id ?? null });
    if (error) return errorResult(rpcErrorText(error));
    return textResult("Consultas fallidas o pendientes de comprobar.", data as Record<string, unknown>);
  },
});