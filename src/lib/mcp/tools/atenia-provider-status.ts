import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, requirePlatformAdmin, textResult } from "../shared";

export default defineTool({
  name: "atenia_provider_status",
  title: "Atenia · Estado de proveedores judiciales (solo administradores)",
  description:
    "PLATFORM ADMINS ONLY. Per-provider status from the latest Atenia preflight run (CPNU, SAMAI, Publicaciones Procesales, SAMAI Estados), including consecutive failures. Non-admin callers get a clean refusal.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {},
  handler: async (_args, ctx) => {
    const { error: denied, sb } = await requirePlatformAdmin(ctx);
    if (denied) return errorResult(denied);

    const { data, error } = await sb
      .from("atenia_preflight_checks")
      .select("id, trigger, started_at, overall_status, decision, results, consecutive_failures_by_provider, providers_tested, providers_passed, providers_failed")
      .order("started_at", { ascending: false })
      .limit(1);
    if (error) return errorResult(error.message);

    const run = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!run) return textResult("No hay ejecuciones de preflight registradas.", { proveedores: [] });

    const results = Array.isArray(run.results) ? (run.results as Record<string, unknown>[]) : [];
    const failing = results.filter((r) => String(r.status ?? "").toUpperCase() !== "OK");

    return textResult(
      `Preflight ${String(run.overall_status)}: ${run.providers_passed}/${run.providers_tested} proveedores OK, ${failing.length} con fallo.`,
      {
        ejecutado_en: run.started_at,
        overall_status: run.overall_status,
        decision: run.decision ?? null,
        proveedores: results,
        proveedores_con_fallo: failing,
        fallos_consecutivos: run.consecutive_failures_by_provider ?? {},
      },
    );
  },
});
