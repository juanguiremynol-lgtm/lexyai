import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, rpcErrorText, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_updates",
  title: "Novedades incrementales (actuaciones, estados y ciclo de vida)",
  description:
    "Read-only resumable feed of changes selected by row revision (updated_at), so corrections and archivals of older actuaciones/estados and new matters appear; detected_at is immutable and only for display. Kinds stay separate; court dates are distinct from detection/change times. next_cursor is an opaque server-stored token bound to the user, the AI connection and the work_item_id filter (expires after 30 days; an expired cursor returns CURSOR_EXPIRED with the reconcile_since to use — it is never silently reset). Each pass has a fixed upper watermark; when has_more=false the durable checkpoint advances to that watermark and the next pass re-reads 15 minutes before it: deduplicate by dedupe_key (kind:id:revision), never by id alone. Each event shows the row's CURRENT state (intermediate revisions between polls collapse); permanent purges emit no event; a transaction committing more than 15 minutes after it started may be missed, so periodically run reconcile_since. Without cursor: last 3 days. `freshness` is always present (portfolio or work item scope, 30-day window) from per-provider sync checks on visible matters: only status=success is a successful check (empty/error/skipped/rejected/pending_upstream/partial are not). An empty page never means providers were checked.",
  inputSchema: {
    cursor: z.string().max(200).optional().describe("next_cursor de la llamada anterior (c1.<id>). Sin cursor: últimos 3 días."),
    reconcile_since: z.string().datetime().optional().describe("Reconciliación completa desde esta fecha ISO (máx. 400 días); continúa con next_cursor. Ignora cursor."),
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
