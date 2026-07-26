import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, requirePlatformAdmin, textResult } from "../shared";

export default defineTool({
  name: "atenia_health_overview",
  title: "Atenia · Salud de la plataforma (solo administradores)",
  description:
    "PLATFORM ADMINS ONLY. Returns the current Andromeda platform health snapshot: latest Atenia preflight verdict, service heartbeats and the last cron runs. Non-admin callers get a clean refusal.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {},
  handler: async (_args, ctx) => {
    const { error: denied, sb } = await requirePlatformAdmin(ctx);
    if (denied) return errorResult(denied);

    const [preflight, heartbeats, crons] = await Promise.all([
      sb
        .from("atenia_preflight_checks")
        .select("id, trigger, started_at, finished_at, duration_ms, overall_status, decision, providers_tested, providers_passed, providers_failed")
        .order("started_at", { ascending: false })
        .limit(1),
      sb
        .from("system_health_heartbeat")
        .select("service, last_status, last_ok_at, last_error_at, last_message, updated_at")
        .order("service"),
      sb
        .from("atenia_cron_runs")
        .select("job_name, status, started_at, finished_at")
        .order("started_at", { ascending: false })
        .limit(25),
    ]);

    const hb = heartbeats.data ?? [];
    const cronRows = crons.data ?? [];
    const degraded = hb.filter((h) => (h as { last_status?: string }).last_status !== "OK");
    const failedCrons = cronRows.filter((c) => (c as { status?: string }).status === "FAILED");

    return textResult(
      `Salud de la plataforma: ${degraded.length} servicio(s) degradado(s), ${failedCrons.length} cron(s) fallido(s) en las últimas ejecuciones.`,
      {
        ultimo_preflight: (preflight.data ?? [])[0] ?? null,
        heartbeats: hb,
        servicios_degradados: degraded,
        crons_recientes: cronRows,
        crons_fallidos: failedCrons,
      },
    );
  },
});
