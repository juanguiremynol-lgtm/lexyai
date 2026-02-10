/**
 * Atenia AI Technical Report Builder
 * 
 * Generates a copyable technical report for diagnostics,
 * including sync traces, provider health, Gemini analysis, etc.
 */

import type { AutoDiagnosis } from './atenia-ai-autonomous';

/**
 * Build a full technical report string suitable for clipboard copy.
 */
export function buildAteniaAiTechnicalReport(
  diagnosticContext: AutoDiagnosis,
  geminiAnalysis?: string | null,
  userDescription?: string,
  actionTaken?: string | null,
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════');
  lines.push('  ATENIA AI — DIAGNÓSTICO TÉCNICO');
  lines.push('═══════════════════════════════════════════');
  lines.push('');

  // Section 1: Identification
  lines.push('▶ IDENTIFICACIÓN');
  lines.push(`  Radicado:      ${diagnosticContext.radicado || 'N/A'}`);
  lines.push(`  Work Item ID:  ${diagnosticContext.work_item_id}`);
  lines.push(`  Tipo:          ${diagnosticContext.workflow_type}`);
  lines.push(`  Generado:      ${now}`);
  lines.push('');

  // Section 2: Sync Status
  lines.push('▶ ESTADO DE SINCRONIZACIÓN');
  lines.push(`  Última sync:   ${diagnosticContext.last_synced_at || 'NUNCA'}`);
  if (diagnosticContext.last_synced_at) {
    const hoursSince = (Date.now() - new Date(diagnosticContext.last_synced_at).getTime()) / 3600000;
    lines.push(`  Hace:           ${hoursSince > 48 ? `${Math.round(hoursSince / 24)} días` : `${Math.round(hoursSince)} horas`}`);
  }
  lines.push(`  Actuaciones:   ${diagnosticContext.actuaciones_count}`);
  lines.push(`  Estados:       ${diagnosticContext.publicaciones_count}`);
  lines.push('');

  // Section 3: Recent Traces
  lines.push('▶ TRAZAS RECIENTES');
  if (diagnosticContext.sync_traces_recent.length === 0) {
    lines.push('  Sin trazas recientes.');
  } else {
    for (const t of diagnosticContext.sync_traces_recent.slice(0, 8)) {
      const status = t.success ? '✅' : '❌';
      const latency = t.latency_ms ? `${t.latency_ms}ms` : '—';
      const error = t.error_code ? ` [${t.error_code}]` : '';
      lines.push(`  ${status} ${t.provider} | ${latency} | ${t.created_at}${error}`);
    }
  }
  lines.push('');

  // Section 4: Provider Health
  lines.push('▶ SALUD DE PROVEEDORES');
  if (diagnosticContext.provider_health.length === 0) {
    lines.push('  Sin datos de proveedores.');
  } else {
    for (const p of diagnosticContext.provider_health) {
      const status = p.isOpen ? '🔴 DEGRADADO' : '🟢 OK';
      lines.push(`  ${p.provider}: ${status} | err=${Math.round(p.errorRate * 100)}% | lat=${p.avgLatencyMs}ms | n=${p.sampleSize}`);
    }
  }
  lines.push('');

  // Section 5: Auto-diagnosis
  lines.push('▶ DIAGNÓSTICO AUTOMÁTICO');
  for (const line of diagnosticContext.diagnosis_summary.split('\n')) {
    lines.push(`  ${line}`);
  }
  lines.push('');

  // Section 6: Gemini Analysis (if available)
  if (geminiAnalysis) {
    lines.push('▶ ANÁLISIS GEMINI');
    for (const line of geminiAnalysis.split('\n')) {
      lines.push(`  ${line}`);
    }
    lines.push('');
  }

  // Section 7: User Report
  if (userDescription) {
    lines.push('▶ DESCRIPCIÓN DEL USUARIO');
    lines.push(`  ${userDescription}`);
    lines.push('');
  }

  // Section 8: Action taken
  if (actionTaken) {
    lines.push('▶ ACCIÓN EJECUTADA');
    lines.push(`  ${actionTaken}`);
    lines.push('');
  }

  // Section 9: Recommendations
  lines.push('▶ RECOMENDACIÓN PARA EQUIPO TÉCNICO');
  const degraded = diagnosticContext.provider_health.filter(p => p.isOpen);
  if (degraded.length > 0) {
    lines.push(`  • Verificar conectividad con: ${degraded.map(p => p.provider).join(', ')}`);
  }
  const errors = diagnosticContext.sync_traces_recent.filter(t => !t.success);
  if (errors.length > 0) {
    const codes = [...new Set(errors.map(t => t.error_code || 'UNKNOWN'))];
    lines.push(`  • Revisar errores: ${codes.join(', ')}`);
  }
  if (!diagnosticContext.last_synced_at) {
    lines.push('  • El asunto nunca ha sido sincronizado. Verificar radicado.');
  }
  if (degraded.length === 0 && errors.length === 0 && diagnosticContext.last_synced_at) {
    lines.push('  • No se detectaron problemas técnicos evidentes.');
  }
  lines.push('');
  lines.push('═══════════════════════════════════════════');

  return lines.join('\n');
}
