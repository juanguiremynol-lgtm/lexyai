import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_recent_estados",
  title: "Novedades judiciales recientes",
  description:
    "Lists the most recent judicial estados / actuaciones detected across the signed-in user's monitored matters, ordered by detected_at desc.",
  inputSchema: {
    days: z.number().int().min(1).max(30).optional().describe("Ventana en días (default 3)."),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo filas (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    const since = new Date(Date.now() - (days ?? 3) * 86400_000).toISOString();
    const { data, error } = await sb
      .from("work_item_publicaciones")
      .select("id, work_item_id, title, annotation, tipo_publicacion, despacho, fecha_fijacion, detected_at, source")
      .gte("detected_at", since)
      .or("is_archived.is.null,is_archived.eq.false")
      .order("detected_at", { ascending: false })
      .limit(limit ?? 25);
    if (error) return errorResult(error.message);

    // Enrich with the matter's radicado so the answer is self-contained.
    const ids = [...new Set((data ?? []).map((r) => (r as { work_item_id: string }).work_item_id))];
    const { data: items } = ids.length
      ? await sb.from("work_items").select("id, radicado, title, workflow_type").in("id", ids)
      : { data: [] as Array<Record<string, unknown>> };
    const byId = new Map<string, unknown>(
      (items ?? []).map((i) => [(i as { id: string }).id, i] as [string, unknown]),
    );
    const estados = (data ?? []).map((r) => ({
      ...(r as Record<string, unknown>),
      work_item: byId.get((r as { work_item_id: string }).work_item_id) ?? null,
    }));

    return textResult(`${estados.length} novedades en los últimos ${days ?? 3} días.`, { estados });
  },
});