import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_publicaciones",
  title: "Estados electrónicos de un asunto",
  description:
    "Lists electronic estados / publicaciones procesales for one matter, newest fijación first. Identify the matter by radicado or work item id.",
  inputSchema: {
    radicado: z.string().trim().optional().describe("Radicado del asunto."),
    id: z.string().uuid().optional().describe("UUID del asunto."),
    date_from: z.string().optional().describe("Fecha inicial YYYY-MM-DD (sobre fecha_fijacion)."),
    date_to: z.string().optional().describe("Fecha final YYYY-MM-DD (sobre fecha_fijacion)."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ radicado, id, date_from, date_to, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    const { item, error } = await resolveWorkItem(sb, { id, radicado });
    if (error || !item) return errorResult(error ?? "Asunto no encontrado.");

    let q = sb
      .from("work_item_publicaciones")
      .select("id, fecha_fijacion, fecha_desfijacion, fecha_providencia, tipo_publicacion, title, annotation, despacho, source, pdf_available, detected_at")
      .eq("work_item_id", item.id as string)
      .or("is_archived.is.null,is_archived.eq.false")
      .order("fecha_fijacion", { ascending: false })
      .limit(limit ?? 50);
    if (date_from) q = q.gte("fecha_fijacion", date_from);
    if (date_to) q = q.lte("fecha_fijacion", date_to);

    const { data, error: qErr } = await q;
    if (qErr) return errorResult(qErr.message);
    return textResult(
      `${data?.length ?? 0} estados para ${item.radicado ?? item.id}.`,
      { work_item: item, publicaciones: data ?? [] },
    );
  },
});
