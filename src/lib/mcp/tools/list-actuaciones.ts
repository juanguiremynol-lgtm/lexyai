import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";
import { finishPage, pageBoundary, readPageCursor } from "../keyset-page";

export default defineTool({
  name: "list_actuaciones",
  title: "Actuaciones de un asunto",
  description:
    "Lists judicial actuaciones for one matter, newest first. Identify the matter by radicado or work item id. Archived and superseded rows are excluded.",
  inputSchema: {
    radicado: z
      .string()
      .trim()
      .optional()
      .describe("Radicado en cualquier forma: 23 dígitos, con guiones, con espacios, base de 21 dígitos, 22 dígitos sin cero inicial o base+instancia."),
    id: z.string().uuid().optional().describe("UUID del asunto (alternativa al radicado)."),
    date_from: z.string().optional().describe("Fecha inicial YYYY-MM-DD (sobre act_date)."),
    date_to: z.string().optional().describe("Fecha final YYYY-MM-DD (sobre act_date)."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 50)."),
    cursor: z.string().max(2048).optional().describe("next_cursor anterior; conserva asunto y filtros de fecha."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ radicado, id, date_from, date_to, limit, cursor }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    const resolved = await resolveWorkItem(sb, { id, radicado });
    const item = resolved.item;
    if (resolved.error || !item) return errorResult(resolved.error ?? "Asunto no encontrado.");
    const scope = JSON.stringify(["acts", item.id, date_from ?? "", date_to ?? ""]);
    let boundary;
    try { boundary = readPageCursor(cursor, scope); } catch (error) { return errorResult((error as Error).message); }
    const pageSize = limit ?? 50;

    let q = sb
      .from("work_item_acts")
      .select("id, act_date, act_type, description, despacho, source, detected_at, instancia")
      .eq("work_item_id", item.id as string)
      .or("is_archived.is.null,is_archived.eq.false")
      .order("act_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(pageSize + 1);
    if (boundary) q = q.or(pageBoundary("act_date", boundary));
    if (date_from) q = q.gte("act_date", date_from);
    if (date_to) q = q.lte("act_date", date_to);

    const { data, error: qErr } = await q;
    if (qErr) return errorResult(qErr.message);
    const page = finishPage(data ?? [], pageSize, "act_date", scope);
    return textResult(
      `${resolved.note ? `${resolved.note}\n` : ""}${page.items.length} actuaciones para ${item.radicado ?? item.id} en esta página.`,
      { resolucion: resolved.note ?? null, work_item: item, actuaciones: page.items, has_more: page.has_more, next_cursor: page.next_cursor },
    );
  },
});
