import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_deadlines",
  title: "Términos procesales",
  description:
    "Lists procedural deadlines (términos). By default only genuinely active deadlines are returned; deadlines flagged PENDING_REVIEW are historical/backfilled and are NOT active — request them explicitly and never present them as live obligations.",
  inputSchema: {
    status: z.enum(["pending", "pending_review", "all"]).optional().describe("Default: pending (solo activos)."),
    radicado: z.string().trim().optional().describe("Limitar a un asunto por radicado."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, radicado, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    let workItem: Record<string, unknown> | null = null;
    if (radicado) {
      const resolved = await resolveWorkItem(sb, { radicado });
      if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      workItem = resolved.item;
    }

    let q = sb
      .from("work_item_deadlines")
      .select("id, work_item_id, deadline_type, label, description, trigger_event, trigger_date, deadline_date, business_days_count, status")
      .order("deadline_date", { ascending: true })
      .limit(limit ?? 50);

    const mode = status ?? "pending";
    if (mode === "pending") q = q.eq("status", "PENDING");
    else if (mode === "pending_review") q = q.eq("status", "PENDING_REVIEW");
    if (workItem) q = q.eq("work_item_id", workItem.id as string);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    const note =
      mode === "pending"
        ? "Solo términos activos."
        : mode === "pending_review"
          ? "Términos en revisión (vencidos en el backfill): NO son obligaciones vigentes."
          : "Incluye activos y en revisión; los PENDING_REVIEW no son obligaciones vigentes.";

    return textResult(`${data?.length ?? 0} términos. ${note}`, {
      status: mode,
      work_item: workItem,
      deadlines: data ?? [],
    });
  },
});
