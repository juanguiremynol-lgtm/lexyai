import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";
import { MANAGE_ANNOTATIONS } from "../manage-helpers";

export default defineTool({
  name: "resolve_alert",
  title: "Marcar vista o descartar una alerta",
  description:
    "Acts on an alert returned by list_alerts (never a notification ID). acknowledge marks it seen; dismiss closes it only when its allowed_actions include dismiss (alerts that clear automatically with their cause cannot be dismissed). Personal: never completes or closes a legal deadline. Requires a manage grant.",
  inputSchema: {
    alert_id: z.string().uuid(),
    action: z.enum(["acknowledge", "dismiss"]),
    reason: z.string().trim().max(300).optional(),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const { data, error } = await sbForUser(ctx).rpc("mcp_resolve_alert", {
      p_alert_id: args.alert_id,
      p_action: args.action,
      p_idempotency_key: args.idempotency_key,
      p_reason: args.reason ?? null,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult(args.action === "acknowledge" ? "Alerta marcada como vista." : "Alerta descartada.", data as Record<string, unknown>);
  },
});
