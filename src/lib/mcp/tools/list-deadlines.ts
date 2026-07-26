import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { bogotaToday, businessDaysBetween, errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_deadlines",
  title: "Términos procesales",
  description:
    "Lists procedural deadlines (términos). By default only genuinely active deadlines are returned; deadlines flagged PENDING_REVIEW are historical/backfilled and are NOT active — request them explicitly and never present them as live obligations.",
  inputSchema: {
    status: z.enum(["pending", "pending_review", "all"]).optional().describe("Default: pending (solo activos)."),
    radicado: z.string().trim().optional().describe("Limitar a un asunto por radicado."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, radicado, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    let workItem: Record<string, unknown> | null = null;
    if (radicado) {
      const resolved = await resolveWorkItem(sb, { radicado });
      if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      workItem = resolved.item;
    }

    let q = sb
      .from("work_item_deadlines")
      .select("id, work_item_id, deadline_type, label, description, trigger_event, trigger_date, deadline_date, business_days_count, status")
      .order("deadline_date", { ascending: true })
      .limit(limit ?? 50);

    const mode = status ?? "pending";
    if (mode === "pending") q = q.eq("status", "PENDING");
    else if (mode === "pending_review") q = q.eq("status", "PENDING_REVIEW");
    if (workItem) q = q.eq("work_item_id", workItem.id as string);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    const rows = data ?? [];
    const today = bogotaToday();

    // Radicado enrichment so each deadline is self-describing.
    const ids = [...new Set(rows.map((r) => (r as { work_item_id: string }).work_item_id))];
    const { data: items } = ids.length
      ? await sb.from("work_items").select("id, radicado, title, workflow_type, authority_name").in("id", ids)
      : { data: [] as Array<Record<string, unknown>> };
    const byId = new Map<string, Record<string, unknown>>(
      (items ?? []).map(
        (i) => [(i as { id: string }).id, i as Record<string, unknown>] as [string, Record<string, unknown>],
      ),
    );

    // Colombian holidays inside the relevant horizon (business-day countdown).
    const dates = rows.map((r) => String((r as { deadline_date?: string }).deadline_date ?? "")).filter(Boolean).sort();
    const horizonEnd = dates[dates.length - 1] ?? today;
    const { data: holidayRows } = await sb
      .from("colombian_holidays")
      .select("holiday_date")
      .gte("holiday_date", dates[0] && dates[0] < today ? dates[0] : today)
      .lte("holiday_date", horizonEnd > today ? horizonEnd : today);
    const holidays = new Set((holidayRows ?? []).map((h) => String((h as { holiday_date: string }).holiday_date)));

    const deadlines = rows.map((r) => {
      const row = r as Record<string, unknown>;
      const wi = byId.get(String(row.work_item_id)) ?? null;
      // Normalized title: never the workflow_type, never null.
      const rawTitle = wi?.title ? String(wi.title).trim() : "";
      const wf = wi?.workflow_type ? String(wi.workflow_type).trim() : "";
      const dte = wi?.demandantes ? String(wi.demandantes).trim() : "";
      const ddo = wi?.demandados ? String(wi.demandados).trim() : "";
      const partes = dte && ddo ? `${dte} vs ${ddo}` : dte || ddo;
      const titulo =
        rawTitle && rawTitle.toUpperCase() !== wf.toUpperCase()
          ? rawTitle
          : partes || (wi?.radicado ? String(wi.radicado) : String(row.work_item_id));
      const dd = row.deadline_date ? String(row.deadline_date).slice(0, 10) : null;
      const restantes = dd ? businessDaysBetween(today, dd, holidays) : null;
      const urgencia =
        restantes == null ? "SIN_FECHA"
          : restantes < 0 ? "VENCIDO"
          : restantes === 0 ? "VENCE_HOY"
          : restantes <= 2 ? "CRITICO"
          : restantes <= 5 ? "PROXIMO"
          : "NORMAL";
      return {
        ...row,
        radicado: wi?.radicado ?? null,
        titulo,
        workflow_type: wi?.workflow_type ?? null,
        despacho: wi?.authority_name ?? null,
        vencimiento: dd,
        dias_habiles_restantes: restantes,
        urgencia,
      };
    });

    const note =
      mode === "pending"
        ? "Solo términos activos."
        : mode === "pending_review"
          ? "Términos en revisión (vencidos en el backfill): NO son obligaciones vigentes."
          : "Incluye activos y en revisión; los PENDING_REVIEW no son obligaciones vigentes.";

    return textResult(`${deadlines.length} términos. ${note} (hoy = ${today}, America/Bogota)`, {
      status: mode,
      hoy: today,
      work_item: workItem,
      deadlines,
    });
  },
});
