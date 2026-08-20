import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const ANDROMEDA_API_BASE =
  "https://andromeda-read-api-zcrd2ua7xq-uc.a.run.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeRadicado(raw: string | null | undefined): string {
  return (raw || "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed", alerts_resolved: 0, upstream_status: 0 }, 200);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Unauthorized", alerts_resolved: 0, upstream_status: 0 }, 200);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return json({ ok: false, error: "Unauthorized", alerts_resolved: 0, upstream_status: 0 }, 200);
    }
    const userId = claimsData.claims.sub as string;

    let body: { termino_id?: number; radicado?: string; notas?: string };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body", alerts_resolved: 0, upstream_status: 0 }, 200);
    }

    const terminoId = Number(body.termino_id);
    if (!Number.isFinite(terminoId) || terminoId <= 0) {
      return json({ ok: false, error: "termino_id requerido", alerts_resolved: 0, upstream_status: 0 }, 200);
    }
    const radicado = normalizeRadicado(body.radicado);
    const notas = (body.notas || "").toString().slice(0, 500);

    // 1. Call upstream PATCH
    //
    // andromeda-read-api enforces X-API-Key on EVERY endpoint via app.use
    // before routing — there are no path exceptions. Without this header the
    // PATCH returns 401 and the upstream UPDATE
    // (terminos_detectados SET estado='ATENDIDO') never runs. Same env var
    // andromeda-proxy already uses against the same service.
    const ANDROMEDA_API_KEY = Deno.env.get("ANDROMEDA_API_KEY") || "";
    if (!ANDROMEDA_API_KEY) {
      // Fail loudly: a missing key is a configuration bug, not a term that
      // was attended. Never report success without an authenticated upstream.
      return json({
        ok: false,
        error: "ANDROMEDA_API_KEY no está configurada; no se puede marcar el término como atendido.",
        alerts_resolved: 0,
        upstream_status: 0,
      }, 200);
    }

    let upstreamStatus = 0;
    let upstreamOk = false;
    let upstreamBody: unknown = null;
    try {
      const res = await fetch(
        `${ANDROMEDA_API_BASE}/terminos/${terminoId}/atender`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": ANDROMEDA_API_KEY,
          },
          body: JSON.stringify({ notas }),
        },
      );
      upstreamStatus = res.status;
      try {
        upstreamBody = await res.json();
      } catch {
        upstreamBody = await res.text().catch(() => null);
      }
      const payloadOk =
        upstreamBody && typeof upstreamBody === "object" && (upstreamBody as { ok?: boolean }).ok === true;
      upstreamOk = res.ok && (payloadOk || res.status === 200);
    } catch (e) {
      return json({
        ok: false,
        error: `Upstream fetch failed: ${(e as Error).message}`,
        alerts_resolved: 0,
        upstream_status: 0,
      }, 200);
    }

    // Non-2xx (or a body without ok:true) is an ERROR. We return before the
    // alert-resolution block below, so nothing is marked attended locally and
    // no alert is resolved when the upstream UPDATE did not happen.
    if (!upstreamOk) {
      const detail = typeof upstreamBody === "string"
        ? upstreamBody.slice(0, 200)
        : JSON.stringify(upstreamBody ?? {}).slice(0, 200);
      console.error(`[andromeda-terminos-proxy] upstream ${upstreamStatus}: ${detail}`);
      return json({
        ok: false,
        error: upstreamStatus === 401 || upstreamStatus === 403
          ? `Andromeda API rechazó la solicitud (${upstreamStatus}): credencial inválida o ausente. El término NO fue marcado como atendido.`
          : `Andromeda API respondió ${upstreamStatus}. El término NO fue marcado como atendido.`,
        alerts_resolved: 0,
        upstream_status: upstreamStatus,
      }, 200);
    }

    // 2. Resolve related alerts
    let alertsResolved = 0;
    if (radicado) {
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

      // Get user's organization
      const { data: profile } = await admin
        .from("profiles")
        .select("organization_id")
        .eq("id", userId)
        .maybeSingle();

      const orgId = profile?.organization_id;
      if (orgId) {
        const { data: workItems } = await admin
          .from("work_items")
          .select("id")
          .eq("organization_id", orgId)
          .eq("radicado", radicado)
          .is("deleted_at", null);

        const ids = (workItems || []).map((w) => w.id);
        if (ids.length > 0) {
          const { data: updated, error: updErr } = await admin
            .from("alert_instances")
            .update({ status: "RESOLVED", resolved_at: new Date().toISOString() })
            .in("alert_type", ["TERMINO_CRITICO", "TERMINO_VENCIDO"])
            .not("status", "in", "(RESOLVED,DISMISSED,CANCELLED)")
            .eq("organization_id", orgId)
            .in("entity_id", ids)
            .select("id");

          if (!updErr && updated) alertsResolved = updated.length;
        }
      }
    }

    return json({
      ok: true,
      alerts_resolved: alertsResolved,
      upstream_status: upstreamStatus,
    });
  } catch (e) {
    return json({
      ok: false,
      error: (e as Error).message || "Unexpected error",
      alerts_resolved: 0,
      upstream_status: 0,
    }, 200);
  }
});