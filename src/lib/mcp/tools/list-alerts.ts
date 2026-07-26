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
    radicado: z.string().trim().optional().describe("Limitar a un asunto por radicado."),
    status: z.enum(["PENDING", "ACKNOWLEDGED", "RESOLVED", "all"]).optional().describe("Default: pendientes + reconocidas."),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo de filas (default 30)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ work_item_id, radicado, status, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    let entityId = work_item_id ?? null;
    if (!entityId && radicado) {
      const resolved = await resolveWorkItem(sb, { radicado });
      if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      entityId = resolved.item.id as string;
    }

    let q = sb
      .from("alert_instances")
      .select("id, alert_type, severity, status, title, message, entity_type, entity_id, fired_at, acknowledged_at, read_at")
      .order("fired_at", { ascending: false })
      .limit(limit ?? 30);

    if (!status || status === "all") {
      if (!status) q = q.in("status", ["PENDING", "ACKNOWLEDGED"]);
    } else {
      q = q.eq("status", status);
    }
    if (entityId) q = q.eq("entity_id", entityId);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    const unread = (data ?? []).filter((a) => !(a as { read_at?: string | null }).read_at).length;
    return textResult(
      `${data?.length ?? 0} alertas (${unread} sin leer).`,
      { status: status ?? "PENDING+ACKNOWLEDGED", work_item_id: entityId, unread, alerts: data ?? [] },
    );
  },
});