import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const ANDROMEDA_API_BASE =
  "https://andromeda-read-api-11974381924.us-central1.run.app";

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
    let upstreamStatus = 0;
    let upstreamOk = false;
    let upstreamBody: unknown = null;
    try {
      const res = await fetch(
        `${ANDROMEDA_API_BASE}/terminos/${terminoId}/atender`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
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

    if (!upstreamOk) {
      return json({
        ok: false,
        error: `Andromeda API respondió ${upstreamStatus}`,
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