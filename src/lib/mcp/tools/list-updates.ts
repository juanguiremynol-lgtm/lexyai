import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, rpcErrorText, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_updates",
  title: "Novedades incrementales (actuaciones, estados y ciclo de vida)",
  description:
    "Read-only resumable feed of changes selected by row revision (updated_at), so corrections and archivals of older actuaciones/estados appear; detected_at is immutable and only for display. Kinds stay separate; court dates are distinct from detection/change times. Pass next_cursor to continue; has_more says whether to page again. After catching up the next call re-reads a 15-minute overlap: deduplicate by dedupe_key (kind:id:revision), never by id alone. Because revision timestamps are set at transaction start, a very late commit could be missed: periodically pass reconcile_since for a full re-read. Cursor is bound to the user and optional work_item_id and expires after 7 days. `freshness` reports per-provider sync checks for visible matters: only status=success is a successful check (empty/error/skipped/rejected/pending_upstream/partial are not). An empty page never means providers were checked.",
  inputSchema: {
    cursor: z.string().max(2000).optional().describe("next_cursor de la llamada anterior. Sin cursor: últimos 3 días."),
    reconcile_since: z.string().datetime().optional().describe("Reconciliación completa desde esta fecha ISO (máx. 400 días). Ignora cursor."),
    work_item_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ cursor, reconcile_since, work_item_id, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    const { data, error } = reconcile_since
      ? await sb.rpc("mcp_reconcile_updates", { p_since: reconcile_since, p_limit: limit ?? 100, p_work_item_id: work_item_id ?? null })
      : await sb.rpc("mcp_list_updates", { p_cursor: cursor ?? null, p_limit: limit ?? 100, p_work_item_id: work_item_id ?? null });
    if (error) return errorResult(rpcErrorText(error));
    const r = data as { events?: unknown[]; has_more?: boolean };
    return textResult(`${r.events?.length ?? 0} novedades${r.has_more ? " (hay más: usa next_cursor)" : ""}.`, data as Record<string, unknown>);
  },
});
