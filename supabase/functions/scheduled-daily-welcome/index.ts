/**
 * scheduled-daily-welcome Edge Function
 * 
 * Generates personalized AI-powered daily welcome messages for each user
 * summarizing full portfolio: estados, actuaciones, alerts, sync health,
 * and org-wide activity for org admins.
 * 
 * Schedule: Daily at 07:00 America/Bogota (12:00 UTC)
 * Can also be triggered on user login via POST with user_id
 * 
 * Data sources:
 * - work_item_publicaciones (estados de hoy)
 * - work_item_acts (actuaciones de hoy)
 * - alert_instances (pending/active alerts)
 * - work_items (portfolio summary + sync freshness)
 * - organization_memberships (org admin detection)
 * - provider_sync_traces (last sync health per provider)
 * 
 * ONLY runs on business days (excludes weekends, holidays, suspensions)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { parseISO, isWeekend, startOfDay, endOfDay, isWithinInterval } from "npm:date-fns@3.6.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const AI_MODEL = 'google/gemini-3-flash-preview';

const MAX_USERS_PER_RUN = 50;
const DELAY_BETWEEN_USERS_MS = 1000;

// ============= Business Day Validation =============

interface JudicialSuspension {
  id: string;
  title?: string;
  start_date: string;
  end_date: string;
  scope: string;
  scope_value: string | null;
  active: boolean;
}

async function checkColombianHoliday(supabase: any, date: Date): Promise<{ isHoliday: boolean; name?: string }> {
  const dateStr = date.toISOString().split('T')[0];
  const { data } = await supabase
    .from('colombian_holidays')
    .select('name')
    .eq('holiday_date', dateStr)
    .maybeSingle();
  if (data) return { isHoliday: true, name: (data as { name: string }).name };
  return { isHoliday: false };
}

async function checkJudicialSuspension(supabase: any, date: Date): Promise<{ isSuspended: boolean; suspensionTitle?: string }> {
  const { data: suspensions } = await supabase
    .from('judicial_term_suspensions')
    .select('id, title, start_date, end_date, scope, scope_value, active')
    .eq('active', true);
  if (!suspensions || suspensions.length === 0) return { isSuspended: false };
  const checkDate = startOfDay(date);
  for (const suspension of suspensions as JudicialSuspension[]) {
    const suspStartDate = startOfDay(parseISO(suspension.start_date));
    const suspEndDate = endOfDay(parseISO(suspension.end_date));
    if (isWithinInterval(checkDate, { start: suspStartDate, end: suspEndDate })) {
      if (suspension.scope === 'GLOBAL_JUDICIAL') {
        return { isSuspended: true, suspensionTitle: suspension.title };
      }
    }
  }
  return { isSuspended: false };
}

async function isValidBusinessDay(supabase: any): Promise<{ isValid: boolean; reason?: string }> {
  const today = new Date();
  if (isWeekend(today)) {
    const dayName = today.getDay() === 0 ? 'domingo' : 'sábado';
    return { isValid: false, reason: `Hoy es ${dayName} - los mensajes de bienvenida solo se generan en días hábiles` };
  }
  const holiday = await checkColombianHoliday(supabase, today);
  if (holiday.isHoliday) return { isValid: false, reason: `Hoy es festivo (${holiday.name})` };
  const suspension = await checkJudicialSuspension(supabase, today);
  if (suspension.isSuspended) return { isValid: false, reason: `Términos suspendidos (${suspension.suspensionTitle})` };
  return { isValid: true };
}

// ============= Types =============

interface EstadoActivity {
  id: string;
  title: string | null;
  annotation: string | null;
  published_at: string | null;
  fecha_desfijacion: string | null;
  tipo_publicacion: string | null;
}

interface ActuacionActivity {
  id: string;
  description: string;
  act_date: string | null;
  act_type: string | null;
}

interface WorkItemActivity {
  id: string;
  radicado: string | null;
  title: string | null;
  workflow_type: string;
  client_name: string | null;
  new_estados: EstadoActivity[];
  new_actuaciones: ActuacionActivity[];
}

interface AlertSummary {
  total_pending: number;
  critical_count: number;
  high_count: number;
  recent_titles: string[];
}

interface PortfolioSummary {
  total_work_items: number;
  monitoring_enabled: number;
  stale_items: number; // not synced in 48h+
  workflow_breakdown: Record<string, number>;
}

interface SyncHealthSummary {
  last_daily_sync_status: string | null;
  last_daily_sync_at: string | null;
  provider_errors_24h: number;
}

interface UserActivitySummary {
  user_id: string;
  organization_id: string;
  full_name: string | null;
  email: string;
  is_org_admin: boolean;
  new_estados_count: number;
  new_actuaciones_count: number;
  work_items_with_activity: WorkItemActivity[];
  alerts: AlertSummary;
  portfolio: PortfolioSummary;
  sync_health: SyncHealthSummary;
  // Org-admin only: org-wide stats
  org_wide_estados_count: number;
  org_wide_actuaciones_count: number;
  org_wide_work_items_with_activity: number;
}

// ============= Data Gathering =============

async function gatherAlerts(supabase: any, userId: string, orgId: string, isAdmin: boolean): Promise<AlertSummary> {
  let query = supabase
    .from('alert_instances')
    .select('id, title, severity, status, created_at')
    .in('status', ['PENDING', 'ACTIVE', 'FIRED'])
    .is('dismissed_at', null)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (isAdmin) {
    query = query.eq('organization_id', orgId);
  } else {
    query = query.eq('owner_id', userId);
  }

  const { data: alerts } = await query;
  const items = (alerts || []) as Array<{ id: string; title: string; severity: string; status: string }>;
  
  // Exclude DAILY_WELCOME from the count
  const nonWelcome = items.filter(a => !a.title.includes('Resumen Diario'));

  return {
    total_pending: nonWelcome.length,
    critical_count: nonWelcome.filter(a => a.severity === 'CRITICAL').length,
    high_count: nonWelcome.filter(a => a.severity === 'HIGH').length,
    recent_titles: nonWelcome.slice(0, 5).map(a => a.title),
  };
}

async function gatherPortfolio(supabase: any, userId: string, orgId: string, isAdmin: boolean): Promise<PortfolioSummary> {
  const staleCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  let baseQuery = supabase
    .from('work_items')
    .select('id, workflow_type, monitoring_enabled, last_synced_at, is_archived');

  if (isAdmin) {
    baseQuery = baseQuery.eq('organization_id', orgId);
  } else {
    baseQuery = baseQuery.eq('owner_id', userId);
  }

  baseQuery = baseQuery.or('is_archived.is.null,is_archived.eq.false');

  const { data: items } = await baseQuery.limit(1000);
  const workItems = (items || []) as Array<{
    id: string; workflow_type: string;
    monitoring_enabled: boolean; last_synced_at: string | null;
  }>;

  const monitoringEnabled = workItems.filter(w => w.monitoring_enabled);
  const stale = monitoringEnabled.filter(w =>
    !w.last_synced_at || w.last_synced_at < staleCutoff
  );

  const breakdown: Record<string, number> = {};
  for (const wi of workItems) {
    breakdown[wi.workflow_type] = (breakdown[wi.workflow_type] || 0) + 1;
  }

  return {
    total_work_items: workItems.length,
    monitoring_enabled: monitoringEnabled.length,
    stale_items: stale.length,
    workflow_breakdown: breakdown,
  };
}

async function gatherSyncHealth(supabase: any, orgId: string): Promise<SyncHealthSummary> {
  // Last daily sync from ledger
  const { data: lastSync } = await supabase
    .from('auto_sync_daily_ledger')
    .select('status, finished_at')
    .eq('organization_id', orgId)
    .order('run_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Provider errors in last 24h
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: errorCount } = await supabase
    .from('provider_sync_traces')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte('created_at', yesterday)
    .in('stage', ['EXT_PROVIDER_RESPONSE'])
    .gte('http_status', 400);

  return {
    last_daily_sync_status: lastSync?.status || null,
    last_daily_sync_at: lastSync?.finished_at || null,
    provider_errors_24h: errorCount || 0,
  };
}

async function checkIsOrgAdmin(supabase: any, userId: string, orgId: string): Promise<boolean> {
  const { data } = await supabase
    .from('organization_memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .maybeSingle();
  return data?.role === 'OWNER' || data?.role === 'ADMIN';
}

// ============= AI Generation =============

function buildActivityDetail(workItems: WorkItemActivity[]): string {
  return workItems.slice(0, 10).map(wi => {
    const parts: string[] = [];
    parts.push(`- Proceso: ${wi.radicado || wi.title || 'Sin identificar'} (${wi.workflow_type})`);
    if (wi.client_name) parts.push(`  Cliente: ${wi.client_name}`);
    if (wi.new_estados.length > 0) {
      parts.push(`  Estados nuevos (${wi.new_estados.length}):`);
      wi.new_estados.slice(0, 3).forEach(e => {
        parts.push(`    • ${e.tipo_publicacion || 'Estado'}: ${e.title?.slice(0, 100) || e.annotation?.slice(0, 100) || 'Sin descripción'}`);
        if (e.fecha_desfijacion) parts.push(`      Desfijación: ${e.fecha_desfijacion}`);
      });
    }
    if (wi.new_actuaciones.length > 0) {
      parts.push(`  Actuaciones nuevas (${wi.new_actuaciones.length}):`);
      wi.new_actuaciones.slice(0, 3).forEach(a => {
        parts.push(`    • ${a.act_type || 'Actuación'}: ${a.description?.slice(0, 100) || 'Sin descripción'}`);
        if (a.act_date) parts.push(`      Fecha: ${a.act_date}`);
      });
    }
    return parts.join('\n');
  }).join('\n\n');
}

async function generateAIWelcomeMessage(
  summary: UserActivitySummary,
  lovableApiKey: string
): Promise<string> {
  const userName = summary.full_name || 'Usuario';
  const totalActivity = summary.new_estados_count + summary.new_actuaciones_count;

  const activityDetails = buildActivityDetail(summary.work_items_with_activity);

  // Build comprehensive context sections
  const sections: string[] = [];

  sections.push(`Información del usuario:
- Nombre: ${userName}
- Rol: ${summary.is_org_admin ? 'Administrador de organización' : 'Usuario'}
- Nuevos estados (propios): ${summary.new_estados_count}
- Nuevas actuaciones (propias): ${summary.new_actuaciones_count}
- Procesos con actividad: ${summary.work_items_with_activity.length}`);

  if (totalActivity > 0) {
    sections.push(`Detalle de actividad reciente:\n${activityDetails}`);
  }

  // Portfolio
  const p = summary.portfolio;
  sections.push(`Portafolio:
- Total procesos activos: ${p.total_work_items}
- Con monitoreo activo: ${p.monitoring_enabled}
- Procesos sin sincronizar (>48h): ${p.stale_items}
- Desglose: ${Object.entries(p.workflow_breakdown).map(([k, v]) => `${k}: ${v}`).join(', ') || 'N/A'}`);

  // Alerts
  const a = summary.alerts;
  if (a.total_pending > 0) {
    sections.push(`Alertas pendientes: ${a.total_pending}${a.critical_count > 0 ? ` (${a.critical_count} CRÍTICAS)` : ''}${a.high_count > 0 ? ` (${a.high_count} ALTAS)` : ''}
Títulos recientes:
${a.recent_titles.map(t => `  • ${t}`).join('\n')}`);
  } else {
    sections.push('Alertas pendientes: Ninguna');
  }

  // Sync health
  const sh = summary.sync_health;
  sections.push(`Salud de sincronización:
- Último sync diario: ${sh.last_daily_sync_status || 'Sin registro'} ${sh.last_daily_sync_at ? `(${sh.last_daily_sync_at})` : ''}
- Errores de proveedores (24h): ${sh.provider_errors_24h}`);

  // Org-admin: org-wide view
  if (summary.is_org_admin && (summary.org_wide_estados_count > 0 || summary.org_wide_actuaciones_count > 0)) {
    sections.push(`Actividad de la organización (como administrador):
- Total estados nuevos (org): ${summary.org_wide_estados_count}
- Total actuaciones nuevas (org): ${summary.org_wide_actuaciones_count}
- Procesos con actividad (org): ${summary.org_wide_work_items_with_activity}`);
  }

  const prompt = `Eres un asistente legal colombiano llamado Lexy. Genera un mensaje de bienvenida matutino completo para un abogado.

${sections.join('\n\n')}

Instrucciones:
1. Saluda cordialmente al usuario por su nombre
2. Resume el volumen de actividad (estados y actuaciones nuevas)
3. Si hay alertas críticas o altas, destácalas con urgencia
4. Menciona el estado del portafolio (procesos activos, monitoreo)
5. Si hay procesos sin sincronizar en 48h+, recomienda verificar
6. Si hay errores de proveedores, menciónalo brevemente
7. Si es administrador, incluye un párrafo con la visión de la organización
8. Si hay fechas de desfijación, menciona que los términos comienzan al día siguiente hábil
9. Destaca eventos urgentes (sentencias, audiencias, vencimientos)
10. Termina con una nota motivacional breve
11. Usa español colombiano formal pero amigable
12. Máximo 300 palabras
13. NO uses markdown, solo texto plano con saltos de línea`;

  try {
    const response = await fetch(LOVABLE_AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Eres Lexy, un asistente legal inteligente para abogados colombianos. Tu tono es profesional, eficiente y cordial. Proporcionas resúmenes completos que cubren actividad judicial, alertas, estado de sincronización y salud del portafolio.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 700,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[daily-welcome] AI API error:', response.status, errorText);
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const message = aiResponse.choices?.[0]?.message?.content;
    if (!message) throw new Error('Empty AI response');
    return message.trim();
  } catch (err) {
    console.error('[daily-welcome] AI generation failed:', err);
    // Fallback message with all data
    const lines = [
      `Buenos días, ${userName}.`,
      '',
      `En las últimas 24 horas: ${summary.new_estados_count} nuevos estados y ${summary.new_actuaciones_count} nuevas actuaciones.`,
    ];
    if (a.total_pending > 0) {
      lines.push(`Tienes ${a.total_pending} alertas pendientes${a.critical_count > 0 ? ` (${a.critical_count} críticas)` : ''}.`);
    }
    lines.push(`Portafolio: ${p.total_work_items} procesos activos, ${p.monitoring_enabled} monitoreados.`);
    if (p.stale_items > 0) {
      lines.push(`⚠️ ${p.stale_items} procesos sin sincronizar en más de 48 horas.`);
    }
    if (summary.is_org_admin) {
      lines.push(`\nOrganización: ${summary.org_wide_estados_count} estados y ${summary.org_wide_actuaciones_count} actuaciones en total.`);
    }
    lines.push('\n¡Que tengas un día productivo!');
    return lines.join('\n');
  }
}

// ============= Main Handler =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  if (req.method === 'POST') {
    try {
      const peek = await req.clone().json();
      if (peek?.health_check === true) {
        return new Response(JSON.stringify({ ok: true, status: 'healthy' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch { /* not JSON or no body */ }
  }

  const startTime = Date.now();
  const runId = crypto.randomUUID();
  console.log(`[scheduled-daily-welcome] Starting run (run_id: ${runId})`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Missing Supabase configuration');
    if (!lovableApiKey) throw new Error('Missing LOVABLE_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ============= Parse request =============
    let singleUserId: string | null = null;
    let skipBusinessDayCheck = false;

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        singleUserId = body.user_id || null;
        skipBusinessDayCheck = body._skip_business_day_check === true;
      } catch { /* batch mode */ }
    }

    // ============= Business Day Validation =============
    if (!skipBusinessDayCheck) {
      const businessDayCheck = await isValidBusinessDay(supabase);
      if (!businessDayCheck.isValid) {
        console.log(`[scheduled-daily-welcome] Skipping: ${businessDayCheck.reason}`);
        return new Response(
          JSON.stringify({ ok: true, run_id: runId, skipped: true, reason: businessDayCheck.reason, duration_ms: Date.now() - startTime }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayISO = yesterday.toISOString();

    console.log(`[scheduled-daily-welcome] Scanning activity since ${yesterdayISO}`);

    // ============= FETCH RECENT ACTIVITY =============
    let estadosQuery = supabase
      .from('work_item_publicaciones')
      .select(`
        id, work_item_id, title, annotation, published_at, fecha_desfijacion, tipo_publicacion, created_at,
        work_items!inner ( id, owner_id, organization_id, radicado, title, workflow_type, client:clients ( name ) )
      `)
      .gte('created_at', yesterdayISO)
      .order('created_at', { ascending: false })
      .limit(500);

    let actuacionesQuery = supabase
      .from('work_item_acts')
      .select(`
        id, work_item_id, description, act_date, act_type, created_at,
        work_items!inner ( id, owner_id, organization_id, radicado, title, workflow_type, client:clients ( name ) )
      `)
      .gte('created_at', yesterdayISO)
      .order('created_at', { ascending: false })
      .limit(500);

    if (singleUserId) {
      // For single user, fetch their org to include org-wide data if admin
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', singleUserId)
        .maybeSingle();

      if (userProfile?.organization_id) {
        // Fetch org-wide activity (admin will get both, regular user filtered later)
        estadosQuery = estadosQuery.eq('work_items.organization_id', userProfile.organization_id);
        actuacionesQuery = actuacionesQuery.eq('work_items.organization_id', userProfile.organization_id);
      } else {
        estadosQuery = estadosQuery.eq('work_items.owner_id', singleUserId);
        actuacionesQuery = actuacionesQuery.eq('work_items.owner_id', singleUserId);
      }
    }

    const [{ data: recentEstados, error: estadosError }, { data: recentActuaciones, error: actuacionesError }] = await Promise.all([
      estadosQuery,
      actuacionesQuery
    ]);

    if (estadosError) console.error('[scheduled-daily-welcome] Estados query error:', estadosError);
    if (actuacionesError) console.error('[scheduled-daily-welcome] Actuaciones query error:', actuacionesError);

    // ============= GROUP ACTIVITY BY USER + ORG =============
    // Track per-user AND per-org activity
    const userActivityMap = new Map<string, UserActivitySummary>();
    const orgActivityMap = new Map<string, { estados: number; actuaciones: number; workItemIds: Set<string> }>();

    function ensureUserSummary(userId: string, orgId: string): UserActivitySummary {
      if (!userActivityMap.has(userId)) {
        userActivityMap.set(userId, {
          user_id: userId,
          organization_id: orgId,
          full_name: null,
          email: '',
          is_org_admin: false,
          new_estados_count: 0,
          new_actuaciones_count: 0,
          work_items_with_activity: [],
          alerts: { total_pending: 0, critical_count: 0, high_count: 0, recent_titles: [] },
          portfolio: { total_work_items: 0, monitoring_enabled: 0, stale_items: 0, workflow_breakdown: {} },
          sync_health: { last_daily_sync_status: null, last_daily_sync_at: null, provider_errors_24h: 0 },
          org_wide_estados_count: 0,
          org_wide_actuaciones_count: 0,
          org_wide_work_items_with_activity: 0,
        });
      }
      return userActivityMap.get(userId)!;
    }

    function ensureOrgActivity(orgId: string) {
      if (!orgActivityMap.has(orgId)) {
        orgActivityMap.set(orgId, { estados: 0, actuaciones: 0, workItemIds: new Set() });
      }
      return orgActivityMap.get(orgId)!;
    }

    function ensureWorkItemActivity(summary: UserActivitySummary, workItem: any): WorkItemActivity {
      let wi = summary.work_items_with_activity.find(w => w.id === workItem.id);
      if (!wi) {
        wi = {
          id: workItem.id,
          radicado: workItem.radicado,
          title: workItem.title,
          workflow_type: workItem.workflow_type,
          client_name: workItem.client?.name || null,
          new_estados: [],
          new_actuaciones: [],
        };
        summary.work_items_with_activity.push(wi);
      }
      return wi;
    }

    // Process estados
    for (const estado of recentEstados || []) {
      const workItem = estado.work_items as any;
      if (!workItem?.owner_id || !workItem?.organization_id) continue;

      const userId = workItem.owner_id;
      const orgId = workItem.organization_id;
      const userSummary = ensureUserSummary(userId, orgId);
      userSummary.new_estados_count++;

      const wiActivity = ensureWorkItemActivity(userSummary, workItem);
      wiActivity.new_estados.push({
        id: estado.id,
        title: estado.title,
        annotation: estado.annotation,
        published_at: estado.published_at,
        fecha_desfijacion: estado.fecha_desfijacion,
        tipo_publicacion: estado.tipo_publicacion,
      });

      // Track org-wide
      const orgAct = ensureOrgActivity(orgId);
      orgAct.estados++;
      orgAct.workItemIds.add(workItem.id);
    }

    // Process actuaciones
    for (const actuacion of recentActuaciones || []) {
      const workItem = actuacion.work_items as any;
      if (!workItem?.owner_id || !workItem?.organization_id) continue;

      const userId = workItem.owner_id;
      const orgId = workItem.organization_id;
      const userSummary = ensureUserSummary(userId, orgId);
      userSummary.new_actuaciones_count++;

      const wiActivity = ensureWorkItemActivity(userSummary, workItem);
      wiActivity.new_actuaciones.push({
        id: actuacion.id,
        description: actuacion.description,
        act_date: actuacion.act_date,
        act_type: actuacion.act_type,
      });

      const orgAct = ensureOrgActivity(orgId);
      orgAct.actuaciones++;
      orgAct.workItemIds.add(workItem.id);
    }

    // ============= HANDLE SINGLE USER WITH NO ACTIVITY =============
    // If single-user trigger but no activity found, still generate a welcome
    if (singleUserId && !userActivityMap.has(singleUserId)) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, organization_id, full_name')
        .eq('id', singleUserId)
        .maybeSingle();

      if (profile?.organization_id) {
        ensureUserSummary(singleUserId, profile.organization_id);
      }
    }

    console.log(`[scheduled-daily-welcome] Found ${userActivityMap.size} users to process`);

    if (userActivityMap.size === 0) {
      return new Response(
        JSON.stringify({ ok: true, run_id: runId, message: 'No users to process', users_processed: 0, duration_ms: Date.now() - startTime }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= ENRICH USER DATA =============
    const userIds = Array.from(userActivityMap.keys()).slice(0, MAX_USERS_PER_RUN);

    // Parallel enrichment queries
    const [{ data: profiles }, { data: authUsers }] = await Promise.all([
      supabase.from('profiles').select('id, full_name').in('id', userIds),
      supabase.auth.admin.listUsers({ perPage: 100 }),
    ]);

    // Enrich each user with alerts, portfolio, sync health, admin status
    const enrichmentPromises = userIds.map(async (userId) => {
      const summary = userActivityMap.get(userId)!;
      const profile = profiles?.find(p => p.id === userId);
      const authUser = authUsers?.users?.find(u => u.id === userId);
      summary.full_name = profile?.full_name || null;
      summary.email = authUser?.email || '';

      // Check org admin status
      summary.is_org_admin = await checkIsOrgAdmin(supabase, userId, summary.organization_id);

      // Gather alerts, portfolio, sync health in parallel
      const [alerts, portfolio, syncHealth] = await Promise.all([
        gatherAlerts(supabase, userId, summary.organization_id, summary.is_org_admin),
        gatherPortfolio(supabase, userId, summary.organization_id, summary.is_org_admin),
        gatherSyncHealth(supabase, summary.organization_id),
      ]);

      summary.alerts = alerts;
      summary.portfolio = portfolio;
      summary.sync_health = syncHealth;

      // Org-wide stats for admins
      if (summary.is_org_admin) {
        const orgAct = orgActivityMap.get(summary.organization_id);
        if (orgAct) {
          summary.org_wide_estados_count = orgAct.estados;
          summary.org_wide_actuaciones_count = orgAct.actuaciones;
          summary.org_wide_work_items_with_activity = orgAct.workItemIds.size;
        }
      }
    });

    await Promise.all(enrichmentPromises);

    // ============= GENERATE AI MESSAGES =============
    let successCount = 0;
    let errorCount = 0;
    const results: Array<{ user_id: string; status: string; error?: string }> = [];

    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i];
      const summary = userActivityMap.get(userId);
      if (!summary) continue;

      if (i > 0) await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_USERS_MS));

      try {
        console.log(`[scheduled-daily-welcome] Generating for ${userId} (${i + 1}/${userIds.length})`);

        const welcomeMessage = await generateAIWelcomeMessage(summary, lovableApiKey);

        const { error: alertError } = await supabase.from('alert_instances').insert({
          owner_id: summary.user_id,
          organization_id: summary.organization_id,
          entity_id: summary.user_id,
          entity_type: 'USER',
          severity: 'INFO',
          title: '🌅 Resumen Diario de Actividad Judicial',
          message: welcomeMessage,
          status: 'PENDING',
          payload: {
            alert_type: 'DAILY_WELCOME',
            run_id: runId,
            generated_at: new Date().toISOString(),
            new_estados_count: summary.new_estados_count,
            new_actuaciones_count: summary.new_actuaciones_count,
            work_items_count: summary.work_items_with_activity.length,
            alerts_pending: summary.alerts.total_pending,
            alerts_critical: summary.alerts.critical_count,
            portfolio_total: summary.portfolio.total_work_items,
            portfolio_stale: summary.portfolio.stale_items,
            sync_status: summary.sync_health.last_daily_sync_status,
            is_org_admin: summary.is_org_admin,
            org_wide_estados: summary.org_wide_estados_count,
            org_wide_actuaciones: summary.org_wide_actuaciones_count,
            work_items: summary.work_items_with_activity.slice(0, 10).map(wi => ({
              id: wi.id,
              radicado: wi.radicado,
              workflow_type: wi.workflow_type,
              estados_count: wi.new_estados.length,
              actuaciones_count: wi.new_actuaciones.length,
            })),
            source: 'scheduled-daily-welcome',
          },
        });

        if (alertError) throw new Error(`DB error: ${alertError.message || alertError.code}`);

        successCount++;
        results.push({ user_id: userId, status: 'success' });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[scheduled-daily-welcome] Error for ${userId}:`, errorMsg);
        errorCount++;
        results.push({ user_id: userId, status: 'error', error: errorMsg });
      }

      if (Date.now() - startTime > 50000) {
        console.log('[scheduled-daily-welcome] Approaching timeout, stopping');
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[scheduled-daily-welcome] Completed in ${durationMs}ms: ${successCount} success, ${errorCount} errors`);

    // ============= LOG JOB RUN =============
    try {
      await supabase.from('job_runs').insert({
        job_name: 'scheduled-daily-welcome',
        status: errorCount === 0 ? 'OK' : (successCount > 0 ? 'PARTIAL' : 'ERROR'),
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        processed_count: results.length,
        metadata: {
          run_id: runId,
          users_processed: results.length,
          success_count: successCount,
          error_count: errorCount,
          total_estados_activity: (recentEstados || []).length,
          total_actuaciones_activity: (recentActuaciones || []).length,
          ai_model: AI_MODEL,
          single_user: singleUserId || null,
        },
      });
    } catch (logErr) {
      console.warn('[scheduled-daily-welcome] Failed to log job run:', logErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        run_id: runId,
        users_processed: results.length,
        success_count: successCount,
        error_count: errorCount,
        duration_ms: durationMs,
        results: results.slice(0, 20),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[scheduled-daily-welcome] Fatal error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Unknown error', run_id: runId, duration_ms: Date.now() - startTime }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
