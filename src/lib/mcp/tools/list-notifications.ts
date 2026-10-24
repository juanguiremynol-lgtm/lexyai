import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_notifications",
  title: "Centro de notificaciones",
  description:
    "Read-only. Lists the user's notification-center items (distinct from alerts in list_alerts) with their personal read/dismissed/snoozed state.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional(),
    include_dismissed: z.boolean().optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, include_dismissed }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    const { data, error } = await sb
      .from("notifications")
      .select("id, title, created_at, work_item_id, category, severity")
      .order("created_at", { ascending: false })
      .limit(limit ?? 30);
    if (error) return errorResult(error.message);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const ids = rows.map((r) => String(r.id));
    const { data: states } = ids.length
      ? await sb.from("notification_user_state").select("notification_id, read_at, dismissed_at, snoozed_until").in("notification_id", ids)
      : { data: [] as Array<Record<string, unknown>> };
    const byId = new Map((states ?? []).map((s) => [String((s as Record<string, unknown>).notification_id), s as Record<string, unknown>]));
    const items = rows
      .map((r) => {
        const s = byId.get(String(r.id));
        return { ...r, read_at: s?.read_at ?? null, dismissed_at: s?.dismissed_at ?? null, snoozed_until: s?.snoozed_until ?? null };
      })
      .filter((r) => include_dismissed || !r.dismissed_at);
    return textResult(`${items.length} notificaciones.`, { notifications: items });
  },
});
