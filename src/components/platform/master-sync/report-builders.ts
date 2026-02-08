import type { ItemSyncResult, MasterSyncConfig } from "./types";

export function buildGeminiPrompt(results: ItemSyncResult[], config: MasterSyncConfig): string {
  const succeeded = results.filter((r) => r.act_ok === true);
  const failed = results.filter((r) => r.act_status === "error");
  const timeouts = failed.filter(
    (r) => r.act_error_code === "PROVIDER_TIMEOUT" || (r.act_latency_ms && r.act_latency_ms > 40000),
  );
  const provider404s = failed.filter(
    (r) => r.act_error_code === "PROVIDER_404" || r.act_error_code === "RECORD_NOT_FOUND",
  );
  const unknowns = failed.filter(
    (r) => !["PROVIDER_TIMEOUT", "PROVIDER_404", "RECORD_NOT_FOUND"].includes(r.act_error_code || ""),
  );

  const cpnuItems = results.filter(
    (r) => r.act_provider === "cpnu" || ["CGP", "LABORAL", "PENAL_906"].includes(r.workflow_type),
  );
  const samaiItems = results.filter((r) => r.act_provider === "samai" || r.workflow_type === "CPACA");

  const avgLat = (items: ItemSyncResult[]) => {
    const valid = items.filter((r) => r.act_latency_ms);
    return valid.length > 0 ? Math.round(valid.reduce((s, r) => s + (r.act_latency_ms || 0), 0) / valid.length) : 0;
  };

  return `Eres Atenia AI, el asistente de supervisión de la plataforma ATENIA para gestión de procesos judiciales colombianos.

Se acaba de ejecutar una Sincronización Maestra de diagnóstico. Analiza los resultados y responde en español colombiano, de forma clara y accionable.

RESULTADOS DE LA SINCRONIZACIÓN MAESTRA:
- Total de asuntos procesados: ${results.length}
- Exitosos: ${succeeded.length} (${results.length > 0 ? Math.round((succeeded.length / results.length) * 100) : 0}%)
- Fallidos: ${failed.length}
  - Por timeout: ${timeouts.length}
  - Por radicado no encontrado (404): ${provider404s.length}
  - Por error desconocido: ${unknowns.length}
- Nuevas actuaciones insertadas: ${results.reduce((s, r) => s + r.act_inserted, 0)}
- Nuevos estados insertados: ${results.reduce((s, r) => s + r.pub_inserted, 0)}
- Actuaciones duplicadas (dedup): ${results.reduce((s, r) => s + r.act_skipped, 0)}

RENDIMIENTO DE PROVEEDORES:
- CPNU (Rama Judicial): ${cpnuItems.length} consultas, latencia promedio ${avgLat(cpnuItems)}ms, ${cpnuItems.filter((r) => r.act_status === "error").length} errores
- SAMAI (Consejo de Estado): ${samaiItems.length} consultas, latencia promedio ${avgLat(samaiItems)}ms, ${samaiItems.filter((r) => r.act_status === "error").length} errores

RADICADOS QUE FALLARON:
${failed.map((r) => `- ${r.radicado} (${r.workflow_type}): ${r.act_error_code || "UNKNOWN"} — ${r.act_error_message || "sin detalle"} [${r.act_latency_ms || "?"}ms]`).join("\n") || "(ninguno)"}

DISTRIBUCIÓN POR FLUJO:
${["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"]
  .map((wf) => {
    const items = results.filter((r) => r.workflow_type === wf);
    return items.length > 0
      ? `- ${wf}: ${items.length} total, ${items.filter((r) => r.act_ok).length} OK, ${items.filter((r) => r.act_status === "error").length} error`
      : null;
  })
  .filter(Boolean)
  .join("\n")}

Responde con:
1. DIAGNÓSTICO: ¿Qué está pasando? Identifica patrones.
2. IMPACTO: ¿Qué asuntos están en riesgo de tener información desactualizada?
3. ACCIONES RECOMENDADAS: ¿Qué debe hacer el administrador? Sé específico.
4. SALUD DEL SISTEMA: Califica como 🟢 Saludable, 🟡 Degradado, o 🔴 Crítico.
5. PRÓXIMOS PASOS: ¿Qué debería revisar el equipo técnico?`;
}

export function buildClaudeReport(
  results: ItemSyncResult[],
  config: MasterSyncConfig,
  traces?: any[],
): string {
  const timestamp = new Date().toISOString();
  const succeeded = results.filter((r) => r.act_ok === true);
  const failed = results.filter((r) => r.act_status === "error");

  let report = `# ATENIA Master Sync Report
Generated: ${timestamp}
Scope: ${config.scope} | Force Refresh: ${config.forceRefresh} | Batch Size: ${config.batchSize}
Workflows: ${config.workflowFilter.join(", ")}
Organization: ${config.organizationId}

## AGGREGATE SUMMARY
- Total items: ${results.length}
- Succeeded: ${succeeded.length} (${results.length > 0 ? Math.round((succeeded.length / results.length) * 100) : 0}%)
- Failed: ${failed.length}
- Actuaciones inserted: ${results.reduce((s, r) => s + r.act_inserted, 0)}
- Actuaciones skipped (dedup): ${results.reduce((s, r) => s + r.act_skipped, 0)}
- Publicaciones inserted: ${results.reduce((s, r) => s + r.pub_inserted, 0)}
- Publicaciones skipped (dedup): ${results.reduce((s, r) => s + r.pub_skipped, 0)}

## ERROR BREAKDOWN
`;

  const errorGroups: Record<string, ItemSyncResult[]> = {};
  failed.forEach((r) => {
    const code = r.act_error_code || "UNKNOWN";
    if (!errorGroups[code]) errorGroups[code] = [];
    errorGroups[code].push(r);
  });

  Object.entries(errorGroups).forEach(([code, items]) => {
    report += `\n### ${code} (${items.length} items)\n`;
    items.forEach((r) => {
      report += `- ${r.radicado} (${r.workflow_type}) | ${r.act_latency_ms}ms | provider: ${r.act_provider || "none"}\n`;
      if (r.act_error_message) report += `  message: ${r.act_error_message}\n`;
    });
  });

  report += `\n## PROVIDER PERFORMANCE\n`;

  const addProviderStats = (name: string, providerResults: ItemSyncResult[]) => {
    if (providerResults.length === 0) return;
    const latencies = providerResults
      .filter((r) => r.act_latency_ms)
      .map((r) => r.act_latency_ms!)
      .sort((a, b) => a - b);
    report += `\n### ${name}
- Calls: ${providerResults.length}
- Success: ${providerResults.filter((r) => r.act_ok).length}
- Errors: ${providerResults.filter((r) => r.act_status === "error").length}
- Latency p50: ${latencies[Math.floor(latencies.length * 0.5)] || "N/A"}ms
- Latency p90: ${latencies[Math.floor(latencies.length * 0.9)] || "N/A"}ms
- Latency max: ${latencies[latencies.length - 1] || "N/A"}ms
`;
  };

  addProviderStats("CPNU (Rama Judicial)", results.filter((r) => r.act_provider === "cpnu"));
  addProviderStats("SAMAI (Consejo de Estado)", results.filter((r) => r.act_provider === "samai"));

  // Partial failures
  const partial = results.filter((r) => r.act_ok === true && r.pub_status === "error");
  if (partial.length > 0) {
    report += `\n## PARTIAL FAILURES (actuaciones OK, publicaciones failed)\n`;
    partial.forEach((r) => {
      report += `- ${r.radicado} (${r.workflow_type}): pub error — ${r.pub_error_message}\n`;
    });
  }

  report += `\n## FULL ITEM RESULTS (JSON)\n`;
  report += "```json\n";
  report += JSON.stringify(results, null, 2);
  report += "\n```\n";

  if (traces && traces.length > 0) {
    report += `\n## SYNC TRACES (auto-loaded, last hour, ${traces.length} entries)\n`;
    report += "```json\n";
    report += JSON.stringify(traces, null, 2);
    report += "\n```\n";
  } else {
    report += `\n## SYNC TRACES (query manually)\n`;
    report += "```sql\n";
    report += `SELECT work_item_id, step, provider, http_status, latency_ms, error_code, message, meta, created_at
FROM sync_traces
WHERE created_at >= now() - interval '1 hour'
  AND organization_id = '${config.organizationId}'
ORDER BY created_at DESC
LIMIT 200;\n`;
    report += "```\n";
  }

  return report;
}

export function buildErrorOnlyReport(results: ItemSyncResult[], config: MasterSyncConfig): string {
  const failed = results.filter((r) => r.act_status === "error");
  const partial = results.filter((r) => r.act_ok === true && r.pub_status === "error");

  let report = `# ATENIA Sync Errors — ${new Date().toISOString()}
Org: ${config.organizationId} | Total: ${results.length} | Failed: ${failed.length} | Partial: ${partial.length}

## FAILED ITEMS
`;

  failed.forEach((r) => {
    report += `\n### ${r.radicado} (${r.workflow_type})
- Error: ${r.act_error_code || "UNKNOWN"} — ${r.act_error_message || "no message"}
- Provider: ${r.act_provider || "none"} | Latency: ${r.act_latency_ms || "?"}ms
- Provider attempts: ${JSON.stringify(r.act_provider_attempts)}
- Raw response: ${JSON.stringify(r.act_raw_response)}
`;
  });

  if (partial.length > 0) {
    report += `\n## PARTIAL FAILURES (actuaciones OK, publicaciones failed)\n`;
    partial.forEach((r) => {
      report += `- ${r.radicado} (${r.workflow_type}): pub error — ${r.pub_error_message}\n`;
    });
  }

  return report;
}
