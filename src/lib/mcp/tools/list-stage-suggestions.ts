import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_stage_suggestions",
  title: "Sugerencias de etapa pendientes",
  description: "Read-only. Lists PENDING stage suggestions (with the evidence that produced them) for the user's matters.",
  inputSchema: {
    work_item_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ work_item_id, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    let q = sbForUser(ctx)
      .from("work_item_stage_suggestions")
      .select("id, work_item_id, suggested_stage, confidence, reason, source_type, event_date, event_text, is_regression, created_at, updated_at")
      .eq("status", "PENDING")
      .order("created_at", { ascending: false })
      .limit(limit ?? 30);
    if (work_item_id) q = q.eq("work_item_id", work_item_id);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return textResult(`${data?.length ?? 0} sugerencias pendientes.`, { suggestions: data ?? [] });
  },
});
