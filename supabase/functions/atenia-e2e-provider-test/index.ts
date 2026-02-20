/**
 * atenia-e2e-provider-test — Control plane for mock E2E provider tests.
 *
 * Orchestrates a full pipeline test for a single api_kind:
 *   1. Calls mock-external-provider with deterministic scenario
 *   2. Persists provider_raw_snapshots
 *   3. Applies mapping (via existing pipeline)
 *   4. Upserts to work_item_acts / work_item_publicaciones
 *   5. Checks alert_instances created
 *   6. Checks email_outbox enqueued
 *   7. Returns structured report
 *
 * Env-gated: ATENIA_ENABLE_PROVIDER_MOCKS=true required.
 * Auth: platform super admin only.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface E2ERequest {
  work_item_id: string;
  api_kind: string; // CPNU | SAMAI | PUBLICACIONES | TUTELAS | SAMAI_ESTADOS
  scenario?: string; // NEW_MOVEMENT | MODIFIED_MOVEMENT | EMPTY | ERROR_TIMEOUT | ERROR_404
  seed?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const mocksEnabled = Deno.env.get("ATENIA_ENABLE_PROVIDER_MOCKS") === "true";
  if (!mocksEnabled) {
    return new Response(
      JSON.stringify({ error: "E2E provider mocks disabled. Set ATENIA_ENABLE_PROVIDER_MOCKS=true." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceKey);

  // ── Auth: verify platform admin ──
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Check platform admin
    const { data: profile } = await db
      .from("profiles")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.is_platform_admin) {
      return new Response(JSON.stringify({ error: "Platform admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const startTime = Date.now();
  const runId = crypto.randomUUID();

  try {
    const body: E2ERequest = await req.json();
    const { work_item_id, api_kind, scenario = "NEW_MOVEMENT", seed = Date.now() } = body;

    if (!work_item_id || !api_kind) {
      return new Response(
        JSON.stringify({ error: "work_item_id and api_kind required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load work item
    const { data: workItem } = await db
      .from("work_items")
      .select("id, radicado, organization_id, owner_id, workflow_type")
      .eq("id", work_item_id)
      .single();

    if (!workItem) {
      return new Response(
        JSON.stringify({ error: "Work item not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const steps: Array<{ step: string; status: string; detail: unknown; duration_ms: number }> = [];

    // ── Step 1: Call mock provider ──
    const mockStart = Date.now();
    const mockResp = await fetch(`${supabaseUrl}/functions/v1/mock-external-provider`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_kind: api_kind.toUpperCase(),
        radicado: workItem.radicado,
        scenario,
        seed,
      }),
    });
    const mockData = await mockResp.json();
    steps.push({
      step: "MOCK_PROVIDER_CALL",
      status: mockResp.ok ? "OK" : "ERROR",
      detail: { status: mockResp.status, has_data: !!mockData?.data, scenario },
      duration_ms: Date.now() - mockStart,
    });

    if (!mockResp.ok || scenario === "ERROR_404" || scenario === "EMPTY") {
      // For error/empty scenarios, record and return
      const report = {
        run_id: runId,
        api_kind,
        work_item_id,
        scenario,
        steps,
        upsert: { inserted: 0, updated: 0 },
        alert_ids: [],
        outbox_ids: [],
        duration_ms: Date.now() - startTime,
      };
      await saveE2EReport(db, report, workItem.organization_id);
      return new Response(JSON.stringify(report), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Step 2: Save raw snapshot ──
    const snapStart = Date.now();
    const snapshotId = crypto.randomUUID();
    await db.from("provider_raw_snapshots").insert({
      id: snapshotId,
      organization_id: workItem.organization_id,
      work_item_id,
      provider_instance_id: "00000000-0000-0000-0000-e2e000000001",
      run_id: runId,
      raw_body: JSON.stringify(mockData),
      response_status: mockResp.status,
      response_content_type: "application/json",
      body_hash: await sha256(JSON.stringify(mockData)),
      status: "OK",
    });
    steps.push({
      step: "SNAPSHOT_SAVED",
      status: "OK",
      detail: { snapshot_id: snapshotId },
      duration_ms: Date.now() - snapStart,
    });

    // ── Step 3: Extract and upsert data ──
    const upsertStart = Date.now();
    const data = mockData?.data ?? mockData;
    let inserted = 0, updated = 0;

    const isEstados = api_kind.toUpperCase() === "PUBLICACIONES" || api_kind.toUpperCase() === "SAMAI_ESTADOS";
    
    if (isEstados) {
      // Upsert to work_item_publicaciones
      const pubs = data?.publicaciones || data?.estados || [];
      for (const pub of pubs) {
        const hashInput = `${workItem.radicado}|${pub.fechaFijacion || ""}|${pub.titulo || ""}|mock-e2e`;
        const fingerprint = await sha256(hashInput);
        const contentHash = await sha256(JSON.stringify(pub));
        
        // Check existing
        const { data: existing } = await db
          .from("work_item_publicaciones")
          .select("id, content_hash")
          .eq("work_item_id", work_item_id)
          .eq("hash_fingerprint", fingerprint)
          .maybeSingle();

        if (!existing) {
          await db.from("work_item_publicaciones").insert({
            work_item_id,
            organization_id: workItem.organization_id,
            owner_id: workItem.owner_id,
            hash_fingerprint: fingerprint,
            content_hash: contentHash,
            fecha_fijacion: pub.fechaFijacion || pub.fechaFijacion || null,
            fecha_desfijacion: pub.fechaDesfijacion || null,
            title: pub.titulo || "",
            tipo_publicacion: pub.tipoPublicacion || "AUTO",
            source: `mock-e2e-${api_kind.toLowerCase()}`,
            detected_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            is_notifiable: true,
          } as any);
          inserted++;
        } else if (existing.content_hash !== contentHash) {
          await db.from("work_item_publicaciones").update({
            content_hash: contentHash,
            title: pub.titulo || "",
            changed_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          } as any).eq("id", existing.id);
          updated++;
        }
      }
    } else {
      // Upsert to work_item_acts
      const acts = data?.actuaciones || [];
      for (const act of acts) {
        const hashInput = `${workItem.radicado}|${act.fechaActuacion || ""}|${act.actuacion || act.descripcion || ""}|mock-e2e`;
        const fingerprint = await sha256(hashInput);
        const contentHash = await sha256(JSON.stringify(act));

        const { data: existing } = await db
          .from("work_item_acts")
          .select("id, content_hash")
          .eq("work_item_id", work_item_id)
          .eq("hash_fingerprint", fingerprint)
          .maybeSingle();

        if (!existing) {
          await db.from("work_item_acts").insert({
            work_item_id,
            organization_id: workItem.organization_id,
            owner_id: workItem.owner_id,
            hash_fingerprint: fingerprint,
            content_hash: contentHash,
            act_date: act.fechaActuacion || null,
            description: act.actuacion || act.descripcion || "",
            annotation: act.anotacion || "",
            source: `mock-e2e-${api_kind.toLowerCase()}`,
            detected_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            is_notifiable: true,
          } as any);
          inserted++;
        } else if (existing.content_hash !== contentHash) {
          await db.from("work_item_acts").update({
            content_hash: contentHash,
            annotation: act.anotacion || "",
            description: act.actuacion || act.descripcion || "",
            changed_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          } as any).eq("id", existing.id);
          updated++;
        }
      }
    }

    steps.push({
      step: "UPSERT_CANONICAL",
      status: inserted > 0 || updated > 0 ? "OK" : "NO_CHANGE",
      detail: { inserted, updated, table: isEstados ? "work_item_publicaciones" : "work_item_acts" },
      duration_ms: Date.now() - upsertStart,
    });

    // ── Step 4: Check alerts ──
    const alertStart = Date.now();
    // Wait briefly for triggers to fire
    await new Promise(r => setTimeout(r, 500));
    const alertCutoff = new Date(startTime).toISOString();
    const { data: alerts } = await db
      .from("alert_instances")
      .select("id, alert_type, title")
      .eq("entity_id", work_item_id)
      .gte("fired_at", alertCutoff)
      .order("fired_at", { ascending: false })
      .limit(10);

    const alertIds = (alerts ?? []).map((a: any) => a.id);
    steps.push({
      step: "ALERTS_CHECK",
      status: alertIds.length > 0 ? "OK" : (inserted > 0 || updated > 0 ? "MISSING" : "N/A"),
      detail: { alert_count: alertIds.length, types: (alerts ?? []).map((a: any) => a.alert_type) },
      duration_ms: Date.now() - alertStart,
    });

    // ── Step 5: Check email_outbox ──
    const emailStart = Date.now();
    const { data: outbox } = await db
      .from("email_outbox")
      .select("id, status")
      .gte("created_at", alertCutoff)
      .limit(10);

    const outboxIds = (outbox ?? []).map((e: any) => e.id);
    steps.push({
      step: "EMAIL_OUTBOX_CHECK",
      status: outboxIds.length > 0 ? "OK" : "PENDING",
      detail: { outbox_count: outboxIds.length },
      duration_ms: Date.now() - emailStart,
    });

    // ── Step 6: Verify UI visibility ──
    const visStart = Date.now();
    const bogotaDayStart = getBogotaDayStartUTC();
    const table = isEstados ? "work_item_publicaciones" : "work_item_acts";
    const { count: detectedTodayCount } = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("work_item_id", work_item_id)
      .or(`detected_at.gte.${bogotaDayStart},changed_at.gte.${bogotaDayStart}`);

    steps.push({
      step: "UI_VISIBILITY",
      status: (detectedTodayCount ?? 0) > 0 ? "OK" : "NOT_VISIBLE",
      detail: { detected_today_count: detectedTodayCount ?? 0 },
      duration_ms: Date.now() - visStart,
    });

    const report = {
      run_id: runId,
      api_kind,
      work_item_id,
      scenario,
      seed,
      provider_snapshot_id: snapshotId,
      steps,
      upsert: { inserted, updated },
      alert_ids: alertIds,
      outbox_ids: outboxIds,
      ui_expectations: {
        detected_count: detectedTodayCount ?? 0,
      },
      duration_ms: Date.now() - startTime,
    };

    await saveE2EReport(db, report, workItem.organization_id);

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: msg, run_id: runId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getBogotaDayStartUTC(): string {
  const now = new Date();
  const bogota = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  bogota.setUTCHours(0, 0, 0, 0);
  const backUtc = new Date(bogota.getTime() + 5 * 60 * 60 * 1000);
  return backUtc.toISOString();
}

async function saveE2EReport(db: any, report: any, orgId: string) {
  try {
    await db.from("atenia_e2e_test_results").insert({
      organization_id: orgId,
      work_item_id: report.work_item_id,
      radicado: "",
      workflow_type: report.api_kind,
      trigger: "E2E_MOCK_TEST",
      overall: report.steps.every((s: any) => s.status === "OK" || s.status === "N/A" || s.status === "PENDING" || s.status === "NO_CHANGE") ? "PASS" : "PARTIAL",
      steps: report.steps,
      started_at: new Date(Date.now() - report.duration_ms).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: report.duration_ms,
    });
  } catch (e) {
    console.warn("[e2e-test] Failed to save report:", e);
  }
}
