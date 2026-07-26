import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_hearings",
  title: "Audiencias programadas",
  description:
    "Lists scheduled hearings (audiencias) from the canonical work_item_hearings table, RLS-scoped to the caller. Optionally filter by matter and by date range (ISO dates, America/Bogota calendar).",
  inputSchema: {
    work_item_id: z.string().uuid().optional().describe("Limitar a un asunto (UUID)."),
    radicado: z.string().trim().optional().describe("Limitar a un asunto por radicado."),
    date_from: z.string().trim().optional().describe("Fecha inicial ISO (YYYY-MM-DD)."),
    date_to: z.string().trim().optional().describe("Fecha final ISO (YYYY-MM-DD)."),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo de filas (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ work_item_id, radicado, date_from, date_to, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    let itemId = work_item_id ?? null;
    if (!itemId && radicado) {
      const resolved = await resolveWorkItem(sb, { radicado });
      if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      itemId = resolved.item.id as string;
    }

    let q = sb
      .from("work_item_hearings")
      .select("id, work_item_id, custom_name, status, scheduled_at, occurred_at, duration_minutes, modality, location, meeting_link, decisions_summary")
      .order("scheduled_at", { ascending: true })
      .limit(limit ?? 50);

    if (itemId) q = q.eq("work_item_id", itemId);
    if (date_from) q = q.gte("scheduled_at", `${date_from}T00:00:00-05:00`);
    if (date_to) q = q.lte("scheduled_at", `${date_to}T23:59:59-05:00`);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    const rows = data ?? [];
    const ids = [...new Set(rows.map((r) => String((r as { work_item_id: string }).work_item_id)))];
    const { data: items } = ids.length
      ? await sb.from("work_items").select("id, radicado, title, workflow_type, authority_name").in("id", ids)
      : { data: [] as Array<Record<string, unknown>> };
    const byId = new Map<string, Record<string, unknown>>(
      (items ?? []).map(
        (i) => [(i as { id: string }).id, i as Record<string, unknown>] as [string, Record<string, unknown>],
      ),
    );

    const hearings = rows.map((r) => {
      const row = r as Record<string, unknown>;
      const wi = byId.get(String(row.work_item_id)) ?? null;
      return {
        ...row,
        radicado: wi?.radicado ?? null,
        titulo_asunto: wi?.title ?? null,
        workflow_type: wi?.workflow_type ?? null,
        despacho: wi?.authority_name ?? null,
      };
    });

    const cap = limit ?? 50;
    const hayMas = hearings.length === cap;

    return textResult(
      `${hearings.length} audiencias${hayMas ? ` (tope de ${cap} alcanzado — puede haber más; sube \`limit\` o acota con date_from/date_to)` : ""}.`,
      {
        work_item_id: itemId,
        range: { from: date_from ?? null, to: date_to ?? null },
        limit: cap,
        hay_mas: hayMas,
        hearings,
      },
    );
  },
});