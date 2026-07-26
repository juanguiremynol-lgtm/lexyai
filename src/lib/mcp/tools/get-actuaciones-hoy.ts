import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { bogotaToday, errorResult, requireAuth, sbForUser, textResult } from "../shared";

const WINDOW_DAYS: Record<string, number> = { today: 1, "3days": 3, week: 7 };

export default defineTool({
  name: "get_actuaciones_hoy",
  title: "Actuaciones recientes de la cartera",
  description:
    "Lists actuaciones registered across the whole portfolio within a recent window (today, last 3 days, or last week), based on act_date in America/Bogota.",
  inputSchema: {
    date: z.string().optional().describe("Día final YYYY-MM-DD en America/Bogota. Default: hoy."),
    window: z.enum(["today", "3days", "week"]).optional().describe("Ventana hacia atrás. Default: today."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date, window, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    const end = date ?? bogotaToday();
    const days = WINDOW_DAYS[window ?? "today"];
    const start = new Date(`${end}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const from = start.toISOString().slice(0, 10);

    const { data, error } = await sb
      .from("work_item_acts")
      .select("id, work_item_id, act_date, act_type, description, despacho, source, detected_at")
      .gte("act_date", from)
      .lte("act_date", end)
      .or("is_archived.is.null,is_archived.eq.false")
      .order("act_date", { ascending: false })
      .limit(limit ?? 100);
    if (error) return errorResult(error.message);

    const ids = [...new Set((data ?? []).map((r) => (r as { work_item_id: string }).work_item_id))];
    const { data: items } = ids.length
      ? await sb.from("work_items").select("id, radicado, title, workflow_type").in("id", ids).is("deleted_at", null)
      : { data: [] as Array<Record<string, unknown>> };
    const byId = new Map((items ?? []).map((i) => [(i as { id: string }).id, i]));
    const rows = (data ?? []).map((r) => ({ ...r, work_item: byId.get((r as { work_item_id: string }).work_item_id) ?? null }));

    return textResult(`${rows.length} actuaciones entre ${from} y ${end} (America/Bogota).`, {
      date_from: from,
      date_to: end,
      actuaciones: rows,
    });
  },
});
