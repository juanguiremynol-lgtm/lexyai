import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";

/**
 * Creates one client in the caller's own directory via the gated
 * mcp_create_client RPC (owner + OAuth manage grant, idempotency, audit).
 * Never merges by name; a matching normalized identification of the same
 * owner returns a conflict with the existing id and creates nothing.
 * The client model has no phone or status column, so neither is accepted.
 */
export default defineTool({
  name: "create_client",
  title: "Crear cliente",
  description:
    "Creates a client (name, identification, email, city) in the user's directory. Never merges by name; if the same normalized identification already exists for this user it returns a conflict with that client's id and creates nothing. Requires manage grant and idempotency_key.",
  inputSchema: {
    name: z.string().trim().min(1).max(300).describe("Nombre o razón social."),
    id_number: z.string().trim().max(60).optional().describe("Identificación (cédula/NIT); se compara normalizada (sin puntos, guiones ni espacios)."),
    email: z.string().trim().email().max(200).optional(),
    city: z.string().trim().max(120).optional(),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const { data, error } = await sbForUser(ctx).rpc("mcp_create_client", {
      p_name: args.name,
      p_id_number: args.id_number ?? null,
      p_email: args.email ?? null,
      p_city: args.city ?? null,
      p_idempotency_key: args.idempotency_key,
    });
    if (error) return errorResult(rpcErrorText(error));
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok !== true) {
      return textResult(
        "Ya existe un cliente tuyo con esa identificación; no se creó otra ficha. Usa update_client si corresponde corregirlo.",
        r,
      );
    }
    return textResult(r.replayed ? "Cliente ya creado con esta clave (resultado confirmado)." : "Cliente creado.", r);
  },
});
