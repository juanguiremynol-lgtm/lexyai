import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_clients",
  title: "Listar clientes",
  description: "Lists the signed-in lawyer's clients with the number of active matters linked to each one.",
  inputSchema: {
    search: z.string().trim().optional().describe("Búsqueda por nombre o identificación."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    let q = sb
      .from("clients")
      .select("id, name, id_number, email, city, created_at")
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .limit(limit ?? 50);
    if (search) q = q.or(`name.ilike.%${search}%,id_number.ilike.%${search}%`);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    const ids = (data ?? []).map((c) => (c as { id: string }).id);
    const { data: items } = ids.length
      ? await sb.from("work_items").select("id, client_id").in("client_id", ids).is("deleted_at", null)
      : { data: [] as Array<Record<string, unknown>> };
    const counts: Record<string, number> = {};
    for (const it of items ?? []) {
      const cid = (it as { client_id: string | null }).client_id;
      if (cid) counts[cid] = (counts[cid] ?? 0) + 1;
    }
    const rows = (data ?? []).map((c) => ({ ...c, active_work_items: counts[(c as { id: string }).id] ?? 0 }));

    return textResult(`${rows.length} clientes.`, { clients: rows });
  },
});
