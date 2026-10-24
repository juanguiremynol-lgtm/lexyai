import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, rpcErrorText, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_email_questions",
  title: "Preguntas pendientes de asociación de correo",
  description: "Read-only global pending inbox questions, grouped by internet_message_id (fallback message_id), with all RLS-visible candidate siblings, source metadata, radicado conflicts and allowed actions. Separates owned writable links from organization-view-only links. Bounded cursor pagination; no message bodies or mail sending. Use resolve_email_question only for explicit user decisions.",
  inputSchema: { cursor: z.string().max(2000).optional(), limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ cursor, limit }, ctx) => {
    const denied = requireAuth(ctx);
    if (denied) return errorResult(denied);
    const { data, error } = await sbForUser(ctx).rpc("mcp_list_email_questions", { p_cursor: cursor ?? null, p_limit: limit ?? 20 });
    if (error) return errorResult(rpcErrorText(error));
    return textResult("Preguntas pendientes de correo.", data as Record<string, unknown>);
  },
});