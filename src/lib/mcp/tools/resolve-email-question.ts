import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";
import { MANAGE_ANNOTATIONS } from "../manage-helpers";

export default defineTool({
  name: "resolve_email_question",
  title: "Responder una pregunta de asociación de correo",
  description:
    "Resolves one pending email-association question (discover globally with list_email_questions, or per matter with list_email_links), decided per message: confirm the chosen link (other suggestions dismissed) or dismiss every suggestion. Confirm is blocked on radicado conflicts; use add_email_association for a deliberate choice. Never changes a stage, completes a deadline or sends mail. Requires manage permission.",
  inputSchema: {
    link_id: z.string().uuid().describe("ID del vínculo sugerido elegido."),
    decision: z.enum(["confirm", "dismiss"]),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const { data, error } = await sbForUser(ctx).rpc("mcp_resolve_email_question", {
      p_link_id: args.link_id,
      p_decision: args.decision,
      p_idempotency_key: args.idempotency_key,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult(args.decision === "confirm" ? "Correo asociado." : "Sugerencias del correo descartadas.", data as Record<string, unknown>);
  },
});
