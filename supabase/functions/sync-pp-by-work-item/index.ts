/**
 * sync-pp-by-work-item Edge Function
 *
 * Syncs actuaciones from the Publicaciones Procesales (PP) API
 * into work_item_acts for a single work item.
 *
 * Input: { work_item_id: string, _scheduled?: boolean }
 * Output: { ok, inserted_count, skipped_count }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const PP_API_BASE = "https://pp-read-api-11974381924.us-central1.run.app";

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

/** Parse DD/MM/YYYY → YYYY-MM-DD */
function parseDDMMYYYY(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Health check
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "true") {
    return json({ ok: true, function: "sync-pp-by-work-item" });
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

    let ppId: number | null = workItem.pp_id;

    // ── 2. Register in PP if no pp_id ──
    if (!ppId) {
      console.log(`[sync-pp] Registering radicado ${radicado} in PP API`);
      const regRes = await fetch(`${PP_API_BASE}/work-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ radicado }),
      });
      if (!regRes.ok) {
        const errText = await regRes.text();
        console.error(`[sync-pp] PP registration failed: ${regRes.status} ${errText}`);
        return json({ error: "PP registration failed", detail: errText }, 502);
      }
      const regBody = await regRes.json();
      ppId = regBody?.item?.id ?? null;
      if (!ppId) {
        return json({ error: "PP registration returned no id" }, 502);
      }
      // Save pp_id
      await supabase
        .from("work_items")
        .update({ pp_id: ppId })
        .eq("id", workItemId);
      console.log(`[sync-pp] Registered pp_id=${ppId} for ${workItemId}`);
    }

    // ── 3. Fetch actuaciones from PP ──
    const actRes = await fetch(`${PP_API_BASE}/work-items/${ppId}/actuaciones`);
    if (!actRes.ok) {
      const errText = await actRes.text();
      console.error(`[sync-pp] PP fetch failed: ${actRes.status} ${errText}`);

      await supabase
        .from("work_items")
        .update({
          pp_ultima_sync: new Date().toISOString(),
          pp_estado: "error",
        })
        .eq("id", workItemId);

      return json({ error: "PP API fetch failed", detail: errText }, 502);
    }

    const actBody = await actRes.json();
    // Handle both array and { actuaciones: [...] } responses
    const actuaciones: any[] = Array.isArray(actBody)
      ? actBody
      : actBody?.actuaciones ?? [];

    if (actuaciones.length === 0) {
      await supabase
        .from("work_items")
        .update({
          pp_ultima_sync: new Date().toISOString(),
          pp_estado: "ok",
          pp_novedades_pendientes: 0,
        })
        .eq("id", workItemId);
      return json({ ok: true, inserted_count: 0, skipped_count: 0 });
    }

    // ── 4. Map to work_item_acts ──
    const now = new Date().toISOString();
    const records = actuaciones.map((act: any) => {
      const ppActId = String(act.id || act.actuacion_id || "unknown");
      const fingerprint = `pp_act_${workItemId.slice(0, 8)}_${ppActId}`;
      const description =
        act.descripcion || act.actuacion || act.anotacion || "Sin descripción";
      const actDate = parseDDMMYYYY(act.fecha_actuacion) || null;
      const fechaRegistro = parseDDMMYYYY(act.fecha_registro) || null;

      return {
        work_item_id: workItemId,
        owner_id: workItem.owner_id,
        organization_id: workItem.organization_id,
        hash_fingerprint: fingerprint,
        content_hash: fingerprint,
        description,
        act_date: actDate,
        act_date_raw: act.fecha_actuacion || null,
        act_type: "publicacion_pp",
        source: "pp",
        source_platform: "pp",
        raw_data: act,
        detected_at: now,
        last_seen_at: now,
        fecha_registro_source: fechaRegistro,
        despacho: act.despacho || null,
        source_url: act.enlace || act.url || null,
      };
    });

    // ── 5. Upsert ──
    const { data: upserted, error: upsertErr } = await supabase
      .from("work_item_acts")
      .upsert(records, {
        onConflict: "work_item_id,hash_fingerprint",
        ignoreDuplicates: false,
      })
      .select("id");

    if (upsertErr) {
      console.error(`[sync-pp] Upsert error:`, upsertErr);
      await supabase
        .from("work_items")
        .update({
          pp_ultima_sync: now,
          pp_estado: "error",
        })
        .eq("id", workItemId);
      return json({ error: "Upsert failed", detail: upsertErr.message }, 500);
    }

    const insertedCount = upserted?.length ?? 0;
    const skippedCount = records.length - insertedCount;

    // ── 6. Update tracking ──
    await supabase
      .from("work_items")
      .update({
        pp_ultima_sync: now,
        pp_estado: "ok",
        pp_novedades_pendientes: insertedCount,
      })
      .eq("id", workItemId);

    console.log(
      `[sync-pp] Done for ${workItemId}: inserted=${insertedCount}, skipped=${skippedCount}`
    );

    return json({ ok: true, inserted_count: insertedCount, skipped_count: skippedCount });
  } catch (err) {
    console.error("[sync-pp] Unexpected error:", err);
    return json({ error: "Internal error", detail: String(err) }, 500);
  }
});
