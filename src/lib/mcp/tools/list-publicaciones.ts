import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { extractAutoHeaderDate } from "../../auto-header-date";
import { bogotaDayStartUTC, errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_publicaciones",
  title: "Estados electrónicos de un asunto",
  description:
    "Lists electronic estados / publicaciones procesales for one matter, newest fijación first. Identify the matter by radicado or work item id. " +
    "Cada fila conserva la fecha_providencia estructurada de la fuente y añade una señal de calidad: " +
    "fecha_auto_encabezado (fecha candidata detectada solo en un encabezado inequívoco del texto del auto, " +
    "o null=desconocido), su estado (detectada|desconocida|no_verificable) y discrepancia_fecha_providencia " +
    "con ambas procedencias cuando difieren. Nunca devuelve el texto del auto ni reescribe la fecha fuente.",
  inputSchema: {
    radicado: z
      .string()
      .trim()
      .optional()
      .describe("Radicado en cualquier forma: 23 dígitos, con guiones, con espacios, base de 21 dígitos, 22 dígitos sin cero inicial o base+instancia."),
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
    const resolved = await resolveWorkItem(sb, { id, radicado });
    const item = resolved.item;
    if (resolved.error || !item) return errorResult(resolved.error ?? "Asunto no encontrado.");

    let q = sb
      .from("work_item_publicaciones")
      .select("id, fecha_fijacion, fecha_desfijacion, fecha_providencia, tipo_publicacion, title, annotation, despacho, source, pdf_available, detected_at")
      .eq("work_item_id", item.id as string)
      .or("is_archived.is.null,is_archived.eq.false")
      .order("fecha_fijacion", { ascending: false })
      .limit(limit ?? 50);
    // timestamptz column: bound by Bogota day instants, not date strings.
    if (date_from) q = q.gte("fecha_fijacion", bogotaDayStartUTC(date_from));
    if (date_to) q = q.lt("fecha_fijacion", bogotaDayStartUTC(date_to, 1));

    const { data, error: qErr } = await q;
    if (qErr) return errorResult(qErr.message);
    const rows = data ?? [];

    // Quality signal: candidate date from the auto's header text only. The
    // SECURITY INVOKER RPC returns a short prefix for RLS-visible rows, so the
    // full text never leaves the database. An extraction failure degrades to
    // "no_verificable" — never to a reliable-looking date.
    let headerState: "ok" | "no_verificable" = "ok";
    const headerDates = new Map<string, string | null>();
    if (rows.length) {
      const { data: prefixes, error: pErr } = await sb.rpc("publicacion_auto_text_prefix", {
        p_ids: rows.map((r) => r.id as string),
      });
      if (pErr) {
        headerState = "no_verificable";
      } else {
        for (const p of prefixes ?? []) {
          headerDates.set(p.id as string, extractAutoHeaderDate(p.texto_prefix));
        }
      }
    }

    const publicaciones = rows.map((r) => {
      const candidate = headerDates.get(r.id as string) ?? null;
      const structured = typeof r.fecha_providencia === "string"
        ? (r.fecha_providencia as string).slice(0, 10)
        : null;
      const discrepancia = structured && candidate && structured !== candidate
        ? {
          fecha_estructurada: structured,
          fecha_encabezado: candidate,
          procedencia_estructurada: "fuente",
          procedencia_encabezado: "texto_auto_encabezado",
        }
        : null;
      return {
        ...r,
        fecha_auto_encabezado: headerState === "no_verificable" ? null : candidate,
        fecha_auto_encabezado_estado: headerState === "no_verificable"
          ? "no_verificable"
          : candidate
          ? "detectada"
          : "desconocida",
        discrepancia_fecha_providencia: discrepancia,
      };
    });

    return textResult(
      `${resolved.note ? `${resolved.note}\n` : ""}${rows.length} estados para ${item.radicado ?? item.id}.`,
      { resolucion: resolved.note ?? null, work_item: item, publicaciones },
    );
  },
});
