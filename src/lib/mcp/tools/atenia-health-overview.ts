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

    // A failed read is not an empty health inventory. In particular, an RLS
    // or database failure must never be presented as zero degraded services.
    if (preflight.error || heartbeats.error || crons.error) {
      return errorResult("No se pudo leer el estado completo de salud; no es posible concluir que los servicios estén sanos.");
    }

    const hb = heartbeats.data ?? [];
    const cronRows = crons.data ?? [];
    const degraded = hb.filter((h) => (h as { last_status?: string }).last_status !== "OK");
    const failedCrons = cronRows.filter((c) => (c as { status?: string }).status === "FAILED");
    const latestPreflight = (preflight.data ?? [])[0] ?? null;

    return textResult(
      `Observación parcial: ${latestPreflight ? "hay un preflight registrado" : "sin preflight registrado; estado de proveedores desconocido"}. ` +
        `${hb.length ? `${degraded.length} latido(s) degradado(s) entre los ${hb.length} registrados` : "sin latidos registrados; salud desconocida"}. ` +
        `${cronRows.length ? `${failedCrons.length} cron(s) fallido(s) entre las últimas ${cronRows.length} ejecuciones registradas` : "sin ejecuciones de cron registradas"}. ` +
        "La vigencia de estos indicadores no se evaluó; no acreditan cobertura ni actualización de los asuntos.",
      {
        ultimo_preflight: latestPreflight,
        estado_preflight: latestPreflight ? "REGISTRADO_FRESCURA_NO_EVALUADA" : "DESCONOCIDO_SIN_PREFLIGHT",
        estado_latidos: hb.length ? "REGISTRADOS_FRESCURA_NO_EVALUADA" : "DESCONOCIDO_SIN_LATIDOS",
        alcance: "INDICADORES_PARCIALES_NO_ACREDITAN_COBERTURA",
        heartbeats: hb,
        servicios_degradados: degraded,
        crons_recientes: cronRows,
        crons_fallidos: failedCrons,
      },
    );
  },
});
