/**
 * Atenia AI Engine — Core intelligence module
 * 
 * Three tiers of autonomy:
 * - OBSERVE: Collect data, detect patterns, compute metrics
 * - SUGGEST: Present recommendations to admin/user with explanation
 * - ACT: Limited set of safe, reversible autonomous actions (with logging)
 */

import { supabase } from '@/integrations/supabase/client';

// ============= CONFIG =============

export interface AteniaConfig {
  auto_demonitor_after_404s: number;
  stage_inference_mode: 'off' | 'suggest' | 'auto_with_confirm';
  alert_ai_enrichment: boolean;
  gemini_enabled: boolean;
  email_alerts_enabled: boolean;
  email_alert_min_severity: string;
  provider_slow_threshold_ms: number;
  provider_error_rate_threshold: number;
  autonomy_paused: boolean;
  max_auto_syncs_per_heartbeat: number;
  heartbeat_interval_minutes: number;
}

const DEFAULT_CONFIG: AteniaConfig = {
  auto_demonitor_after_404s: 5,
  stage_inference_mode: 'suggest',
  alert_ai_enrichment: true,
  gemini_enabled: true,
  email_alerts_enabled: false,
  email_alert_min_severity: 'CRITICAL',
  provider_slow_threshold_ms: 5000,
  provider_error_rate_threshold: 0.30,
  autonomy_paused: false,
  max_auto_syncs_per_heartbeat: 3,
  heartbeat_interval_minutes: 30,
};

export async function loadConfig(organizationId: string): Promise<AteniaConfig> {
  const { data } = await (supabase
    .from('atenia_ai_config') as any)
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (!data) return DEFAULT_CONFIG;

  return {
    auto_demonitor_after_404s: data.auto_demonitor_after_404s ?? DEFAULT_CONFIG.auto_demonitor_after_404s,
    stage_inference_mode: data.stage_inference_mode ?? DEFAULT_CONFIG.stage_inference_mode,
    alert_ai_enrichment: data.alert_ai_enrichment ?? DEFAULT_CONFIG.alert_ai_enrichment,
    gemini_enabled: data.gemini_enabled ?? DEFAULT_CONFIG.gemini_enabled,
    email_alerts_enabled: data.email_alerts_enabled ?? DEFAULT_CONFIG.email_alerts_enabled,
    email_alert_min_severity: data.email_alert_min_severity ?? DEFAULT_CONFIG.email_alert_min_severity,
    provider_slow_threshold_ms: data.provider_slow_threshold_ms ?? DEFAULT_CONFIG.provider_slow_threshold_ms,
    provider_error_rate_threshold: data.provider_error_rate_threshold ?? DEFAULT_CONFIG.provider_error_rate_threshold,
    autonomy_paused: data.autonomy_paused ?? DEFAULT_CONFIG.autonomy_paused,
    max_auto_syncs_per_heartbeat: data.max_auto_syncs_per_heartbeat ?? DEFAULT_CONFIG.max_auto_syncs_per_heartbeat,
    heartbeat_interval_minutes: data.heartbeat_interval_minutes ?? DEFAULT_CONFIG.heartbeat_interval_minutes,
  };
}

export async function saveConfig(organizationId: string, config: Partial<AteniaConfig>): Promise<void> {
  const { error } = await (supabase
    .from('atenia_ai_config') as any)
    .upsert({
      organization_id: organizationId,
      ...config,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' });

  if (error) {
    console.error('[atenia-ai] Failed to save config:', error.message);
    throw error;
  }
}

// ============= TIER: ACT — Auto-Demonitor Unreachable Items =============

export interface DemonitorResult {
  demonitored: number;
  items: Array<{ id: string; radicado: string; count: number }>;
}

export async function processUnreachableItems(organizationId: string): Promise<DemonitorResult> {
  const config = await loadConfig(organizationId);

  const { data: unreachableItems } = await (supabase
    .from('work_items') as any)
    .select('id, radicado, workflow_type, consecutive_404_count, authority_name')
    .eq('organization_id', organizationId)
    .eq('monitoring_enabled', true)
    .gte('consecutive_404_count', config.auto_demonitor_after_404s);

  if (!unreachableItems || unreachableItems.length === 0) {
    return { demonitored: 0, items: [] };
  }

  const demonitoredItems: DemonitorResult['items'] = [];

  for (const item of unreachableItems) {
    const { error } = await (supabase
      .from('work_items') as any)
      .update({
        monitoring_enabled: false,
        demonitor_reason: `Atenia AI: Radicado no encontrado en ${item.consecutive_404_count} consultas consecutivas a proveedores externos. Monitoreo suspendido automáticamente.`,
        demonitor_at: new Date().toISOString(),
      })
      .eq('id', item.id);

    if (!error) {
      demonitoredItems.push({
        id: item.id,
        radicado: item.radicado,
        count: item.consecutive_404_count,
      });

      await logAction({
        organization_id: organizationId,
        action_type: 'auto_demonitor',
        autonomy_tier: 'ACT',
        target_entity_type: 'work_item',
        target_entity_id: item.id,
        reasoning: `El radicado ${item.radicado} (${item.workflow_type}) no fue encontrado en ningún proveedor externo durante ${item.consecutive_404_count} sincronizaciones consecutivas. Se suspendió el monitoreo automáticamente para no desperdiciar recursos de sincronización.`,
        evidence: {
          radicado: item.radicado,
          workflow_type: item.workflow_type,
          consecutive_404_count: item.consecutive_404_count,
          threshold: config.auto_demonitor_after_404s,
          authority_name: item.authority_name,
        },
        action_taken: 'SET monitoring_enabled = false',
        action_result: 'applied',
      });
    }
  }

  return { demonitored: demonitoredItems.length, items: demonitoredItems };
}

// ============= TIER: ACT — User Monitoring Control =============

export async function suspendMonitoring(workItemId: string, organizationId: string, reason?: string): Promise<void> {
  await (supabase.from('work_items') as any)
    .update({
      monitoring_enabled: false,
      demonitor_reason: reason || 'Suspendido manualmente por el usuario',
      demonitor_at: new Date().toISOString(),
    })
    .eq('id', workItemId);

  await logAction({
    organization_id: organizationId,
    action_type: 'user_demonitor',
    autonomy_tier: 'ACT',
    target_entity_type: 'work_item',
    target_entity_id: workItemId,
    reasoning: reason || 'El usuario decidió suspender manualmente el monitoreo de este asunto.',
    action_taken: 'SET monitoring_enabled = false',
    action_result: 'applied',
  });
}

export async function reactivateMonitoring(workItemId: string, organizationId: string): Promise<void> {
  await (supabase.from('work_items') as any)
    .update({
      monitoring_enabled: true,
      demonitor_reason: null,
      demonitor_at: null,
      consecutive_404_count: 0,
      provider_reachable: true,
    })
    .eq('id', workItemId);

  await logAction({
    organization_id: organizationId,
    action_type: 'user_remonitor',
    autonomy_tier: 'ACT',
    target_entity_type: 'work_item',
    target_entity_id: workItemId,
    reasoning: 'El usuario reactivó manualmente el monitoreo de este asunto.',
    action_taken: 'SET monitoring_enabled = true, consecutive_404_count = 0',
    action_result: 'applied',
  });
}

// ============= TIER: OBSERVE — Platform Health =============

export async function buildPlatformHealthPrompt(organizationId: string): Promise<string> {
  // Import dynamically to avoid circular deps
  const { buildExternalProviderContext, EXTERNAL_PROVIDER_GEMINI_SYSTEM_PROMPT } = await import('./atenia-ai-external-providers');

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: recentTraces },
    { data: workItems },
    { data: pendingSuggestions },
    { data: recentAlerts },
    { data: recentActions },
    { data: ledger },
  ] = await Promise.all([
    (supabase.from('sync_traces') as any)
      .select('provider, success, error_code, latency_ms, created_at')
      .eq('organization_id', organizationId)
      .gte('created_at', twentyFourHoursAgo)
      .order('created_at', { ascending: false })
      .limit(500),
    (supabase.from('work_items') as any)
      .select('id, workflow_type, stage, monitoring_enabled, last_synced_at, consecutive_404_count, provider_reachable, scrape_status')
      .eq('organization_id', organizationId),
    (supabase.from('work_item_stage_suggestions') as any)
      .select('id, work_item_id, suggested_stage, confidence, status, created_at')
      .eq('organization_id', organizationId)
      .eq('status', 'PENDING'),
    supabase.from('alert_instances')
      .select('id, severity, title, status, fired_at')
      .eq('organization_id', organizationId)
      .gte('fired_at', sevenDaysAgo)
      .order('fired_at', { ascending: false })
      .limit(50),
    (supabase.from('atenia_ai_actions') as any)
      .select('action_type, autonomy_tier, reasoning, action_result, created_at')
      .eq('organization_id', organizationId)
      .gte('created_at', twentyFourHoursAgo)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('auto_sync_daily_ledger')
      .select('*')
      .eq('organization_id', organizationId)
      .order('run_date', { ascending: false })
      .limit(7),
  ]);

  const totalItems = workItems?.length || 0;
  const monitored = workItems?.filter((w: any) => w.monitoring_enabled).length || 0;
  const unreachable = workItems?.filter((w: any) => !w.provider_reachable).length || 0;
  const neverSynced = workItems?.filter((w: any) => !w.last_synced_at).length || 0;
  const staleItems = workItems?.filter((w: any) => {
    if (!w.last_synced_at) return false;
    return new Date(w.last_synced_at) < new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  }).length || 0;

  const traceSuccess = recentTraces?.filter((t: any) => t.success).length || 0;
  const traceTotal = recentTraces?.length || 1;

  const errorsByCode: Record<string, number> = {};
  recentTraces?.filter((t: any) => !t.success).forEach((t: any) => {
    const code = t.error_code || 'UNKNOWN';
    errorsByCode[code] = (errorsByCode[code] || 0) + 1;
  });

  return `Eres Atenia AI, el sistema de supervisión inteligente de la plataforma ATENIA para gestión de procesos judiciales colombianos.

Realiza una auditoría completa del estado de la plataforma y responde en español colombiano.

=== DATOS DE LA PLATAFORMA (últimas 24 horas) ===

ASUNTOS (work_items):
- Total: ${totalItems}
- Con monitoreo activo: ${monitored}
- Inalcanzables (proveedor no responde): ${unreachable}
- Nunca sincronizados: ${neverSynced}
- Datos desactualizados (>3 días): ${staleItems}

SINCRONIZACIÓN (últimas 24h):
- Total de consultas a proveedores: ${traceTotal}
- Exitosas: ${traceSuccess} (${Math.round(traceSuccess / traceTotal * 100)}%)
- Errores por tipo: ${JSON.stringify(errorsByCode)}

HISTORIAL DE SYNC DIARIO (últimos 7 días):
${ledger?.map((l: any) => `- ${l.run_date}: ${l.status} — ${l.items_succeeded}/${l.items_targeted} items`).join('\n') || 'Sin datos'}

ALERTAS (última semana):
- Total: ${recentAlerts?.length || 0}
- Críticas: ${recentAlerts?.filter((a: any) => a.severity === 'CRITICAL').length || 0}
- Pendientes: ${recentAlerts?.filter((a: any) => a.status === 'PENDING').length || 0}

SUGERENCIAS DE ETAPA PENDIENTES: ${pendingSuggestions?.length || 0}

ACCIONES AUTÓNOMAS DE ATENIA AI (últimas 24h):
${recentActions?.map((a: any) => `- [${a.autonomy_tier}] ${a.action_type}: ${a.reasoning?.substring(0, 100)}`).join('\n') || 'Ninguna'}

=== INSTRUCCIONES ===

Genera un reporte de salud completo con estas secciones:

1. 🏥 ESTADO GENERAL: Califica como 🟢 Saludable, 🟡 Degradado, o 🔴 Crítico. Justifica.
2. 📊 SINCRONIZACIÓN: ¿Está funcionando bien? ¿Hay proveedores lentos o caídos?
3. ⚖️ PROCESOS JUDICIALES: ¿Hay asuntos en riesgo de tener información desactualizada?
4. 🤖 INTELIGENCIA ATENIA: ¿Las acciones autónomas son correctas?
5. 🔧 ACCIONES RECOMENDADAS: Lista priorizada de lo que el administrador debería hacer HOY.
6. 📈 TENDENCIA: Comparando los últimos 7 días de sync, ¿la plataforma está mejorando o degradándose?
7. 🧑‍💻 PARA EL EQUIPO TÉCNICO: Si hay problemas que requieren intervención de código.
8. 🔌 PROVEEDORES EXTERNOS: Evalúa conectores externos, rutas GLOBAL sin instancia PLATFORM, mappings en DRAFT, y tasas de error de snapshots.

${EXTERNAL_PROVIDER_GEMINI_SYSTEM_PROMPT}

== CONTEXTO DE PROVEEDORES EXTERNOS ==
${JSON.stringify(await buildExternalProviderContext(organizationId), null, 2)}`;
}

// ============= ACTIONS LOG =============

export interface AteniaAction {
  id: string;
  organization_id: string;
  action_type: string;
  autonomy_tier: 'OBSERVE' | 'SUGGEST' | 'ACT';
  target_entity_type: string | null;
  target_entity_id: string | null;
  reasoning: string;
  evidence: any;
  action_taken: string | null;
  action_result: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  expires_at: string | null;
}

export async function fetchActions(
  organizationId: string,
  options: { tier?: string; hoursBack?: number; limit?: number } = {}
): Promise<AteniaAction[]> {
  const { tier, hoursBack = 24, limit = 50 } = options;

  let query = (supabase.from('atenia_ai_actions') as any)
    .select('*')
    .eq('organization_id', organizationId)
    .gte('created_at', new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(limit);

  if (tier) {
    query = query.eq('autonomy_tier', tier);
  }

  const { data } = await query;
  return (data || []) as AteniaAction[];
}

export async function approveAction(actionId: string, userId: string): Promise<void> {
  await (supabase.from('atenia_ai_actions') as any)
    .update({
      action_result: 'applied',
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', actionId);
}

export async function rejectAction(actionId: string): Promise<void> {
  await (supabase.from('atenia_ai_actions') as any)
    .update({ action_result: 'rejected' })
    .eq('id', actionId);
}

// ============= STAGE OPTIONS =============

export interface StageOption {
  value: string;
  label: string;
  description: string;
}

export function getStageOptionsForWorkflow(workflowType: string): StageOption[] {
  const stages: Record<string, StageOption[]> = {
    CGP: [
      { value: 'ADMISION', label: 'Admisión', description: 'Auto admisorio de la demanda' },
      { value: 'NOTIFICACION', label: 'Notificación', description: 'Notificación al demandado' },
      { value: 'CONTESTACION', label: 'Contestación', description: 'Término para contestar la demanda' },
      { value: 'AUDIENCIA_INICIAL', label: 'Audiencia Inicial', description: 'Art. 372 CGP' },
      { value: 'PROBATORIA', label: 'Probatoria', description: 'Etapa de práctica de pruebas' },
      { value: 'ALEGATOS', label: 'Alegatos', description: 'Alegatos de conclusión' },
      { value: 'SENTENCIA', label: 'Sentencia', description: 'Fallo de primera o segunda instancia' },
      { value: 'RECURSO', label: 'Recurso', description: 'Apelación u otro recurso' },
      { value: 'EJECUTORIADO', label: 'Ejecutoriado', description: 'Sentencia en firme' },
      { value: 'ARCHIVADO', label: 'Archivado', description: 'Proceso terminado y archivado' },
    ],
    LABORAL: [
      { value: 'ADMISION', label: 'Admisión', description: 'Auto admisorio' },
      { value: 'NOTIFICACION', label: 'Notificación', description: 'Notificación al demandado' },
      { value: 'CONTESTACION', label: 'Contestación', description: 'Contestación de la demanda' },
      { value: 'CONCILIACION', label: 'Conciliación', description: 'Audiencia de conciliación' },
      { value: 'PRIMERA_INSTANCIA', label: 'Primera Instancia', description: 'Trámite de primera instancia' },
      { value: 'SENTENCIA', label: 'Sentencia', description: 'Fallo' },
      { value: 'RECURSO', label: 'Recurso', description: 'Recurso de apelación' },
      { value: 'EJECUTORIADO', label: 'Ejecutoriado', description: 'Sentencia en firme' },
      { value: 'ARCHIVADO', label: 'Archivado', description: 'Archivado' },
    ],
    CPACA: [
      { value: 'ADMISION', label: 'Admisión', description: 'Auto admisorio de la demanda' },
      { value: 'NOTIFICACION', label: 'Notificación', description: 'Notificación' },
      { value: 'CONTESTACION', label: 'Contestación', description: 'Contestación' },
      { value: 'AUDIENCIA_INICIAL', label: 'Audiencia Inicial', description: 'Audiencia inicial Art. 180 CPACA' },
      { value: 'PROBATORIA', label: 'Probatoria', description: 'Etapa probatoria' },
      { value: 'ALEGATOS', label: 'Alegatos', description: 'Alegatos de conclusión' },
      { value: 'SENTENCIA', label: 'Sentencia', description: 'Fallo' },
      { value: 'RECURSO', label: 'Recurso', description: 'Recurso' },
      { value: 'EJECUCION_CUMPLIMIENTO', label: 'Ejecución / Cumplimiento', description: 'Cumplimiento de sentencia' },
    ],
    TUTELA: [
      { value: 'REPARTO', label: 'Reparto', description: 'Asignación del proceso' },
      { value: 'ADMISION', label: 'Admisión', description: 'Auto admisorio de la tutela' },
      { value: 'TRASLADO', label: 'Traslado', description: 'Traslado a la entidad accionada' },
      { value: 'FALLO_PRIMERA', label: 'Fallo Primera Instancia', description: 'Sentencia de tutela' },
      { value: 'IMPUGNACION', label: 'Impugnación', description: 'Recurso de impugnación' },
      { value: 'FALLO_SEGUNDA', label: 'Fallo Segunda Instancia', description: 'Sentencia de segunda instancia' },
      { value: 'REVISION_CC', label: 'Revisión Corte Constitucional', description: 'Selección para revisión' },
      { value: 'CUMPLIMIENTO', label: 'Cumplimiento', description: 'Verificación de cumplimiento' },
      { value: 'ARCHIVADO', label: 'Archivado', description: 'Archivado' },
    ],
    PENAL_906: [
      { value: 'INDAGACION', label: 'Indagación', description: 'Fase de indagación preliminar' },
      { value: 'INVESTIGACION', label: 'Investigación', description: 'Investigación formal' },
      { value: 'ACUSACION', label: 'Acusación', description: 'Formulación de acusación' },
      { value: 'PREPARATORIA', label: 'Preparatoria', description: 'Audiencia preparatoria' },
      { value: 'JUICIO_ORAL', label: 'Juicio Oral', description: 'Audiencia de juicio oral' },
      { value: 'SENTENCIA', label: 'Sentencia', description: 'Fallo' },
      { value: 'RECURSO', label: 'Recurso', description: 'Recursos' },
      { value: 'ARCHIVADO', label: 'Archivado', description: 'Archivado' },
    ],
  };

  return stages[workflowType] || stages.CGP;
}

// ============= HELPERS =============

async function logAction(action: {
  organization_id: string;
  action_type: string;
  autonomy_tier: 'OBSERVE' | 'SUGGEST' | 'ACT';
  target_entity_type?: string;
  target_entity_id?: string;
  reasoning: string;
  evidence?: any;
  action_taken?: string;
  action_result?: string;
}): Promise<void> {
  try {
    await (supabase.from('atenia_ai_actions') as any).insert({
      ...action,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[atenia-ai] Failed to log action:', err);
  }
}

export async function callGeminiViaEdge(prompt: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('master-sync-analysis', {
    body: { prompt },
  });
  if (error) throw error;
  return data?.analysis || 'No se pudo generar el análisis.';
}
