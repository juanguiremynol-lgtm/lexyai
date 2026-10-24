import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "change_work_item_lifecycle",
  title: "Archivar, enviar a papelera o restaurar un asunto",
  description:
    "Recoverable lifecycle changes only: archive (kept indefinitely, monitoring off), trash (soft delete, recoverable until recovery_deadline — 10 days — then purged by retention) or restore. Permanent deletion is never available here. Requires expected_updated_at from get_work_item, the user's explicit instruction and a manage grant.",
  inputSchema: {
    work_item_id: z.string().uuid(),
    action: z.enum(["archive", "trash", "restore"]),
    expected_updated_at: z.string().min(10).describe("updated_at del asunto tal como lo leíste; si cambió, no se modifica nada."),
    reason: z.string().trim().max(500).optional(),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const { data, error } = await sbForUser(ctx).rpc("mcp_work_item_lifecycle", {
      p_work_item_id: args.work_item_id,
      p_action: args.action,
      p_expected_updated_at: args.expected_updated_at,
      p_idempotency_key: args.idempotency_key,
      p_reason: args.reason ?? null,
    });
    if (error) return errorResult(rpcErrorText(error));
    const r = data as Record<string, unknown>;
    return textResult(String(r.note ?? "Hecho."), r);
  },
});
