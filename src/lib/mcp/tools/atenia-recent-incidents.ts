import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requirePlatformAdmin, textResult } from "../shared";

export default defineTool({
  name: "atenia_recent_incidents",
  title: "Atenia · Incidentes recientes (solo administradores)",
  description:
    "PLATFORM ADMINS ONLY. Lists WARN/ERROR system health events and failed cron runs in the last N days (default 7). Non-admin callers get a clean refusal.",
  inputSchema: {
    days: z.number().int().min(1).max(90).optional().describe("Ventana en días (default 7)."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de eventos (default 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days, limit }, ctx) => {
    const { error: denied, sb } = await requirePlatformAdmin(ctx);
    if (denied) return errorResult(denied);

    const window = days ?? 7;
    const since = new Date(Date.now() - window * 86_400_000).toISOString();

    const [events, crons] = await Promise.all([
      sb
        .from("system_health_events")
        .select("id, service, status, message, metadata, created_at, organization_id")
        .in("status", ["WARN", "ERROR"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit ?? 100),
      sb
        .from("atenia_cron_runs")
        .select("id, job_name, status, started_at, finished_at, details")
        .eq("status", "FAILED")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(limit ?? 100),
    ]);

    if (events.error) return errorResult(events.error.message);
    const evRows = events.data ?? [];
    const cronRows = crons.data ?? [];

    return textResult(
      `Últimos ${window} día(s): ${evRows.length} evento(s) WARN/ERROR y ${cronRows.length} cron(s) fallido(s).`,
      {
        ventana_dias: window,
        desde: since,
        eventos: evRows,
        crons_fallidos: cronRows,
      },
    );
  },
});
