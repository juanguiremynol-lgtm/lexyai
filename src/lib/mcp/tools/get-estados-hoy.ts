import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { bogotaToday, errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "get_estados_hoy",
  title: "Estados de hoy",
  description:
    "Lists estados electrónicos fijados TODAY (America/Bogota) across the whole portfolio. An estado belongs to a day when its fecha_fijacion equals that calendar day in Bogota — not when it was detected.",
  inputSchema: {
    date: z.string().optional().describe("Día YYYY-MM-DD en America/Bogota. Default: hoy."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    const day = date ?? bogotaToday();

    const { data, error } = await sb
      .from("work_item_publicaciones")
      .select("id, work_item_id, fecha_fijacion, fecha_desfijacion, tipo_publicacion, title, annotation, despacho, source")
      .eq("fecha_fijacion", day)
      .or("is_archived.is.null,is_archived.eq.false")
      .order("despacho", { ascending: true })
      .limit(limit ?? 100);
    if (error) return errorResult(error.message);

    const ids = [...new Set((data ?? []).map((r) => (r as { work_item_id: string }).work_item_id))];
    const { data: items } = ids.length
      ? await sb.from("work_items").select("id, radicado, title, workflow_type").in("id", ids).is("deleted_at", null)
      : { data: [] as Array<Record<string, unknown>> };
    const byId = new Map<string, unknown>(
      (items ?? []).map((i) => [(i as { id: string }).id, i] as [string, unknown]),
    );
    const rows = (data ?? []).map((r) => ({ ...r, work_item: byId.get((r as { work_item_id: string }).work_item_id) ?? null }));

    return textResult(`${rows.length} estados fijados el ${day} (America/Bogota).`, { date: day, estados: rows });
  },
});
