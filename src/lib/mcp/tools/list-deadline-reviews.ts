import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, rpcErrorText, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_deadline_reviews",
  title: "Bandeja de revisión manual de términos",
  description: "Lists unacknowledged, unsnoozed manual reviews grouped by source event, including the case, attribution, trigger and allowed actions. These are proposals to verify. Consult list_deadlines for the distinct procedural obligations. Follow next_cursor until has_more is false.",
  inputSchema: {
    cursor: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ cursor, limit }, ctx) => {
    const denied = requireAuth(ctx);
    if (denied) return errorResult(denied);
    const { data, error } = await sbForUser(ctx).rpc("list_pending_deadline_reviews", {
      p_cursor: cursor ?? null,
      p_limit: limit ?? 20,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult("Revisiones manuales pendientes.", data as Record<string, unknown>);
  },
});
