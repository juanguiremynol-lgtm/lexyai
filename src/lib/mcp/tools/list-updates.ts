import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, rpcErrorText, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_updates",
  title: "Novedades incrementales (actuaciones, estados y ciclo de vida)",
  description:
    "Read-only resumable feed of changes: actuaciones and estados (kept separate by kind, with court dates distinct from detection/change times, including corrections and archivals) plus matter lifecycle changes. Pass next_cursor to continue; has_more says whether to page again. After catching up, the next call re-reads a 15-minute overlap window — deduplicate by dedupe_key. The cursor is bound to the user, the optional work_item_id and expires after 7 days. An empty page does NOT mean providers were checked: read `freshness`.",
  inputSchema: {
    cursor: z.string().max(2000).optional().describe("next_cursor de la llamada anterior. Sin cursor: últimos 3 días."),
    work_item_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ cursor, work_item_id, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const { data, error } = await sbForUser(ctx).rpc("mcp_list_updates", {
      p_cursor: cursor ?? null,
      p_limit: limit ?? 100,
      p_work_item_id: work_item_id ?? null,
    });
    if (error) return errorResult(rpcErrorText(error));
    const r = data as { events?: unknown[]; has_more?: boolean };
    return textResult(`${r.events?.length ?? 0} novedades${r.has_more ? " (hay más: usa next_cursor)" : ""}.`, data as Record<string, unknown>);
  },
});
