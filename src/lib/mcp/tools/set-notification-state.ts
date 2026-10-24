import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";
import { MANAGE_ANNOTATIONS } from "../manage-helpers";

export default defineTool({
  name: "set_notification_state",
  title: "Marcar leídas, descartar o posponer notificaciones",
  description:
    "Changes the user's personal state for notification-center items from list_notifications (never alert IDs — use resolve_alert). Requires a manage grant.",
  inputSchema: {
    notification_ids: z.array(z.string().uuid()).min(1).max(200),
    action: z.enum(["read", "dismiss", "snooze"]),
    snooze_until: z.string().min(10).optional().describe("Obligatorio para snooze (fecha futura ISO)."),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const { data, error } = await sbForUser(ctx).rpc("mcp_set_notification_state", {
      p_ids: args.notification_ids,
      p_action: args.action,
      p_until: args.snooze_until ?? null,
      p_idempotency_key: args.idempotency_key,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult("Notificaciones actualizadas.", data as Record<string, unknown>);
  },
});
