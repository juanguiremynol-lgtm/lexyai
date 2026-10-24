import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, rpcErrorText, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_notifications",
  title: "Centro de notificaciones",
  description:
    "Read-only. Lists notification-center items (not alert_instances) with only the caller's personal state. Filters dismissed rows before stable created_at/id cursor pagination, so newest dismissed items never hide older unread items. State-query errors fail the entire call. Return next_cursor/has_more; cursor is a read position, not authorization. State changes during traversal may require a fresh first page.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional(),
    include_dismissed: z.boolean().optional(),
    cursor: z.string().max(2000).optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, include_dismissed, cursor }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const { data, error } = await sbForUser(ctx).rpc("mcp_list_notifications", {
      p_limit: limit ?? 30, p_include_dismissed: include_dismissed ?? false, p_cursor: cursor ?? null,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult("Notificaciones con estado personal.", data as Record<string, unknown>);
  },
});
