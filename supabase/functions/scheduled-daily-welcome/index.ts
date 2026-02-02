/**
 * scheduled-daily-welcome Edge Function
 * 
 * Generates personalized AI-powered daily welcome messages for each user
 * summarizing new activity (estados/actuaciones) on their work items.
 * 
 * Schedule: Daily at 07:00 America/Bogota (12:00 UTC) - runs after publicaciones monitor
 * Can also be triggered on user login via POST with user_id
 * 
 * Features:
 * - Scans recent activity from past 24 hours per user
 * - Uses Lovable AI (via OpenRouter) to generate personalized summaries
 * - Creates DAILY_WELCOME alerts with AI-generated content
 * - Multi-tenant safe: processes per organization/user
 * - Rate limited to avoid AI API throttling
 * - ONLY runs on business days (excludes weekends, holidays, suspensions)
 * 
 * SAFEGUARDS (v2):
 * - Global kill switch: platform_settings.daily_welcome_enabled must be true
 * - Per-user once-per-day: atomic claim via try_claim_daily_welcome() function
 * - All events logged to daily_welcome_log for observability
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseISO, isWeekend, startOfDay, endOfDay, isWithinInterval } from 'https://esm.sh/date-fns@3.6.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Lovable AI Gateway configuration
const LOVABLE_AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const AI_MODEL = 'google/gemini-3-flash-preview';

// Rate limiting
const MAX_USERS_PER_RUN = 50;
const DELAY_BETWEEN_USERS_MS = 1000;

// ============= Observability Counters =============
interface ObservabilityMetrics {
  gemini_calls: number;
  suppressed_already_sent: number;
  suppressed_kill_switch: number;
  suppressed_non_business_day: number;
  generated_count: number;
  error_count: number;
}

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

/**
 * Check if a date is a Colombian holiday
 */
async function checkColombianHoliday(supabase: any, date: Date): Promise<{ isHoliday: boolean; name?: string }> {
  const dateStr = date.toISOString().split('T')[0];
  
  const { data } = await supabase
    .from('colombian_holidays')
    .select('name')
    .eq('holiday_date', dateStr)
    .maybeSingle();
  
  if (data) {
    return { isHoliday: true, name: (data as { name: string }).name };
  }
  return { isHoliday: false };
}

/**
 * Check if a date falls within any active judicial suspension
 */
async function checkJudicialSuspension(supabase: any, date: Date): Promise<{ isSuspended: boolean; suspensionTitle?: string }> {
  const { data: suspensions } = await supabase
    .from('judicial_term_suspensions')
    .select('id, title, start_date, end_date, scope, scope_value, active')
    .eq('active', true);
  
  if (!suspensions || suspensions.length === 0) {
    return { isSuspended: false };
  }
  
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

/**
 * Check if today is a valid business day for generating welcome messages
 */
async function isValidBusinessDay(supabase: any): Promise<{ isValid: boolean; reason?: string }> {
  const today = new Date();
  
  if (isWeekend(today)) {
    const dayName = today.getDay() === 0 ? 'domingo' : 'sábado';
    return { isValid: false, reason: `Hoy es ${dayName} - los mensajes de bienvenida solo se generan en días hábiles` };
  }
  
  const holiday = await checkColombianHoliday(supabase, today);
  if (holiday.isHoliday) {
    return { isValid: false, reason: `Hoy es festivo (${holiday.name}) - los mensajes de bienvenida solo se generan en días hábiles` };
  }
  
  const suspension = await checkJudicialSuspension(supabase, today);
  if (suspension.isSuspended) {
    return { isValid: false, reason: `Términos judiciales suspendidos (${suspension.suspensionTitle}) - los mensajes de bienvenida no se generan durante suspensiones` };
  }
  
  return { isValid: true };
}

// ============= Kill Switch & Per-User Gating =============

/**
 * Check global kill switch in platform_settings
 */
async function isWelcomeEnabled(supabase: any): Promise<boolean> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('daily_welcome_enabled')
    .eq('id', 'singleton')
    .maybeSingle();
  
  if (error) {
    console.error('[daily-welcome] Error checking kill switch:', error);
    // Default to OFF (safe) if we can't read settings
    return false;
  }
  
  return data?.daily_welcome_enabled === true;
}

/**
 * Atomically claim today's welcome slot for a user
 * Returns whether the claim was successful
 */
async function tryClaimDailyWelcome(supabase: any, userId: string): Promise<{
  claimed: boolean;
  reason: string;
  today: string;
}> {
  const { data, error } = await supabase.rpc('try_claim_daily_welcome', {
    p_user_id: userId,
  });
  
  if (error) {
    console.error('[daily-welcome] Error claiming welcome slot:', error);
    return { claimed: false, reason: 'RPC_ERROR', today: '' };
  }
  
  return {
    claimed: data?.claimed === true,
    reason: data?.reason || 'UNKNOWN',
    today: data?.today || '',
  };
}

/**
 * Log a welcome event for observability
 */
async function logWelcomeEvent(
  supabase: any,
  userId: string,
  organizationId: string | null,
  eventType: 'GENERATED' | 'SUPPRESSED_ALREADY_SENT' | 'SUPPRESSED_KILL_SWITCH' | 'SUPPRESSED_NON_BUSINESS_DAY',
  metadata: {
    aiModelUsed?: string;
    activityCount?: number;
    latencyMs?: number;
    reason?: string;
    runId?: string;
  }
): Promise<void> {
  // Get today in America/Bogota
  const todayBogota = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  
  try {
    await supabase.from('daily_welcome_log').insert({
      user_id: userId,
      organization_id: organizationId,
      event_type: eventType,
      event_date: todayBogota,
      ai_model_used: metadata.aiModelUsed || null,
      activity_count: metadata.activityCount || null,
      latency_ms: metadata.latencyMs || null,
      metadata: {
        reason: metadata.reason,
        run_id: metadata.runId,
      },
    });
  } catch (err) {
    console.warn('[daily-welcome] Failed to log event:', err);
  }
}

// ============= Types =============

interface UserActivitySummary {
  user_id: string;
  organization_id: string;
  full_name: string | null;
  email: string;
  new_estados_count: number;
  new_actuaciones_count: number;
  work_items_with_activity: WorkItemActivity[];
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

// ============= AI Generation =============

async function generateAIWelcomeMessage(
  summary: UserActivitySummary,
  lovableApiKey: string,
  metrics: ObservabilityMetrics
): Promise<string> {
  const userName = summary.full_name || 'Usuario';
  const totalActivity = summary.new_estados_count + summary.new_actuaciones_count;
  
  if (totalActivity === 0) {
    return `Buenos días, ${userName}. No hay nueva actividad en tus procesos judiciales en las últimas 24 horas.`;
  }

  const activityDetails = summary.work_items_with_activity
    .slice(0, 10)
    .map(wi => {
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
    })
    .join('\n\n');

  const prompt = `Eres un asistente legal colombiano llamado Lexy. Genera un mensaje de bienvenida matutino para un abogado resumiendo la actividad judicial de las últimas 24 horas.

Información del usuario:
- Nombre: ${userName}
- Nuevos estados: ${summary.new_estados_count}
- Nuevas actuaciones: ${summary.new_actuaciones_count}
- Procesos con actividad: ${summary.work_items_with_activity.length}

Detalle de actividad:
${activityDetails}

Instrucciones:
1. Saluda cordialmente al usuario por su nombre
2. Resume brevemente el volumen de actividad
3. Destaca los eventos más importantes o urgentes (sentencias, audiencias, vencimientos)
4. Si hay fechas de desfijación, menciona que los términos comienzan al día siguiente hábil
5. Termina con una nota motivacional breve
6. Usa español colombiano formal pero amigable
7. Máximo 200 palabras
8. NO uses markdown, solo texto plano con saltos de línea`;

  try {
    // Increment Gemini call counter BEFORE making the call
    metrics.gemini_calls++;
    
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
            content: 'Eres Lexy, un asistente legal inteligente para abogados colombianos. Tu tono es profesional, eficiente y cordial.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 500,
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
    
    if (!message) {
      throw new Error('Empty AI response');
    }

    return message.trim();
  } catch (err) {
    console.error('[daily-welcome] AI generation failed:', err);
    
    return `Buenos días, ${userName}.\n\nEn las últimas 24 horas se registraron ${summary.new_estados_count} nuevos estados y ${summary.new_actuaciones_count} nuevas actuaciones en tus procesos judiciales.\n\nTe recomendamos revisar los detalles en la sección de alertas.\n\n¡Que tengas un día productivo!`;
  }
}

// ============= Main Handler =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const runId = crypto.randomUUID();
  console.log(`[scheduled-daily-welcome] Starting run (run_id: ${runId})`);
  console.log(`[scheduled-daily-welcome] Time: ${new Date().toISOString()}`);

  // Initialize observability metrics
  const metrics: ObservabilityMetrics = {
    gemini_calls: 0,
    suppressed_already_sent: 0,
    suppressed_kill_switch: 0,
    suppressed_non_business_day: 0,
    generated_count: 0,
    error_count: 0,
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    if (!lovableApiKey) {
      throw new Error('Missing LOVABLE_API_KEY - please configure the secret');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ============= Check if single-user request (login trigger) =============
    let singleUserId: string | null = null;
    let skipBusinessDayCheck = false;
    
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        singleUserId = body.user_id || null;
        skipBusinessDayCheck = body._skip_business_day_check === true;
      } catch {
        // No body or invalid JSON, continue with batch mode
      }
    }

    // ============= SAFEGUARD #1: Global Kill Switch =============
    const welcomeEnabled = await isWelcomeEnabled(supabase);
    if (!welcomeEnabled) {
      console.log('[scheduled-daily-welcome] Kill switch is OFF - skipping all AI generation');
      metrics.suppressed_kill_switch++;
      
      // Log suppression if single user request
      if (singleUserId) {
        await logWelcomeEvent(supabase, singleUserId, null, 'SUPPRESSED_KILL_SWITCH', {
          reason: 'Global daily_welcome_enabled = false',
          runId,
        });
      }
      
      return new Response(
        JSON.stringify({
          ok: true,
          run_id: runId,
          skipped: true,
          suppression_reason: 'KILL_SWITCH_OFF',
          message: 'El mensaje de bienvenida diario está deshabilitado por el administrador.',
          metrics,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= Business Day Validation =============
    if (!skipBusinessDayCheck) {
      const businessDayCheck = await isValidBusinessDay(supabase);
      if (!businessDayCheck.isValid) {
        console.log(`[scheduled-daily-welcome] Skipping - not a business day: ${businessDayCheck.reason}`);
        metrics.suppressed_non_business_day++;
        
        if (singleUserId) {
          await logWelcomeEvent(supabase, singleUserId, null, 'SUPPRESSED_NON_BUSINESS_DAY', {
            reason: businessDayCheck.reason,
            runId,
          });
        }
        
        return new Response(
          JSON.stringify({
            ok: true,
            run_id: runId,
            skipped: true,
            suppression_reason: 'NON_BUSINESS_DAY',
            reason: businessDayCheck.reason,
            metrics,
            duration_ms: Date.now() - startTime,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ============= SAFEGUARD #2: Per-User Once-Per-Day (Single User Mode) =============
    if (singleUserId) {
      const claimResult = await tryClaimDailyWelcome(supabase, singleUserId);
      
      if (!claimResult.claimed) {
        console.log(`[scheduled-daily-welcome] User ${singleUserId} already received today's welcome (${claimResult.reason})`);
        metrics.suppressed_already_sent++;
        
        await logWelcomeEvent(supabase, singleUserId, null, 'SUPPRESSED_ALREADY_SENT', {
          reason: claimResult.reason,
          runId,
        });
        
        return new Response(
          JSON.stringify({
            ok: true,
            run_id: runId,
            skipped: true,
            suppression_reason: 'ALREADY_SENT_TODAY',
            message: 'Ya recibiste tu mensaje de bienvenida de hoy.',
            claim_result: claimResult,
            metrics,
            duration_ms: Date.now() - startTime,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log(`[scheduled-daily-welcome] Claimed welcome slot for user ${singleUserId}`);
    }

    // Calculate time window (last 24 hours)
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayISO = yesterday.toISOString();

    console.log(`[scheduled-daily-welcome] Scanning activity since ${yesterdayISO}`);

    // ============= GET USERS WITH RECENT ACTIVITY =============
    let estadosQuery = supabase
      .from('work_item_publicaciones')
      .select(`
        id,
        work_item_id,
        title,
        annotation,
        published_at,
        fecha_desfijacion,
        tipo_publicacion,
        created_at,
        work_items!inner (
          id,
          owner_id,
          organization_id,
          radicado,
          title,
          workflow_type,
          client:clients (
            name
          )
        )
      `)
      .gte('created_at', yesterdayISO)
      .order('created_at', { ascending: false })
      .limit(500);

    let actuacionesQuery = supabase
      .from('work_item_acts')
      .select(`
        id,
        work_item_id,
        description,
        act_date,
        act_type,
        created_at,
        work_items!inner (
          id,
          owner_id,
          organization_id,
          radicado,
          title,
          workflow_type,
          client:clients (
            name
          )
        )
      `)
      .gte('created_at', yesterdayISO)
      .order('created_at', { ascending: false })
      .limit(500);

    // Filter by single user if specified
    if (singleUserId) {
      estadosQuery = estadosQuery.eq('work_items.owner_id', singleUserId);
      actuacionesQuery = actuacionesQuery.eq('work_items.owner_id', singleUserId);
    }

    const [{ data: recentEstados, error: estadosError }, { data: recentActuaciones, error: actuacionesError }] = await Promise.all([
      estadosQuery,
      actuacionesQuery
    ]);

    if (estadosError) {
      console.error('[scheduled-daily-welcome] Estados query error:', estadosError);
    }

    if (actuacionesError) {
      console.error('[scheduled-daily-welcome] Actuaciones query error:', actuacionesError);
    }

    // Group activity by user
    const userActivityMap = new Map<string, UserActivitySummary>();

    // Process estados
    for (const estado of recentEstados || []) {
      const workItem = estado.work_items as any;
      if (!workItem?.owner_id || !workItem?.organization_id) continue;

      const userId = workItem.owner_id;
      
      if (!userActivityMap.has(userId)) {
        userActivityMap.set(userId, {
          user_id: userId,
          organization_id: workItem.organization_id,
          full_name: null,
          email: '',
          new_estados_count: 0,
          new_actuaciones_count: 0,
          work_items_with_activity: [],
        });
      }

      const userSummary = userActivityMap.get(userId)!;
      userSummary.new_estados_count++;

      let wiActivity = userSummary.work_items_with_activity.find(w => w.id === workItem.id);
      if (!wiActivity) {
        wiActivity = {
          id: workItem.id,
          radicado: workItem.radicado,
          title: workItem.title,
          workflow_type: workItem.workflow_type,
          client_name: workItem.client?.name || null,
          new_estados: [],
          new_actuaciones: [],
        };
        userSummary.work_items_with_activity.push(wiActivity);
      }

      wiActivity.new_estados.push({
        id: estado.id,
        title: estado.title,
        annotation: estado.annotation,
        published_at: estado.published_at,
        fecha_desfijacion: estado.fecha_desfijacion,
        tipo_publicacion: estado.tipo_publicacion,
      });
    }

    // Process actuaciones
    for (const actuacion of recentActuaciones || []) {
      const workItem = actuacion.work_items as any;
      if (!workItem?.owner_id || !workItem?.organization_id) continue;

      const userId = workItem.owner_id;
      
      if (!userActivityMap.has(userId)) {
        userActivityMap.set(userId, {
          user_id: userId,
          organization_id: workItem.organization_id,
          full_name: null,
          email: '',
          new_estados_count: 0,
          new_actuaciones_count: 0,
          work_items_with_activity: [],
        });
      }

      const userSummary = userActivityMap.get(userId)!;
      userSummary.new_actuaciones_count++;

      let wiActivity = userSummary.work_items_with_activity.find(w => w.id === workItem.id);
      if (!wiActivity) {
        wiActivity = {
          id: workItem.id,
          radicado: workItem.radicado,
          title: workItem.title,
          workflow_type: workItem.workflow_type,
          client_name: workItem.client?.name || null,
          new_estados: [],
          new_actuaciones: [],
        };
        userSummary.work_items_with_activity.push(wiActivity);
      }

      wiActivity.new_actuaciones.push({
        id: actuacion.id,
        description: actuacion.description,
        act_date: actuacion.act_date,
        act_type: actuacion.act_type,
      });
    }

    console.log(`[scheduled-daily-welcome] Found ${userActivityMap.size} users with activity`);

    if (userActivityMap.size === 0) {
      console.log('[scheduled-daily-welcome] No users with recent activity, skipping');
      return new Response(
        JSON.stringify({
          ok: true,
          run_id: runId,
          message: 'No users with recent activity',
          users_processed: 0,
          metrics,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= ENRICH USER DATA =============
    const userIds = Array.from(userActivityMap.keys()).slice(0, MAX_USERS_PER_RUN);
    
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);

    const { data: authUsers } = await supabase.auth.admin.listUsers({
      perPage: 100,
    });

    for (const userId of userIds) {
      const summary = userActivityMap.get(userId);
      if (!summary) continue;

      const profile = profiles?.find(p => p.id === userId);
      const authUser = authUsers?.users?.find(u => u.id === userId);

      summary.full_name = profile?.full_name || null;
      summary.email = authUser?.email || '';
    }

    // ============= GENERATE AI MESSAGES AND CREATE ALERTS =============
    let successCount = 0;
    let errorCount = 0;
    const results: Array<{ user_id: string; status: string; error?: string }> = [];

    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i];
      const summary = userActivityMap.get(userId);
      if (!summary) continue;

      // For batch mode, check per-user claim (single-user mode already checked above)
      if (!singleUserId) {
        const claimResult = await tryClaimDailyWelcome(supabase, userId);
        if (!claimResult.claimed) {
          console.log(`[scheduled-daily-welcome] User ${userId} already received today - skipping`);
          metrics.suppressed_already_sent++;
          await logWelcomeEvent(supabase, userId, summary.organization_id, 'SUPPRESSED_ALREADY_SENT', {
            reason: claimResult.reason,
            runId,
          });
          results.push({ user_id: userId, status: 'skipped_already_sent' });
          continue;
        }
      }

      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_USERS_MS));
      }

      try {
        console.log(`[scheduled-daily-welcome] Generating message for user ${userId} (${i + 1}/${userIds.length})`);
        
        const aiStartTime = Date.now();
        const welcomeMessage = await generateAIWelcomeMessage(summary, lovableApiKey, metrics);
        const aiLatencyMs = Date.now() - aiStartTime;
        
        console.log(`[scheduled-daily-welcome] Generated message for ${userId}: ${welcomeMessage.slice(0, 100)}...`);

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
            work_items: summary.work_items_with_activity.slice(0, 10).map(wi => ({
              id: wi.id,
              radicado: wi.radicado,
              workflow_type: wi.workflow_type,
              estados_count: wi.new_estados.length,
              actuaciones_count: wi.new_actuaciones.length,
            })),
            source: 'scheduled-daily-welcome',
            ai_model: AI_MODEL,
          },
        });

        if (alertError) {
          console.error(`[scheduled-daily-welcome] Alert insert error for ${userId}:`, JSON.stringify(alertError));
          throw new Error(`DB error: ${alertError.message || alertError.code || 'Unknown'}`);
        }

        // Log successful generation
        await logWelcomeEvent(supabase, userId, summary.organization_id, 'GENERATED', {
          aiModelUsed: AI_MODEL,
          activityCount: summary.new_estados_count + summary.new_actuaciones_count,
          latencyMs: aiLatencyMs,
          runId,
        });

        successCount++;
        metrics.generated_count++;
        results.push({ user_id: userId, status: 'success' });
        console.log(`[scheduled-daily-welcome] Created welcome alert for user ${userId}`);

      } catch (err) {
        const errorMsg = err instanceof Error 
          ? err.message 
          : (typeof err === 'object' && err !== null ? JSON.stringify(err) : 'Unknown error');
        console.error(`[scheduled-daily-welcome] Error for user ${userId}:`, errorMsg);
        errorCount++;
        metrics.error_count++;
        results.push({ 
          user_id: userId, 
          status: 'error', 
          error: errorMsg 
        });
      }

      if (Date.now() - startTime > 50000) {
        console.log('[scheduled-daily-welcome] Approaching timeout, stopping');
        break;
      }
    }

    const durationMs = Date.now() - startTime;

    console.log(`[scheduled-daily-welcome] Completed in ${durationMs}ms: ${successCount} success, ${errorCount} errors`);
    console.log(`[scheduled-daily-welcome] Metrics:`, JSON.stringify(metrics));

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
          metrics,
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
        metrics,
        duration_ms: durationMs,
        results: results.slice(0, 20),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[scheduled-daily-welcome] Fatal error:', err);
    metrics.error_count++;
    
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        run_id: runId,
        metrics,
        duration_ms: Date.now() - startTime,
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
