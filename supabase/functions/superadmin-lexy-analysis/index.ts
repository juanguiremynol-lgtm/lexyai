/**
 * Superadmin Lexy Analysis — On-demand deep AI analysis for platform admins
 * 
 * Gathers ALL available data for the user's work items:
 * - Today's actuaciones and estados
 * - Upcoming audiencias
 * - Term/deadline status and elapsed times
 * - Alert overview
 * - General work item health
 * 
 * Then sends it all to Gemini for a comprehensive Spanish analysis.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function todayCOT(): string {
  const now = new Date();
  const cot = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cot.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase config");
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    // Auth: get user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify the user from the JWT
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || supabaseKey);
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify platform admin
    const { data: adminRecord } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!adminRecord) {
      return new Response(JSON.stringify({ error: "Not a platform admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's organization
    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, full_name")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.organization_id) {
      return new Response(JSON.stringify({ error: "No organization found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgId = profile.organization_id;
    const userName = profile.full_name || "Admin";
    const today = todayCOT();
    const dayStartUTC = `${today}T05:00:00.000Z`;

    console.log(`[superadmin-lexy] Gathering data for ${userName} org=${orgId}`);

    // ─── Gather comprehensive data in parallel ───
    const [
      workItemsRes,
      recentActsRes,
      recentPubsRes,
      alertsRes,
      termsRes,
      deadlinesRes,
      milestonesRes,
    ] = await Promise.all([
      // All active work items
      supabase
        .from("work_items")
        .select("id, radicado, title, workflow_type, stage, authority_name, last_synced_at, monitoring_enabled, total_actuaciones, created_at, last_event_at")
        .eq("organization_id", orgId)
        .eq("status", "ACTIVE")
        .order("last_event_at", { ascending: false, nullsFirst: true })
        .limit(100),

      // Recent actuaciones (last 7 days)
      supabase
        .from("work_item_acts")
        .select("id, work_item_id, description, act_date, source, created_at, work_items!inner(radicado, title, authority_name)")
        .eq("organization_id", orgId)
        .eq("is_archived", false)
        .gte("act_date", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
        .order("act_date", { ascending: false })
        .limit(50),

      // Recent publicaciones (last 7 days)
      supabase
        .from("work_item_publicaciones")
        .select("id, work_item_id, title, tipo_publicacion, fecha_fijacion, fecha_desfijacion, work_items!inner(radicado, title)")
        .eq("organization_id", orgId)
        .eq("is_archived", false)
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order("fecha_fijacion", { ascending: false })
        .limit(30),

      // Unresolved alerts
      supabase
        .from("alert_instances")
        .select("id, severity, title, message, fired_at, alert_type, entity_id")
        .eq("organization_id", orgId)
        .in("status", ["PENDING", "SENT"])
        .order("fired_at", { ascending: false })
        .limit(20),

      // Active terms/deadlines (CGP term instances)
      (supabase.from("cgp_term_instances") as any)
        .select("id, term_name, due_date, status, start_date, work_item_id, work_items!inner(radicado, title)")
        .eq("owner_id", user.id)
        .in("status", ["RUNNING", "PAUSED", "NEAR_EXPIRY"])
        .order("due_date", { ascending: true })
        .limit(20),

      // Work item deadlines
      supabase
        .from("work_item_deadlines")
        .select("id, deadline_type, deadline_date, status, description, work_item_id, work_items!inner(radicado, title)")
        .eq("organization_id", orgId)
        .in("status", ["PENDING", "OVERDUE", "NEAR"])
        .order("deadline_date", { ascending: true })
        .limit(20),

      // Recent milestones
      (supabase.from("cgp_milestones") as any)
        .select("id, milestone_type, event_date, notes, occurred, work_item_id, work_items!inner(radicado, title)")
        .eq("owner_id", user.id)
        .eq("occurred", true)
        .gte("event_date", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
        .order("event_date", { ascending: false })
        .limit(20),
    ]);

    // Log errors for debugging
    if (workItemsRes.error) console.error("[superadmin-lexy] work_items error:", workItemsRes.error.message);
    if (recentActsRes.error) console.error("[superadmin-lexy] acts error:", recentActsRes.error.message);
    if (recentPubsRes.error) console.error("[superadmin-lexy] pubs error:", recentPubsRes.error.message);
    if (alertsRes.error) console.error("[superadmin-lexy] alerts error:", alertsRes.error.message);

    const workItems = workItemsRes.data || [];
    const recentActs = recentActsRes.data || [];
    const recentPubs = recentPubsRes.data || [];
    const alerts = alertsRes.data || [];
    const terms = termsRes.data || [];
    const deadlines = deadlinesRes.data || [];
    const milestones = milestonesRes.data || [];

    console.log(`[superadmin-lexy] Data: ${workItems.length} items, ${recentActs.length} acts, ${recentPubs.length} pubs, ${alerts.length} alerts`);

    // ─── Build comprehensive prompt ───
    const nowCOT = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });

    const prompt = `Eres Lexy, la asistente de inteligencia legal de ATENIA. El superadministrador ${userName} te pide un análisis profundo del estado actual de TODOS sus asuntos judiciales.

Fecha/hora actual (Colombia): ${nowCOT}

## RESUMEN DE PORTAFOLIO

Total asuntos activos: ${workItems.length}
${workItems.map((w: any) => `- [${w.workflow_type}] ${w.radicado || 'Sin radicado'} — "${w.title}" — Etapa: ${w.stage} — Autoridad: ${w.authority_name || 'N/A'} — Última actividad: ${w.last_event_at || 'N/A'} — Total actuaciones: ${w.total_actuaciones || 0}`).join("\n")}

## ACTUACIONES RECIENTES (últimos 7 días): ${recentActs.length}
${recentActs.map((a: any) => `- [${a.act_date}] Rad: ${(a as any).work_items?.radicado} — ${a.description || 'Actuación'}`).join("\n") || "Ninguna"}

## ESTADOS/PUBLICACIONES RECIENTES (últimos 7 días): ${recentPubs.length}
${recentPubs.map((p: any) => `- [${p.fecha_fijacion}] Rad: ${(p as any).work_items?.radicado} — ${p.tipo_publicacion} — Desfijación: ${p.fecha_desfijacion || 'N/A'}`).join("\n") || "Ninguno"}

## ALERTAS PENDIENTES: ${alerts.length}
${alerts.map((a: any) => `- [${a.severity}] ${a.title}: ${a.message}`).join("\n") || "Ninguna"}

## TÉRMINOS PROCESALES ACTIVOS: ${terms.length}
${terms.map((t: any) => `- "${t.term_name}" — Vence: ${t.due_date} — Estado: ${t.status} — Rad: ${(t as any).work_items?.radicado}`).join("\n") || "Ninguno"}

## VENCIMIENTOS/DEADLINES: ${deadlines.length}
${deadlines.map((d: any) => `- [${d.status}] ${d.deadline_type}: ${d.deadline_date} — ${d.description || ''} — Rad: ${(d as any).work_items?.radicado}`).join("\n") || "Ninguno"}

## HITOS RECIENTES (último mes): ${milestones.length}
${milestones.map((m: any) => `- [${m.event_date}] ${m.milestone_type} — ${m.notes || ''} — Rad: ${(m as any).work_items?.radicado}`).join("\n") || "Ninguno"}

## INSTRUCCIONES

Genera un análisis ejecutivo completo en español colombiano con estas secciones:

1. **🔍 Panorama General** — Estado general del portafolio, tendencias
2. **🚨 Asuntos Críticos** — Procesos que requieren atención INMEDIATA (términos por vencer, alertas críticas, audiencias próximas)
3. **📊 Actividad Reciente** — Resumen de las actuaciones y estados más relevantes de los últimos 7 días
4. **⏰ Términos y Vencimientos** — Análisis de plazos próximos, días hábiles restantes, riesgo de preclusión
5. **📈 Recomendaciones** — Acciones concretas sugeridas priorizadas por urgencia
6. **💡 Observaciones** — Patrones detectados (procesos inactivos, concentración de audiencias, etc.)

Sé directo, preciso y jurídicamente riguroso. No inventes datos. Si no hay información suficiente sobre algo, indícalo. Usa terminología jurídica colombiana correcta.
Máximo 800 palabras.`;

    // ─── Call Gemini ───
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[superadmin-lexy] AI error: HTTP ${resp.status} - ${errText.slice(0, 300)}`);
      
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await resp.json();
    const analysis = aiData.choices?.[0]?.message?.content || "No se pudo generar el análisis.";

    const durationMs = Date.now() - startTime;
    console.log(`[superadmin-lexy] Complete in ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        ok: true,
        analysis,
        stats: {
          work_items: workItems.length,
          recent_actuaciones: recentActs.length,
          recent_publicaciones: recentPubs.length,
          pending_alerts: alerts.length,
          active_terms: terms.length,
          deadlines: deadlines.length,
        },
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[superadmin-lexy] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
