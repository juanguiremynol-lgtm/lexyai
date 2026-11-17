import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export const FILING_COLUMNS =
  "id, work_item_id, action_kind, filed_on, channel, source_reference, external_reference, workflow_type, procedure_subtype, tribunal_type, related_work_item_id, observaciones, stage_or_status, legal_effect, deadline_effect, term_calculation_status, review_task_id, origin, created_at";

export default defineTool({
  name: "list_filings",
  title: "Presentaciones registradas",
  description:
    "Lists filings the firm registered as presented (newest first), optionally for one matter. legal_effect is always PRESENTADO_NO_ACREDITADA_RECEPCION: a filing is never proof of receipt, admission or notification. Read-only.",
  inputSchema: {
    work_item_id: z.string().uuid().optional(),
    radicado: z.string().trim().optional(),
    limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ work_item_id, radicado, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    let wid = work_item_id ?? null;
    if (!wid && radicado) {
      const resolved = await resolveWorkItem(sb, { radicado });
      if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      wid = resolved.item.id as string;
    }
    let q = sb.from("work_item_filings" as never).select(FILING_COLUMNS).is("deleted_at", null)
      .order("filed_on", { ascending: false }).order("id", { ascending: false }).limit(limit ?? 50);
    if (wid) q = q.eq("work_item_id", wid);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    const rows = (data ?? []) as unknown as Array<Record<string, string | null>>;
    return textResult(`${rows.length} presentaciones registradas (presentado ≠ recibido ni admitido).`, {
      filings: rows.map((f) => ({ ...f })),
    });
  },
});
