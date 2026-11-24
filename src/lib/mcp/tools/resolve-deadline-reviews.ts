import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { MANAGE_ANNOTATIONS } from "../manage-helpers";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "resolve_deadline_reviews",
  title: "Marcar revisadas o aplazar revisiones manuales",
  description: "Updates the user's private review queue in batches of up to 25 events from list_deadline_reviews. Acknowledge only events already reviewed and communicated with evidence under the user's instruction. Snooze uses a specific future timestamp. A procedural deadline can only be changed separately using manage_deadline with explicit authorization.",
  inputSchema: {
    event_ids: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(25),
    action: z.enum(["acknowledge", "snooze"]),
    snoozed_until: z.string().datetime({ offset: true }).optional(),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    if ((args.action === "snooze") !== Boolean(args.snoozed_until)) {
      return errorResult("Indica una fecha explícita solo si vas a aplazar la revisión.");
    }
    const { data, error } = await sbForUser(ctx).rpc("mcp_resolve_deadline_reviews", {
      p_event_ids: args.event_ids,
      p_action: args.action,
      p_until: args.snoozed_until ?? null,
      p_idempotency_key: args.idempotency_key,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult("Estado personal de revisión guardado.", data as Record<string, unknown>);
  },
});
