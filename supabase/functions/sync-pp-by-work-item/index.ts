/**
 * sync-pp-by-work-item Edge Function
 *
 * DEPRECATED (2026-07-14). Publicaciones Procesales (PP) is an ESTADOS-family
 * provider. Per canonical policy — ACTUACIONES = CPNU/SAMAI exclusively;
 * ESTADOS = PP + SAMAI_ESTADOS — this function must NOT write to
 * work_item_acts. All PP estados ingestion is handled by
 * sync-publicaciones-by-work-item, which writes to work_item_publicaciones.
 *
 * This stub is retained for backward-compatible invocation only. It performs
 * a best-effort PP registration (populating work_items.pp_id when missing so
 * downstream tooling can still cross-reference) and updates pp_estado, but
 * it never inserts, updates, or upserts rows in work_item_acts. A structural
 * BEFORE INSERT guard on work_item_acts also rejects `source='pp'` writes.
 *
 * Input: { work_item_id: string, _scheduled?: boolean }
 * Output: { ok, deprecated: true, inserted_count: 0, skipped_count: 0 }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const PP_API_BASE = "https://pp-read-api-zcrd2ua7xq-uc.a.run.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Health check
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "true") {
    return json({ ok: true, function: "sync-pp-by-work-item", deprecated: true });
  }

  try {
    const body = await req.json();
    const workItemId: string | undefined = body?.work_item_id;
    const isScheduled: boolean = body?._scheduled === true;

    if (!workItemId) {
      return json({ error: "work_item_id is required" }, 400);
    }

    // ── Auth ──
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let userId: string | null = null;

    if (isScheduled) {
      // Cron / service-role – no JWT needed
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return json({ error: "Unauthorized" }, 401);
      }
      const tempClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsErr } =
        await tempClient.auth.getClaims(token);
      if (claimsErr || !claimsData?.claims) {
        return json({ error: "Unauthorized" }, 401);
      }
      userId = claimsData.claims.sub as string;
    }

    // Always use service role for DB writes
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── 1. Load work item ──
    const { data: workItem, error: wiErr } = await supabase
      .from("work_items")
      .select("id, pp_id, radicado, owner_id, organization_id")
      .eq("id", workItemId)
      .maybeSingle();

    if (wiErr || !workItem) {
      return json({ error: "Work item not found" }, 404);
    }

    // Non-scheduled: validate user belongs to same org
    if (!isScheduled && userId) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("id")
        .eq("user_id", userId)
        .eq("organization_id", workItem.organization_id)
        .maybeSingle();
      if (!membership) {
        return json({ error: "Forbidden" }, 403);
      }
    }

    const radicado = workItem.radicado;
    if (!radicado) {
      return json({ error: "Work item has no radicado" }, 400);
    }

    // ── DEPRECATED PATH ──
    // PP is an ESTADOS-family provider; sync-publicaciones-by-work-item
    // handles all ingestion into work_item_publicaciones. We keep pp_id
    // registration best-effort so cross-provider tooling can reference the
    // upstream PP record, then return without writing any acts.
    let ppId: number | null = workItem.pp_id;
    if (!ppId) {
      try {
        const regRes = await fetch(`${PP_API_BASE}/work-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ radicado }),
        });
        if (regRes.ok) {
          const regBody = await regRes.json();
          ppId = regBody?.item?.id ?? null;
          if (ppId) {
            await supabase
              .from("work_items")
              .update({ pp_id: ppId })
              .eq("id", workItemId);
          }
        }
      } catch (regErr) {
        console.warn(`[sync-pp][deprecated] pp_id registration failed (non-blocking):`, regErr);
      }
    }

    const now = new Date().toISOString();
    await supabase
      .from("work_items")
      .update({
        pp_ultima_sync: now,
        pp_estado: "deprecated",
        pp_novedades_pendientes: 0,
      })
      .eq("id", workItemId);

    console.log(
      `[sync-pp][deprecated] Skipped acts write for ${workItemId}; PP data flows through sync-publicaciones-by-work-item.`
    );

    return json({
      ok: true,
      deprecated: true,
      message:
        "sync-pp-by-work-item is a no-op. PP is an ESTADOS provider; use sync-publicaciones-by-work-item.",
      inserted_count: 0,
      skipped_count: 0,
    });
  } catch (err) {
    console.error("[sync-pp] Unexpected error:", err);
    return json({ error: "Internal error", detail: String(err) }, 500);
  }
});
