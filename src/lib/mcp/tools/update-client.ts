import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";

/**
 * Corrects a client's directory fields through the gated mcp_update_client
 * RPC. expected_updated_at is mandatory: a stale revision changes nothing.
 * Phone/status are not part of the client model and cannot be edited.
 */
export default defineTool({
  name: "update_client",
  title: "Corregir datos de un cliente",
  description:
    "Corrects name, identification, email or city of an own, non-archived client. Requires expected_updated_at (from get_client/list_clients); a stale revision or an identification already used by another of the user's clients changes nothing. Null clears identification, email or city. Requires manage grant and idempotency_key.",
  inputSchema: {
    id: z.string().uuid().describe("UUID del cliente."),
    expected_updated_at: z.string().datetime({ offset: true }).describe("updated_at leído del cliente; si cambió, no se modifica nada."),
    name: z.string().trim().min(1).max(300).optional(),
    id_number: z.string().trim().max(60).nullable().optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const patch: Record<string, string | null> = {};
    for (const k of ["name", "id_number", "email", "city"] as const) {
      if (args[k] !== undefined) patch[k] = args[k] ?? null;
    }
    if (Object.keys(patch).length === 0) return errorResult("Indica al menos un campo a corregir.");
    const { data, error } = await sbForUser(ctx).rpc("mcp_update_client", {
      p_client_id: args.id,
      p_patch: patch,
      p_expected_updated_at: args.expected_updated_at,
      p_idempotency_key: args.idempotency_key,
    });
    if (error) return errorResult(rpcErrorText(error));
    const r = (data ?? {}) as Record<string, unknown>;
    return textResult(r.replayed ? "Corrección ya aplicada con esta clave (resultado confirmado)." : "Cliente actualizado.", r);
  },
});
