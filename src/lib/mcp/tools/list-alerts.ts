import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_alerts",
  title: "Alertas del abogado",
  description:
    "Lists the caller's judicial alerts (alert_instances). Default: unresolved alerts (PENDING and ACKNOWLEDGED), newest first. Use it to answer 'how many unread alerts do I have'.",
  inputSchema: {
    work_item_id: z.string().uuid().optional().describe("Limitar a un asunto (UUID)."),
    radicado: z
      .string()
      .trim()
      .optional()
      .describe("Limitar a un asunto por radicado (23 dígitos, con guiones, con espacios, base de 21 dígitos, 22 dígitos sin cero inicial o base+instancia)."),
    status: z.string().trim().optional().describe("pending | acknowledged | resolved | all. Default: pendientes + reconocidas."),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo de filas (default 30)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ work_item_id, radicado, status, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    let entityId = work_item_id ?? null;
    let resolucion: string | null = null;
    if (!entityId && radicado) {
      const resolved = await resolveWorkItem(sb, { radicado });
      if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      entityId = resolved.item.id as string;
      resolucion = resolved.note ?? null;
    }

    let q = sb
      .from("alert_instances")
      .select("id, alert_type, severity, status, title, message, entity_type, entity_id, fired_at, acknowledged_at, read_at")
      .order("fired_at", { ascending: false })
      .limit(limit ?? 30);

    const normalized = status?.toUpperCase();
    if (!normalized) q = q.in("status", ["PENDING", "ACKNOWLEDGED"]);
    else if (normalized !== "ALL") q = q.eq("status", normalized);
    if (entityId) q = q.eq("entity_id", entityId);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    const rows = data ?? [];
    const wiIds = [
      ...new Set(
        rows
          .filter((a) => String((a as { entity_type?: string }).entity_type ?? "").toUpperCase() === "WORK_ITEM")
          .map((a) => String((a as { entity_id?: string }).entity_id ?? ""))
          .filter(Boolean),
      ),
    ];
    const { data: items } = wiIds.length
      ? await sb.from("work_items").select("id, radicado, title, workflow_type").in("id", wiIds)
      : { data: [] as Array<Record<string, unknown>> };
    const byId = new Map<string, Record<string, unknown>>(
      (items ?? []).map(
        (i) => [(i as { id: string }).id, i as Record<string, unknown>] as [string, Record<string, unknown>],
      ),
    );

    const alerts = rows.map((a) => {
      const row = a as Record<string, unknown>;
      const wi = byId.get(String(row.entity_id ?? "")) ?? null;
      return {
        ...row,
        radicado: wi?.radicado ?? null,
        titulo_asunto: wi?.title ?? null,
        workflow_type: wi?.workflow_type ?? null,
        leida: Boolean(row.read_at),
      };
    });

    const unread = alerts.filter((a) => !a.leida).length;
    return textResult(`${resolucion ? `${resolucion}\n` : ""}${alerts.length} alertas (${unread} sin leer).`, {
      resolucion,
      status: status ?? "PENDING+ACKNOWLEDGED",
      work_item_id: entityId,
      unread,
      alerts,
    });
  },
});