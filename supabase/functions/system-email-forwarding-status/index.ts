/**
 * system-email-forwarding-status — Checks if a forwarded test email arrived via inbound webhook.
 * AUTH REQUIRED, super_admin only.
 *
 * GET ?since_minutes=30&subject_contains=ATENIA%20Forwarding%20Test
 * Returns { ok, lastInboundAt, matchedMessageId, hint }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "Invalid token" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRec } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!adminRec) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    // ── Parse params ─────────────────────────────────
    const url = new URL(req.url);
    const sinceMinutes = parseInt(url.searchParams.get("since_minutes") || "30", 10);
    const subjectContains = url.searchParams.get("subject_contains") || null;

    const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();

    // ── Query inbound messages ───────────────────────
    let query = adminClient
      .from("system_email_messages")
      .select("id, subject, received_at")
      .eq("direction", "inbound")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(5);

    if (subjectContains) {
      query = query.ilike("subject", `%${subjectContains}%`);
    }

    const { data: messages, error: qErr } = await query;
    if (qErr) {
      console.error("[forwarding-status] Query error:", qErr);
      return json({
        ok: false,
        lastInboundAt: null,
        matchedMessageId: null,
        hint: `Error al consultar mensajes: ${qErr.message}`,
      });
    }

    if (messages && messages.length > 0) {
      return json({
        ok: true,
        lastInboundAt: messages[0].received_at,
        matchedMessageId: messages[0].id,
        matchedSubject: messages[0].subject,
        totalMatches: messages.length,
        hint: "Forwarding verificado: se detectó al menos un email reenviado.",
      });
    }

    return json({
      ok: false,
      lastInboundAt: null,
      matchedMessageId: null,
      hint: subjectContains
        ? `No se encontró ningún email inbound con asunto que contenga "${subjectContains}" en los últimos ${sinceMinutes} minutos. Confirma que el forwarder de Hostinger está activo y espera 2-5 minutos.`
        : `No se detectaron emails inbound en los últimos ${sinceMinutes} minutos. Confirma que el forwarder está configurado correctamente.`,
    });
  } catch (err: any) {
    console.error("[forwarding-status]", err);
    return json({ ok: false, error: err.message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
