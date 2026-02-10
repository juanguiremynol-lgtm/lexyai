import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret } from "../_shared/secretsCrypto.ts";
import {
  safeFetchProvider,
  buildAuthHeaders,
  type ProviderInstanceInfo,
} from "../_shared/externalProviderClient.ts";
import {
  isTransientError,
  DEMONITOR_ELIGIBLE_ERROR_CODES,
  PROVIDER_EMPTY_RESULT,
  retryJitterMs,
} from "../_shared/syncPolicy.ts";
import { normalizeActuaciones, normalizePublicaciones } from "../_shared/providerNormalize.ts";
import { normalizeProviderErrorCode, isStrict404Code } from "../_shared/syncPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^\\x/, "");
  return new Uint8Array(clean.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const runId = crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Accept service_role calls directly or user auth
    const authHeader = req.headers.get("authorization");
    let callerOrgId: string | null = null;

    if (authHeader && !authHeader.includes(serviceKey)) {
      const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const { data: profile } = await db
          .from("profiles")
          .select("organization_id")
          .eq("id", user.id)
          .single();
        callerOrgId = profile?.organization_id || null;
      }
    }

    const body = await req.json();
    const { work_item_source_id, work_item_id, provider_instance_id } = body;

    // Load source
    let source: any;
    if (work_item_source_id) {
      const { data } = await db
        .from("work_item_sources")
        .select("*")
        .eq("id", work_item_source_id)
        .single();
      source = data;
    } else if (work_item_id && provider_instance_id) {
      const { data } = await db
        .from("work_item_sources")
        .select("*")
        .eq("work_item_id", work_item_id)
        .eq("provider_instance_id", provider_instance_id)
        .single();
      source = data;
    }

    if (!source) {
      return new Response(JSON.stringify({ error: "Source not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Org isolation for non-service calls
    if (callerOrgId && callerOrgId !== source.organization_id) {
      return new Response(JSON.stringify({ error: "Org mismatch" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load instance + connector
    const { data: instance } = await db
      .from("provider_instances")
      .select("*, provider_connectors(*)")
      .eq("id", source.provider_instance_id)
      .single();

    if (!instance) {
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load work item
    const { data: workItem } = await db
      .from("work_items")
      .select("id, owner_id, organization_id, radicado")
      .eq("id", source.work_item_id)
      .single();

    if (!workItem) {
      return new Response(JSON.stringify({ error: "Work item not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decrypt secret
    const { data: secretRow } = await db
      .from("provider_instance_secrets")
      .select("cipher_text, nonce")
      .eq("provider_instance_id", instance.id)
      .eq("is_active", true)
      .single();

    if (!secretRow) {
      await writeTrace(db, runId, source, instance, "SNAPSHOT", "ERROR", false, 0, { error: "No active secret" });
      return new Response(JSON.stringify({ error: "No active secret" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const decrypted = await decryptSecret(
      hexToBytes(secretRow.cipher_text as string),
      hexToBytes(secretRow.nonce as string),
    );

    const connector = instance.provider_connectors;
    const providerInfo: ProviderInstanceInfo = {
      id: instance.id,
      base_url: instance.base_url,
      auth_type: instance.auth_type,
      timeout_ms: instance.timeout_ms,
      rpm_limit: instance.rpm_limit,
      allowed_domains: connector?.allowed_domains || [],
    };

    // Call /snapshot
    const snapshotUrl = `${instance.base_url.replace(/\/$/, "")}/snapshot`;
    const snapshotBody = JSON.stringify({
      provider_case_id: source.provider_case_id,
      since: source.last_synced_at || null,
      include: connector?.capabilities || ["ACTUACIONES"],
    });
    const headers = await buildAuthHeaders({
      instance: providerInfo,
      decryptedSecret: decrypted,
      method: "POST",
      path: "/snapshot",
      body: snapshotBody,
      orgId: source.organization_id,
    });

    const snapStart = Date.now();
    let snapRes: Response;
    try {
      snapRes = await safeFetchProvider({
        url: snapshotUrl,
        allowlist: providerInfo.allowed_domains,
        init: { method: "POST", headers, body: snapshotBody },
        timeoutMs: providerInfo.timeout_ms,
      });
    } catch (fetchErr: unknown) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      await updateSourceError(db, source.id, "FETCH_ERROR", errMsg);
      await writeTrace(db, runId, source, instance, "SNAPSHOT", "ERROR", false, Date.now() - snapStart, { error: errMsg });
      return new Response(
        JSON.stringify({ ok: false, error: errMsg, duration_ms: Date.now() - startTime }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const snapLatency = Date.now() - snapStart;
    const snapData = await snapRes.json().catch(() => ({}));

    // ── Outcome routing ──

    // D) Strict 404 — use normalizer to map provider codes to canonical ATENIA codes
    const rawErrorCode = snapData.code || snapData.error_code || null;
    const normalizedCode = normalizeProviderErrorCode(rawErrorCode, snapRes.status);
    if (isStrict404Code(normalizedCode)) {
      await db
        .from("work_item_sources")
        .update({
          scrape_status: "ERROR",
          last_error_code: normalizedCode,
          last_error_message: snapData.message || snapData.error || "Not found",
          last_provider_latency_ms: snapLatency,
          consecutive_failures: (source.consecutive_failures || 0) + 1,
          consecutive_404_count: (source.consecutive_404_count || 0) + 1,
        })
        .eq("id", source.id);

      await writeTrace(db, runId, source, instance, "SNAPSHOT", normalizedCode, false, snapLatency, snapData);
      return new Response(
        JSON.stringify({ ok: false, code: normalizedCode, duration_ms: Date.now() - startTime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // C) Scraping pending / transient — use normalized code
    const isPending =
      snapData.scraping_initiated === true ||
      isTransientError(normalizedCode);

    if (isPending) {
      const transientCode = isTransientError(normalizedCode) ? normalizedCode : "SCRAPING_PENDING";
      await db
        .from("work_item_sources")
        .update({
          scrape_status: "SCRAPING_PENDING",
          last_error_code: transientCode,
          last_error_message: snapData.message || "Scraping in progress",
          last_provider_latency_ms: snapLatency,
        })
        .eq("id", source.id);

      // Enqueue retry with jitter (30-60s)
      const jitterMs = retryJitterMs();
      const nextRunAt = new Date(Date.now() + jitterMs).toISOString();
      await db.from("sync_retry_queue").upsert(
        {
          work_item_id: source.work_item_id,
          kind: "ACT_SCRAPE_RETRY",
          attempt: 1,
          max_attempts: 3,
          next_run_at: nextRunAt,
        },
        { onConflict: "work_item_id,kind" },
      ).select();

      await writeTrace(db, runId, source, instance, "SNAPSHOT", transientCode, false, snapLatency, {
        ...snapData,
        retry_next_run_at: nextRunAt,
      });

      return new Response(
        JSON.stringify({
          ok: false,
          scraping_pending: true,
          code: transientCode,
          retry_at: nextRunAt,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // A/B) ok=true
    if (!snapRes.ok || snapData.ok !== true) {
      // Generic error — use normalized code
      const errCode = normalizedCode !== 'PROVIDER_ERROR' ? normalizedCode : (rawErrorCode || "PROVIDER_ERROR");
      await updateSourceError(db, source.id, errCode, snapData.message || `HTTP ${snapRes.status}`);
      await writeTrace(db, runId, source, instance, "SNAPSHOT", errCode, false, snapLatency, snapData);
      return new Response(
        JSON.stringify({ ok: false, code: errCode, duration_ms: Date.now() - startTime }),
        { status: snapRes.status >= 400 ? snapRes.status : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check for empty results
    const acts = snapData.actuaciones || [];
    const pubs = snapData.publicaciones || [];

    if (acts.length === 0 && pubs.length === 0) {
      // B) Empty result
      await db
        .from("work_item_sources")
        .update({
          scrape_status: "EMPTY",
          last_error_code: PROVIDER_EMPTY_RESULT,
          last_error_message: "Provider returned valid response with zero records",
          last_provider_latency_ms: snapLatency,
          consecutive_failures: (source.consecutive_failures || 0) + 1,
          // Do NOT increment consecutive_404_count
        })
        .eq("id", source.id);

      await writeTrace(db, runId, source, instance, "UPSERT", PROVIDER_EMPTY_RESULT, false, snapLatency, {
        actuaciones_count: 0,
        publicaciones_count: 0,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          empty: true,
          code: PROVIDER_EMPTY_RESULT,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // A) Data present — upsert
    const provenance = {
      provider_instance_id: instance.id,
      provider_case_id: source.provider_case_id || "",
      source_url: source.source_url,
      retrieved_at: new Date().toISOString(),
    };

    let insertedActs = 0;
    let insertedPubs = 0;

    if (acts.length > 0) {
      const normalized = await normalizeActuaciones(
        acts,
        provenance,
        workItem.id,
        workItem.owner_id,
        workItem.organization_id,
      );
      const { data: inserted } = await db
        .from("work_item_acts")
        .upsert(normalized, { onConflict: "hash_fingerprint", ignoreDuplicates: true })
        .select("id");
      insertedActs = inserted?.length || 0;
    }

    if (pubs.length > 0) {
      const normalized = await normalizePublicaciones(
        pubs,
        provenance,
        workItem.id,
        workItem.owner_id,
        workItem.organization_id,
      );
      const { data: inserted } = await db
        .from("work_item_publicaciones")
        .upsert(normalized, { onConflict: "hash_fingerprint", ignoreDuplicates: true })
        .select("id");
      insertedPubs = inserted?.length || 0;
    }

    // Update source: success
    await db
      .from("work_item_sources")
      .update({
        scrape_status: "OK",
        last_synced_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
        last_provider_latency_ms: snapLatency,
        consecutive_failures: 0,
        consecutive_404_count: 0,
      })
      .eq("id", source.id);

    await writeTrace(db, runId, source, instance, "DONE", "OK", true, Date.now() - startTime, {
      actuaciones_received: acts.length,
      actuaciones_inserted: insertedActs,
      publicaciones_received: pubs.length,
      publicaciones_inserted: insertedPubs,
    });

    // Audit
    await db.from("atenia_ai_actions").insert({
      organization_id: source.organization_id,
      action_type: "PROVIDER_SYNC_COMPLETED",
      autonomy_tier: "SYSTEM",
      reasoning: `Synced ${insertedActs} actuaciones + ${insertedPubs} publicaciones from "${instance.name}"`,
      target_entity_type: "work_item_source",
      target_entity_id: source.id,
      evidence: {
        work_item_id: workItem.id,
        provider_instance_id: instance.id,
        actuaciones_received: acts.length,
        actuaciones_inserted: insertedActs,
        publicaciones_received: pubs.length,
        publicaciones_inserted: insertedPubs,
        latency_ms: snapLatency,
        duration_ms: Date.now() - startTime,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        inserted_actuaciones: insertedActs,
        inserted_publicaciones: insertedPubs,
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Helpers ──

async function updateSourceError(db: any, sourceId: string, code: string, message: string) {
  await db
    .from("work_item_sources")
    .update({
      scrape_status: "ERROR",
      last_error_code: code,
      last_error_message: message,
      consecutive_failures: db.rpc ? undefined : undefined, // handled inline
    })
    .eq("id", sourceId);
}

async function writeTrace(
  db: any,
  runId: string,
  source: any,
  instance: any,
  stage: string,
  resultCode: string,
  ok: boolean,
  latencyMs: number,
  payload: unknown,
) {
  await db.from("provider_sync_traces").insert({
    organization_id: source.organization_id,
    work_item_id: source.work_item_id,
    work_item_source_id: source.id,
    provider_instance_id: instance.id,
    run_id: runId,
    stage,
    result_code: resultCode,
    ok,
    latency_ms: latencyMs,
    payload: payload || {},
  });
}
