import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "get_client",
  title: "Detalle de cliente",
  description: "Fetches one client and the matters linked to them. Identify the client by id or by exact/partial name.",
  inputSchema: {
    client_id: z.string().uuid().optional().describe("UUID del cliente."),
    name: z.string().trim().optional().describe("Nombre del cliente (coincidencia parcial)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, name }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    if (!client_id && !name) return errorResult("Indica client_id o name.");
    const sb = sbForUser(ctx);

    let q = sb.from("clients").select("id, name, id_number, email, city, address, notes, created_at").is("deleted_at", null).limit(1);
    if (client_id) q = q.eq("id", client_id);
    else if (name) q = q.ilike("name", `%${name}%`);

    const { data, error } = await q;
    if (error) return errorResult(error.message);
    const client = data?.[0];
    if (!client) return errorResult("Cliente no encontrado (o no pertenece a tu cuenta).");

    const { data: items } = await sb
      .from("work_items")
      .select("id, radicado, title, workflow_type, stage, authority_name")
      .eq("client_id", (client as { id: string }).id)
      .is("deleted_at", null)
      .limit(200);

    return textResult(
      `${(client as { name: string }).name} — ${items?.length ?? 0} asuntos activos.`,
      { client, work_items: items ?? [] },
    );
  },
});
