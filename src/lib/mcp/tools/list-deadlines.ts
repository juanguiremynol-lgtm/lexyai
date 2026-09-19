import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { bogotaToday, businessDaysBetween, errorResult, requireAuth, resolveWorkItem, sbForUser, textResult, workItemTitle } from "../shared";
import {
  ACTIVE_STATUSES,
  MANUAL_REVIEW_STATUSES,
  deadlineAttribution,
  deadlineBucket,
  deadlineUrgency,
} from "../deadline-status";

export default defineTool({
  name: "list_deadlines",
  title: "Términos procesales",
  description:
    "Lists procedural deadlines (términos). By default only genuinely active deadlines are returned. Deadlines awaiting manual review (REQUIERE_REVISION_MANUAL and equivalents) are NOT active obligations — request them explicitly with status='pending_review' and never present them as live. Each row states who the term binds (CLIENTE / CONTRAPARTE / DESPACHO / DESCONOCIDO); DESCONOCIDO means the attribution is unknown, not the client's.",
  inputSchema: {
    status: z.enum(["pending", "pending_review", "all"]).optional().describe("Default: pending (solo activos)."),
    radicado: z
      .string()
      .trim()
      .optional()
      .describe("Limitar a un asunto por radicado (23 dígitos, con guiones, con espacios, base de 21 dígitos, 22 dígitos sin cero inicial o base+instancia)."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, radicado, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    let workItem: Record<string, unknown> | null = null;
    let resolucion: string | null = null;
    if (radicado) {
      const resolved = await resolveWorkItem(sb, { radicado });
      if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      workItem = resolved.item;
      resolucion = resolved.note ?? null;
    }

    let q = sb
      .from("work_item_deadlines")
      .select(
        "id, work_item_id, deadline_type, label, description, trigger_event, trigger_date, deadline_date, business_days_count, status, requires_manual_review, bound_party_role, bound_party_source, is_judge_side",
      )
      .order("deadline_date", { ascending: true })
      .limit(limit ?? 50);

    const mode = status ?? "pending";
    if (mode === "pending") q = q.in("status", [...ACTIVE_STATUSES]);
    else if (mode === "pending_review") q = q.in("status", [...MANUAL_REVIEW_STATUSES]);
    if (workItem) q = q.eq("work_item_id", workItem.id as string);

    const { data, error } = await q;
    if (error) return errorResult(error.message);


    const rows = data ?? [];
    const today = bogotaToday();

    // Radicado enrichment so each deadline is self-describing.
    const ids = [...new Set(rows.map((r) => (r as { work_item_id: string }).work_item_id))];
    const { data: items } = ids.length
      ? await sb
          .from("work_items")
          .select("id, radicado, title, workflow_type, authority_name, demandantes, demandados")
          .in("id", ids)
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
      // Normalized title: never a workflow token, never null, never gigantic.
      const titulo = workItemTitle(wi, String(row.work_item_id));
      const dd = row.deadline_date ? String(row.deadline_date).slice(0, 10) : null;
      const restantes = dd ? businessDaysBetween(today, dd, holidays) : null;
      // Urgency comes from the calendar date; the business-day figure stays a count.
      const urgencia = deadlineUrgency(dd, today, restantes);
      return {
        ...row,
        radicado: wi?.radicado ?? null,
        titulo,
        workflow_type: wi?.workflow_type ?? null,
        despacho: wi?.authority_name ?? null,
        vencimiento: dd,
        dias_habiles_restantes: restantes,
        urgencia,
        clasificacion: deadlineBucket(
          row.status as string | null,
          row.requires_manual_review as boolean | null,
        ),
        atribucion: deadlineAttribution({
          bound_party_role: row.bound_party_role as string | null,
          is_judge_side: row.is_judge_side as boolean | null,
        }),
        atribucion_fuente: (row.bound_party_source as string | null) ?? null,
      };
    });

    const note =
      mode === "pending"
        ? "Solo términos activos."
        : mode === "pending_review"
          ? "Términos en revisión manual (REQUIERE_REVISION_MANUAL y equivalentes): NO son obligaciones vigentes."
          : "Incluye activos, en revisión y cerrados; solo los ACTIVO son obligaciones vigentes. 'atribucion: DESCONOCIDO' significa que no se sabe a quién obliga el término.";


    return textResult(`${resolucion ? `${resolucion}\n` : ""}${deadlines.length} términos. ${note} (hoy = ${today}, America/Bogota)`, {
      resolucion,
      status: mode,
      hoy: today,
      work_item: workItem,
      deadlines,
    });
  },
});
