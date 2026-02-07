/**
 * Lexy Daily Message — AI-powered daily case summary per user
 *
 * Generates ONE personalized message per user per day using Gemini.
 * Reads new actuaciones, publicaciones, and unresolved alerts.
 *
 * Modes:
 *   GENERATE_ALL  — Generate for all users across all orgs (cron)
 *   GENERATE_USER — Generate for a single user (on-demand)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface LexyInput {
  mode: "GENERATE_ALL" | "GENERATE_USER";
  user_id?: string;
  organization_id?: string;
}

interface LexyMessage {
  greeting: string;
  summary_body: string;
  highlights: Array<{ icon: string; text: string }>;
  closing: string;
  alerts_included: string[];
}

interface UserDailyData {
  userId: string;
  userName: string;
  orgId: string;
  newActuaciones: Array<{
    radicado: string;
    description: string;
    act_date: string;
    authority_name: string;
    work_item_title: string;
  }>;
  newPublicaciones: Array<{
    radicado: string;
    tipo_publicacion: string;
    fecha_fijacion: string;
    terminos_inician: string | null;
    work_item_title: string;
  }>;
  unresolvedAlerts: Array<{
    id: string;
    severity: string;
    title: string;
    message: string;
  }>;
  syncFailures: Array<{
    radicado: string;
    diagnostic_message_es: string;
  }>;
}

// ─── COT date helpers ────────────────────────────────────────────────

function todayCOT(): string {
  const now = new Date();
  const cot = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cot.toISOString().slice(0, 10);
}

function todayCOTStart(): string {
  return `${todayCOT()}T05:00:00.000Z`; // 00:00 COT = 05:00 UTC
}

// ─── "All Quiet" message (no Gemini needed) ──────────────────────────

function generateQuietMessage(userName: string): LexyMessage {
  const greetings = [
    `Buenos días, ${userName}. Todo en orden con tus asuntos hoy.`,
    `¡Hola, ${userName}! No hay novedades en tus procesos esta mañana.`,
    `Buenos días, ${userName}. Revisé todos tus asuntos y no encontré actuaciones nuevas.`,
  ];

  return {
    greeting: greetings[Math.floor(Math.random() * greetings.length)],
    summary_body:
      "Todos tus asuntos fueron consultados exitosamente. Te avisaré inmediatamente cuando haya una novedad.",
    highlights: [{ icon: "✅", text: "Sin novedades — todos los asuntos están al día." }],
    closing: "Que tengas un excelente día. 💼",
    alerts_included: [],
  };
}

// ─── Gemini message generation ───────────────────────────────────────

async function generateLexyMessageWithGemini(userData: UserDailyData): Promise<LexyMessage> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.warn("[lexy] No LOVABLE_API_KEY, using quiet message");
    return generateQuietMessage(userData.userName);
  }

  const now = new Date();
  const timeStr = now.toLocaleString("es-CO", { timeZone: "America/Bogota" });

  const prompt = `Eres Lexy, la asistente digital de ATENIA, una plataforma de gestión judicial colombiana.
Vas a escribir el mensaje diario para un abogado. El mensaje debe ser:
- Cálido pero profesional
- Conciso (máximo 200 palabras para el body)
- En español colombiano natural (no formal excesivo)
- Jurídicamente preciso en la terminología
- Priorizar información crítica primero

## Datos del usuario hoy:

Nombre: ${userData.userName}
Hora actual: ${timeStr}

### Nuevas actuaciones (${userData.newActuaciones.length}):
${userData.newActuaciones.map((a) => `- Rad: ${a.radicado} | ${a.description} | ${a.act_date} | Asunto: ${a.work_item_title}`).join("\n") || "Ninguna"}

### Nuevos estados (${userData.newPublicaciones.length}):
${userData.newPublicaciones.map((p) => `- Rad: ${p.radicado} | ${p.tipo_publicacion} | Fijación: ${p.fecha_fijacion} | Términos inician: ${p.terminos_inician || "N/A"} | Asunto: ${p.work_item_title}`).join("\n") || "Ninguno"}

### Alertas pendientes (${userData.unresolvedAlerts.length}):
${userData.unresolvedAlerts.map((a) => `- [${a.severity}] ${a.title}: ${a.message}`).join("\n") || "Ninguna"}

### Fallos de sincronización:
${userData.syncFailures.map((f) => `- Rad: ${f.radicado} — ${f.diagnostic_message_es}`).join("\n") || "Todos los asuntos se sincronizaron correctamente"}

## Instrucciones:

Genera un JSON con esta estructura exacta (sin markdown, solo JSON puro):
{
  "greeting": "Buenos días/tardes [nombre], ...",
  "body": "Resumen del día...",
  "highlights": [
    { "icon": "⚖️|📄|📢|⏰|✅", "text": "Punto clave" }
  ],
  "closing": "Frase de cierre breve"
}

Si no hay novedades, genera un mensaje breve y positivo.
Si hay eventos CRITICAL (sentencias, fallos), empieza con esos.
Si hay términos que inician hoy o mañana, resáltalos con ⏰.
NUNCA inventes datos. Solo usa la información proporcionada.
Máximo 5 highlights.`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
        temperature: 0.4,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`[lexy] Gemini failed: HTTP ${resp.status} - ${errText.slice(0, 200)}`);
      return generateQuietMessage(userData.userName);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonStr);

    return {
      greeting: parsed.greeting || `Buenos días, ${userData.userName}`,
      summary_body: parsed.body || parsed.summary_body || "Sin novedades hoy.",
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 5) : [],
      closing: parsed.closing || "Que tengas un excelente día.",
      alerts_included: userData.unresolvedAlerts.map((a) => a.id),
    };
  } catch (err) {
    console.error("[lexy] Gemini error:", err);
    return generateQuietMessage(userData.userName);
  }
}

// ─── Main Handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[lexy-daily-message] Starting...");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase config");

    const supabase = createClient(supabaseUrl, supabaseKey);

    let input: LexyInput;
    try {
      input = await req.json();
    } catch {
      input = { mode: "GENERATE_ALL" };
    }

    const messageDate = todayCOT();
    const dayStart = todayCOTStart();
    console.log(`[lexy] Mode: ${input.mode}, Date: ${messageDate}`);

    // ─── Determine which users to process ───
    let userOrgPairs: Array<{ user_id: string; organization_id: string }> = [];

    if (input.mode === "GENERATE_USER" && input.user_id) {
      // Single user mode
      const { data: memberships } = await supabase
        .from("organization_memberships")
        .select("user_id, organization_id")
        .eq("user_id", input.user_id);

      userOrgPairs = (memberships || []).map((m: any) => ({
        user_id: m.user_id,
        organization_id: m.organization_id,
      }));
    } else {
      // All users with active monitored work items
      const { data: activeItems } = await supabase
        .from("work_items")
        .select("organization_id")
        .eq("monitoring_enabled", true)
        .eq("status", "ACTIVE")
        .not("organization_id", "is", null);

      const activeOrgIds = [...new Set((activeItems || []).map((i: any) => i.organization_id))];

      if (activeOrgIds.length > 0) {
        const { data: memberships } = await supabase
          .from("organization_memberships")
          .select("user_id, organization_id")
          .in("organization_id", activeOrgIds);

        userOrgPairs = (memberships || []).map((m: any) => ({
          user_id: m.user_id,
          organization_id: m.organization_id,
        }));
      }
    }

    console.log(`[lexy] Processing ${userOrgPairs.length} user-org pairs`);

    let generated = 0;
    let skipped = 0;

    for (const { user_id, organization_id } of userOrgPairs) {
      try {
        // Step 2: Check if today's message already exists
        const { data: existing } = await (supabase
          .from("lexy_daily_messages") as any)
          .select("id")
          .eq("user_id", user_id)
          .eq("organization_id", organization_id)
          .eq("message_date", messageDate)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Get user name
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user_id)
          .maybeSingle();

        const userName = profile?.full_name || "usuario";

        // Step 3: Gather user data
        // New actuaciones today (is_notifiable)
        const { data: newActs } = await supabase
          .from("work_item_acts")
          .select("id, work_item_id, description, annotation, act_date, work_items!inner(radicado, title)")
          .eq("organization_id", organization_id)
          .eq("is_notifiable", true)
          .gte("created_at", dayStart)
          .limit(20);

        // New publicaciones today
        const { data: newPubs } = await supabase
          .from("work_item_publicaciones")
          .select("id, work_item_id, tipo_publicacion, fecha_fijacion, fecha_desfijacion, work_items!inner(radicado, title)")
          .eq("organization_id", organization_id)
          .eq("is_notifiable", true)
          .gte("created_at", dayStart)
          .limit(20);

        // Unresolved alerts
        const { data: alerts } = await supabase
          .from("alert_instances")
          .select("id, severity, title, message")
          .eq("owner_id", user_id)
          .eq("organization_id", organization_id)
          .in("status", ["ACTIVE", "FIRED"])
          .is("seen_at", null)
          .limit(10);

        // Sync failures from today's Atenia AI report
        let syncFailures: Array<{ radicado: string; diagnostic_message_es: string }> = [];
        const { data: report } = await (supabase
          .from("atenia_ai_reports") as any)
          .select("diagnostics")
          .eq("organization_id", organization_id)
          .eq("report_date", messageDate)
          .eq("report_type", "DAILY_AUDIT")
          .maybeSingle();

        if (report?.diagnostics) {
          const diags = report.diagnostics as Array<any>;
          syncFailures = diags
            .filter((d: any) => d.severity === "PROBLEMA" || d.severity === "CRITICO")
            .slice(0, 5)
            .map((d: any) => ({ radicado: d.radicado, diagnostic_message_es: d.message_es }));
        }

        // Build user data
        const userData: UserDailyData = {
          userId: user_id,
          userName,
          orgId: organization_id,
          newActuaciones: (newActs || []).map((a: any) => ({
            radicado: a.work_items?.radicado || "N/A",
            description: a.description || a.annotation || "Actuación",
            act_date: a.act_date || "",
            authority_name: "",
            work_item_title: a.work_items?.title || "",
          })),
          newPublicaciones: (newPubs || []).map((p: any) => ({
            radicado: p.work_items?.radicado || "N/A",
            tipo_publicacion: p.tipo_publicacion || "ESTADO",
            fecha_fijacion: p.fecha_fijacion || "",
            terminos_inician: p.fecha_desfijacion || null,
            work_item_title: p.work_items?.title || "",
          })),
          unresolvedAlerts: (alerts || []).map((a: any) => ({
            id: a.id,
            severity: a.severity,
            title: a.title,
            message: a.message,
          })),
          syncFailures,
        };

        // Step 4: Generate message
        const hasData =
          userData.newActuaciones.length > 0 ||
          userData.newPublicaciones.length > 0 ||
          userData.unresolvedAlerts.length > 0 ||
          userData.syncFailures.length > 0;

        let lexyMessage: LexyMessage;
        if (hasData) {
          lexyMessage = await generateLexyMessageWithGemini(userData);
        } else {
          lexyMessage = generateQuietMessage(userName);
        }

        // Step 5: Insert into lexy_daily_messages
        const { error: insertError } = await (supabase
          .from("lexy_daily_messages") as any)
          .insert({
            user_id,
            organization_id,
            message_date: messageDate,
            greeting: lexyMessage.greeting,
            summary_body: lexyMessage.summary_body,
            highlights: lexyMessage.highlights,
            closing: lexyMessage.closing,
            alerts_included: lexyMessage.alerts_included,
            work_items_covered: userData.newActuaciones.length + userData.newPublicaciones.length,
            new_actuaciones_count: userData.newActuaciones.length,
            new_publicaciones_count: userData.newPublicaciones.length,
            critical_alerts_count: userData.unresolvedAlerts.filter((a) => a.severity === "CRITICAL").length,
            delivered_via: ["in_app"],
          });

        if (insertError) {
          // Likely unique constraint violation (already exists)
          console.warn(`[lexy] Insert error for user ${user_id}:`, insertError.message);
          skipped++;
          continue;
        }

        // Step 6: Create alert_instance for in-app notification bell
        await supabase.from("alert_instances").insert({
          owner_id: user_id,
          organization_id,
          entity_type: "USER",
          entity_id: user_id,
          severity: "INFO",
          title: "📋 Resumen diario de Lexy",
          message: lexyMessage.greeting,
          status: "ACTIVE",
          fired_at: new Date().toISOString(),
          alert_type: "LEXY_DAILY",
          alert_source: "lexy",
          payload: {
            alert_type: "LEXY_DAILY",
            message_date: messageDate,
            new_actuaciones_count: userData.newActuaciones.length,
            new_publicaciones_count: userData.newPublicaciones.length,
          },
          fingerprint: `lexy_daily_${user_id}_${messageDate}`,
        });

        generated++;
        console.log(`[lexy] Generated message for user ${user_id} (${userName})`);
      } catch (userErr) {
        console.error(`[lexy] Error for user ${user_id}:`, userErr);
      }

      // Safety timeout
      if (Date.now() - startTime > 50000) {
        console.log("[lexy] Timeout, stopping user iteration");
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[lexy] Complete: ${generated} generated, ${skipped} skipped, ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        ok: true,
        mode: input.mode,
        message_date: messageDate,
        generated,
        skipped,
        total_users: userOrgPairs.length,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[lexy-daily-message] Fatal:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message, duration_ms: Date.now() - startTime }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
