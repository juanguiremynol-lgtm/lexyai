import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";
import { MANAGE_ANNOTATIONS } from "../manage-helpers";

export default defineTool({
  name: "add_email_association",
  title: "Asociar deliberadamente un correo a otro asunto",
  description:
    "Adds a confirmed manual association of an email (identified by one of its link IDs) to a matter the user manages, dismissing pending suggestions for that message and recording the manual override (including radicado conflicts). Existing confirmed associations are kept: this is not an exclusive move. Never changes stages or deadlines. Requires a manage grant.",
  inputSchema: {
    link_id: z.string().uuid().describe("Cualquier vínculo existente del correo."),
    work_item_id: z.string().uuid().describe("Asunto destino."),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const { data, error } = await sbForUser(ctx).rpc("mcp_add_email_association", {
      p_link_id: args.link_id,
      p_work_item_id: args.work_item_id,
      p_idempotency_key: args.idempotency_key,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult("Asociación agregada.", data as Record<string, unknown>);
  },
});
