import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_hearings",
  title: "Audiencias programadas",
  description:
    "Lists hearings (audiencias) from the canonical work_item_hearings table, RLS-scoped to the caller. Rows WITH scheduled_at are hearings actually scheduled; rows WITHOUT it are detected placeholders with no date and are returned apart, never mixed into the agenda. Optionally filter by matter and by date range (ISO dates, America/Bogota calendar).",
  inputSchema: {
    work_item_id: z.string().uuid().optional().describe("Limitar a un asunto (UUID)."),
    radicado: z.string().trim().optional().describe("Limitar a un asunto por radicado."),
    date_from: z.string().trim().optional().describe("Fecha inicial ISO (YYYY-MM-DD)."),
    date_to: z.string().trim().optional().describe("Fecha final ISO (YYYY-MM-DD)."),
    include_placeholders: z
      .boolean()
      .optional()
      .describe("Incluir los marcadores sin fecha (default true, siempre en una lista aparte)."),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo de filas (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ work_item_id, radicado, date_from, date_to, include_placeholders, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    let itemId = work_item_id ?? null;
    if (!itemId && radicado) {
      const resolved = await resolveWorkItem(sb, { radicado });
      if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      itemId = resolved.item.id as string;
    }

    const cap = limit ?? 50;
    // One extra row is fetched so `hay_mas` reports a fact, not a coincidence
    // of the page being exactly full.
    let q = sb
      .from("work_item_hearings")
      .select("id, work_item_id, custom_name, status, scheduled_at, occurred_at, duration_minutes, modality, location, meeting_link, decisions_summary")
      .order("scheduled_at", { ascending: true })
      .limit(cap + 1);

    if (itemId) q = q.eq("work_item_id", itemId);
    if (date_from) q = q.gte("scheduled_at", `${date_from}T00:00:00-05:00`);
    if (date_to) q = q.lte("scheduled_at", `${date_to}T23:59:59-05:00`);
    if (include_placeholders === false || date_from || date_to) q = q.not("scheduled_at", "is", null);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    const fetched = data ?? [];
    const hayMas = fetched.length > cap;
    const rows = fetched.slice(0, cap);
    const ids = [...new Set(rows.map((r) => String((r as { work_item_id: string }).work_item_id)))];
    const { data: items } = ids.length
      ? await sb.from("work_items").select("id, radicado, title, workflow_type, authority_name").in("id", ids)
      : { data: [] as Array<Record<string, unknown>> };
    const byId = new Map<string, Record<string, unknown>>(
      (items ?? []).map(
        (i) => [(i as { id: string }).id, i as Record<string, unknown>] as [string, Record<string, unknown>],
      ),
    );

    const hearings: Record<string, unknown>[] = rows.map((r) => {
      const row = r as Record<string, unknown>;
      const wi = byId.get(String(row.work_item_id)) ?? null;
      const out: Record<string, unknown> = {
        ...row,
        radicado: wi?.radicado ?? null,
        titulo_asunto: wi?.title ?? null,
        workflow_type: wi?.workflow_type ?? null,
        despacho: wi?.authority_name ?? null,
      };
      return out;
    });

    const programadas = hearings.filter((h) => h.scheduled_at);
    const marcadores = hearings.filter((h) => !h.scheduled_at);

    return textResult(
      `${programadas.length} audiencia(s) con fecha programada${marcadores.length ? ` y ${marcadores.length} marcador(es) detectado(s) sin fecha (no son audiencias agendadas)` : ""}${hayMas ? ` — tope de ${cap} alcanzado, hay más filas; sube \`limit\` o acota con date_from/date_to` : ""}.`,
      {
        work_item_id: itemId,
        range: { from: date_from ?? null, to: date_to ?? null },
        limit: cap,
        hay_mas: hayMas,
        audiencias_programadas: programadas,
        marcadores_sin_fecha: marcadores,
        nota: "Solo `audiencias_programadas` tiene fecha y hora. `marcadores_sin_fecha` son filas detectadas sin fecha: nunca deben presentarse como agenda.",
      },
    );
  },
});