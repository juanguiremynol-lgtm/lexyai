/**
 * provider-sync-external-provider — Runtime ingestion pipeline for external providers.
 *
 * Pipeline stages (traced):
 *   SNAPSHOT_FETCHED → RAW_SAVED → MAPPING_APPLIED → UPSERTED_CANONICAL →
 *   PROVENANCE_WRITTEN → EXTRAS_WRITTEN → TERMINAL
 *
 * Invariants enforced:
 *   - Raw snapshot saved for EVERY run (OK/PENDING/EMPTY/ERROR)
 *   - SCRAPING_PENDING never sets last_synced_at
 *   - EMPTY increments consecutive_failures, NOT consecutive_404_count
 *   - OK resets both counters to 0
 *   - Mapping spec loaded (ORG_PRIVATE > GLOBAL > identity); missing = BLOCK
 *   - Extras from unmapped fields stored in work_item_act_extras / work_item_pub_extras
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret } from "../_shared/secretsCrypto.ts";
import {
  safeFetchProvider,
  buildAuthHeaders,
  type ProviderInstanceInfo,
  type ProviderSecurityWarning,
} from "../_shared/externalProviderClient.ts";
import {
  isTransientError,
  DEMONITOR_ELIGIBLE_ERROR_CODES,
  PROVIDER_EMPTY_RESULT,
  retryJitterMs,
  normalizeProviderErrorCode,
  isStrict404Code,
  reclassifyWithContext,
} from "../_shared/syncPolicy.ts";
import { normalizeActuaciones, normalizePublicaciones } from "../_shared/providerNormalize.ts";
import {
  validateSnapshotAgainstContract,
  applyMappingSpec,
  computeDedupeKeys,
  IDENTITY_MAPPING_SPEC,
  type MappingSpec,
} from "../_shared/mappingEngine.ts";
import { parseSnapshot } from "../_shared/snapshotParser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^\\x/, "");
  return new Uint8Array(clean.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

/** Parse bytea value from Supabase — handles both hex strings and JSON-serialized Uint8Array */
function parseBytea(val: unknown): Uint8Array {
  if (typeof val === "string") {
    return hexToBytes(val);
  }
  // JSON-serialized Uint8Array: {"0":63,"1":22,...}
  if (val && typeof val === "object" && !ArrayBuffer.isView(val)) {
    const obj = val as Record<string, number>;
    const keys = Object.keys(obj).map(Number).sort((a, b) => a - b);
    return new Uint8Array(keys.map(k => obj[String(k)]));
  }
  if (val instanceof Uint8Array) return val;
  throw new Error("Cannot parse bytea value");
}

async function hashPayload(payload: unknown): Promise<string> {
  const text = JSON.stringify(payload);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
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
    // First try direct instance from source
    let instance: any;
    const { data: directInstance } = await db
      .from("provider_instances")
      .select("*, provider_connectors(*)")
      .eq("id", source.provider_instance_id)
      .single();

    instance = directInstance;

    // If no direct instance found, try resolving PLATFORM instance for this connector
    if (!instance) {
      // Check if there's a platform-scoped instance for the connector referenced in this source
      const { data: platformInstance } = await db
        .from("provider_instances")
        .select("*, provider_connectors(*)")
        .eq("connector_id", source.connector_id || "")
        .eq("scope", "PLATFORM")
        .eq("is_enabled", true)
        .maybeSingle();

      instance = platformInstance;
    }

    if (!instance) {
      await writeTrace(db, runId, source, { id: source.provider_instance_id || "unknown" }, "SNAPSHOT_FETCHED", "ERROR", false, 0, {
        error: "Instance not found. For GLOBAL routes, ensure a PLATFORM instance exists.",
        skip_reason: "MISSING_PLATFORM_INSTANCE",
      });
      return new Response(JSON.stringify({ error: "Instance not found", skip_reason: "MISSING_PLATFORM_INSTANCE" }), {
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

    const connector = instance.provider_connectors;

    // ── Secret Resolution (first-class invariant) ──
    // For PLATFORM instances, secrets have scope=PLATFORM and no org_id
    const { data: secretRow } = await db
      .from("provider_instance_secrets")
      .select("id, cipher_text, nonce, is_active, key_version, scope")
      .eq("provider_instance_id", instance.id)
      .eq("is_active", true)
      .order("key_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Write detailed resolution trace (never log secrets)
    const resolutionPayload = {
      connector_id: instance.connector_id,
      connector_key: connector?.key || "unknown",
      instance_id: instance.id,
      instance_scope: instance.scope || "UNKNOWN",
      instance_enabled: instance.is_enabled,
      secret_id: secretRow?.id || null,
      secret_enabled: secretRow?.is_active || false,
      secret_version: secretRow?.key_version || null,
      secret_scope: secretRow?.scope || null,
      resolution_source: instance.scope === "PLATFORM" ? "GLOBAL_ROUTE_PLATFORM_INSTANCE" : "ORG_OVERRIDE_ORG_INSTANCE",
      auth_mode: instance.auth_type,
      secret_present: !!secretRow,
    };
    await writeTrace(db, runId, source, instance, "SECRET_RESOLUTION", secretRow ? "OK" : "MISSING_PROVIDER_SECRET", !!secretRow, 0, resolutionPayload);

    if (!secretRow) {
      // Terminal: MISSING_PROVIDER_SECRET — do NOT attempt external fetch
      await writeTrace(db, runId, source, instance, "SECRET_MISSING", "MISSING_PROVIDER_SECRET", false, 0, {
        remediation: "No hay secreto activo para esta instancia. Configure una API key en el Wizard (Instancia → Secretos) y habilítela.",
        instance_id: instance.id,
        instance_scope: instance.scope,
        connector_key: connector?.key,
      });

      await updateSourceError(db, source.id, "MISSING_PROVIDER_SECRET",
        "No hay secreto activo para esta instancia. Configure una API key en el Wizard.");

      if (instance.scope === "PLATFORM") {
        const alertFingerprint = `missing_secret_${instance.connector_id}_${instance.scope}`;
        await db.from("alert_instances").upsert({
          entity_type: "provider_instance",
          entity_id: instance.id,
          organization_id: source.organization_id,
          owner_id: instance.created_by || source.organization_id,
          severity: "CRITICAL",
          title: "🔑 Secreto faltante en instancia de plataforma",
          message: `La instancia PLATFORM "${instance.name}" (conector: ${connector?.key}) no tiene secreto activo. Todas las organizaciones están afectadas.`,
          status: "PENDING",
          fired_at: new Date().toISOString(),
          alert_type: "MISSING_PROVIDER_SECRET",
          alert_source: "provider-sync-external-provider",
          fingerprint: alertFingerprint,
        }, { onConflict: "fingerprint", ignoreDuplicates: true });

        const dedupeKey = `${instance.connector_id}_${instance.scope}_missing_secret`;
        await db.from("atenia_ai_remediation_queue").upsert({
          action_type: "CONFIGURE_PROVIDER_SECRET",
          organization_id: source.organization_id,
          work_item_id: source.work_item_id,
          provider: connector?.key || "unknown",
          reason_code: "MISSING_PROVIDER_SECRET",
          payload: {
            instance_id: instance.id,
            instance_name: instance.name,
            connector_key: connector?.key,
            scope: instance.scope,
            remediation: "Configure API key via Platform Wizard → StepInstance",
          },
          priority: 1,
          status: "PENDING",
          dedupe_key: dedupeKey,
        }, { onConflict: "dedupe_key", ignoreDuplicates: true });
      }

      await writeTrace(db, runId, source, instance, "TERMINAL", "MISSING_PROVIDER_SECRET", false, Date.now() - startTime, {
        outcome: "MISSING_PROVIDER_SECRET",
        scope: instance.scope,
      });

      return new Response(JSON.stringify({
        ok: false,
        code: "MISSING_PROVIDER_SECRET",
        message: "No hay secreto activo para esta instancia. Configure una API key en el Wizard.",
        instance_id: instance.id,
        instance_scope: instance.scope,
        duration_ms: Date.now() - startTime,
      }), {
        status: 424,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Secret loaded successfully
    const decrypted = await decryptSecret(parseBytea(secretRow.cipher_text), parseBytea(secretRow.nonce));
    
    await writeTrace(db, runId, source, instance, "SECRET_LOADED", "OK", true, 0, {
      secret_id: secretRow.id,
      key_version: secretRow.key_version,
      auth_mode: instance.auth_type,
      secret_present: true,
    });
    const providerInfo: ProviderInstanceInfo = {
      id: instance.id,
      base_url: instance.base_url,
      auth_type: instance.auth_type,
      timeout_ms: instance.timeout_ms,
      rpm_limit: instance.rpm_limit,
      allowed_domains: connector?.allowed_domains || [],
    };

    // ── Stage 1: SNAPSHOT_FETCHED ──
    const snapshotUrl = `${instance.base_url.replace(/\/$/, "")}/snapshot`;
    // Determine what data this connector provides based on capabilities
    const caps: string[] = connector?.capabilities || ["ACTUACIONES"];
    const isEstadosProvider = caps.includes("get_estados");
    const includeParam = isEstadosProvider ? ["ESTADOS"] : caps.filter((c: string) => ["ACTUACIONES", "PUBLICACIONES", "ESTADOS"].includes(c.toUpperCase()));
    if (includeParam.length === 0) includeParam.push("ACTUACIONES");

    const snapshotBody = JSON.stringify({
      provider_case_id: source.provider_case_id,
      since: source.last_synced_at || null,
      include: includeParam,
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
    const securityWarnings: ProviderSecurityWarning[] = [];
    try {
      snapRes = await safeFetchProvider({
        url: snapshotUrl,
        allowlist: providerInfo.allowed_domains,
        init: { method: "POST", headers, body: snapshotBody },
        timeoutMs: providerInfo.timeout_ms,
        onSecurityWarning: (w) => securityWarnings.push(w),
      });
    } catch (fetchErr: unknown) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      const snapLatency = Date.now() - snapStart;
      // Save raw snapshot even on fetch error
      await saveRawSnapshot(db, source, instance, connector, null, "ERROR", snapRes?.status ?? 0, snapLatency, "FETCH_ERROR");
      await updateSourceError(db, source.id, "FETCH_ERROR", errMsg);
      await writeTrace(db, runId, source, instance, "SNAPSHOT_FETCHED", "ERROR", false, snapLatency, { error: errMsg });
      return new Response(
        JSON.stringify({ ok: false, error: errMsg, duration_ms: Date.now() - startTime }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const snapLatency = Date.now() - snapStart;
    // Read response as text first (supports both JSON and TEXT snapshots)
    const rawBodyText = await snapRes.text().catch(() => "");
    const contentTypeHeader = snapRes.headers.get("content-type") || "";

    // Parse using schema-tolerant snapshot parser
    const connectorCaps = connector?.capabilities || [];
    const parsedResult = parseSnapshot(connectorCaps, rawBodyText, contentTypeHeader);
    
    // For backward compat: try to get JSON error codes from the raw body
    let snapData: Record<string, unknown> = {};
    try {
      snapData = JSON.parse(rawBodyText);
    } catch {
      // TEXT response — use parsed snapshot
      if (parsedResult.ok && parsedResult.snapshot) {
        snapData = parsedResult.snapshot as unknown as Record<string, unknown>;
      }
    }

    await writeTrace(db, runId, source, instance, "SNAPSHOT_FETCHED", String(snapRes.status), true, snapLatency, {
      http_status: snapRes.status,
      snapshot_format: parsedResult.format,
      parse_ok: parsedResult.ok,
      parse_warnings: parsedResult.warnings.length,
      has_estados: !!(snapData.estados || parsedResult.snapshot?.estados?.length),
      has_actuaciones: !!(snapData.actuaciones || parsedResult.snapshot?.actuaciones?.length),
      has_publicaciones: !!(snapData.publicaciones || parsedResult.snapshot?.publicaciones),
      is_estados_provider: isEstadosProvider,
    });

    // ── Stage 2: RAW_SAVED — always persist raw snapshot ──
    // Store raw body as-is (text or json) in payload field
    const rawPayloadForStorage = parsedResult.format === "JSON" ? snapData : { _raw_text: rawBodyText, _parsed: parsedResult.snapshot };
    const rawErrorCode = snapData.code || snapData.error_code || null;
    const rawNormalized = normalizeProviderErrorCode(rawErrorCode as string, snapRes.status);

    // Context-aware reclassification: downgrade strict-404 to EMPTY when message/data
    // indicates the case exists but returned no events (e.g. CPNU "no actuaciones found")
    const reclassification = reclassifyWithContext(
      rawNormalized,
      (snapData.message || snapData.error) as string,
      snapData,
    );
    const normalizedCode = reclassification.code;

    // Handle unparseable TEXT snapshots
    if (!parsedResult.ok && parsedResult.format === "UNKNOWN" && snapRes.ok) {
      const snapshotId = await saveRawSnapshot(db, source, instance, connector, rawPayloadForStorage, "ERROR", snapRes.status, snapLatency, "PROVIDER_UNPARSABLE_SNAPSHOT");
      await writeTrace(db, runId, source, instance, "RAW_SAVED", "ERROR", true, 0, { snapshot_id: snapshotId });
      await writeTrace(db, runId, source, instance, "TERMINAL", "PROVIDER_UNPARSABLE_SNAPSHOT", false, Date.now() - startTime, {
        outcome: "ERROR",
        parse_warnings: parsedResult.warnings,
        format_detected: parsedResult.format,
      });
      await updateSourceError(db, source.id, "PROVIDER_UNPARSABLE_SNAPSHOT", `Could not parse snapshot: ${parsedResult.warnings.join("; ")}`);
      return new Response(
        JSON.stringify({ ok: false, code: "PROVIDER_UNPARSABLE_SNAPSHOT", warnings: parsedResult.warnings, duration_ms: Date.now() - startTime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Use parsed snapshot data for acts/pubs extraction
    const effectiveData = parsedResult.ok && parsedResult.snapshot
      ? parsedResult.snapshot
      : snapData;

    // Determine outcome for raw snapshot status
    let rawStatus = "OK";
    if (!snapRes.ok || snapData.ok !== true) rawStatus = "ERROR";
    if (snapData.scraping_initiated || isTransientError(normalizedCode)) rawStatus = "PENDING";
    // Extract data — SAMAI Estados returns "estados" key, not "actuaciones"
    // Estados are legally distinct from actuaciones but stored in work_item_acts
    // with source='SAMAI_ESTADOS' and act_type='ESTADO' for proper differentiation
    const rawEstados = (effectiveData as any).estados || [];
    const rawActuaciones = (effectiveData as any).actuaciones || [];
    // If this is an estados provider, use estados data; otherwise use actuaciones
    const acts = isEstadosProvider && rawEstados.length > 0 ? rawEstados : rawActuaciones;
    const pubs = (effectiveData as any).publicaciones || [];
    if (snapRes.ok && (snapData.ok === true || parsedResult.ok) && acts.length === 0 && pubs.length === 0) rawStatus = "EMPTY";
    if (isStrict404Code(normalizedCode)) rawStatus = "ERROR";

    const snapshotId = await saveRawSnapshot(db, source, instance, connector, rawPayloadForStorage, rawStatus, snapRes.status, snapLatency, rawStatus === "ERROR" ? normalizedCode : null);
    await writeTrace(db, runId, source, instance, "RAW_SAVED", rawStatus, true, 0, {
      snapshot_id: snapshotId,
      format: parsedResult.format,
      parse_warnings: parsedResult.warnings,
      reclassified: reclassification.reclassified,
      classification_reason: reclassification.reason,
      raw_normalized_code: rawNormalized,
      final_normalized_code: normalizedCode,
    });

    // ── Outcome routing ──

    // D) Strict 404
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

      await writeTrace(db, runId, source, instance, "TERMINAL", normalizedCode, false, Date.now() - startTime, { outcome: "STRICT_404" });
      return new Response(
        JSON.stringify({ ok: false, code: normalizedCode, duration_ms: Date.now() - startTime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // C) Scraping pending / transient
    const isPending = snapData.scraping_initiated === true || isTransientError(normalizedCode);
    if (isPending) {
      const transientCode = isTransientError(normalizedCode) ? normalizedCode : "SCRAPING_PENDING";
      await db
        .from("work_item_sources")
        .update({
          scrape_status: "SCRAPING_PENDING",
          last_error_code: transientCode,
          last_error_message: snapData.message || "Scraping in progress",
          last_provider_latency_ms: snapLatency,
          // Do NOT set last_synced_at
        })
        .eq("id", source.id);

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

      await writeTrace(db, runId, source, instance, "TERMINAL", transientCode, false, Date.now() - startTime, {
        outcome: "SCRAPING_PENDING",
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

    // Generic error
    if (!snapRes.ok || snapData.ok !== true) {
      const errCode = normalizedCode !== "PROVIDER_ERROR" ? normalizedCode : (rawErrorCode || "PROVIDER_ERROR");
      await updateSourceError(db, source.id, errCode, snapData.message || `HTTP ${snapRes.status}`);
      await writeTrace(db, runId, source, instance, "TERMINAL", errCode, false, Date.now() - startTime, { outcome: "ERROR" });
      return new Response(
        JSON.stringify({ ok: false, code: errCode, duration_ms: Date.now() - startTime }),
        { status: snapRes.status >= 400 ? snapRes.status : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // B) Empty result
    if (acts.length === 0 && pubs.length === 0) {
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

      await writeTrace(db, runId, source, instance, "TERMINAL", PROVIDER_EMPTY_RESULT, true, Date.now() - startTime, {
        outcome: "EMPTY",
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

    // ── Stage 3: MAPPING_APPLIED — resolve effective mapping spec ──
    const connectorId = connector?.id;
    const effectiveSpec = await resolveEffectiveMapping(db, connectorId, source.organization_id, connector);

    if (!effectiveSpec) {
      // BLOCK: No active mapping spec and connector doesn't emit canonical v1
      await writeTrace(db, runId, source, instance, "MAPPING_APPLIED", "MAPPING_MISSING_BLOCK", false, 0, {
        connector_id: connectorId,
        connector_emits_canonical: connector?.emits_canonical_v1 ?? false,
      });
      await writeTrace(db, runId, source, instance, "TERMINAL", "MAPPING_MISSING_BLOCK", false, Date.now() - startTime, {
        outcome: "BLOCK",
        reason: "No active mapping spec. Raw snapshot saved.",
      });

      await db
        .from("work_item_sources")
        .update({
          scrape_status: "ERROR",
          last_error_code: "MAPPING_SPEC_MISSING",
          last_error_message: "No active mapping spec found. Configure mapping before syncing.",
          last_provider_latency_ms: snapLatency,
        })
        .eq("id", source.id);

      return new Response(
        JSON.stringify({
          ok: false,
          code: "MAPPING_SPEC_MISSING",
          message: "Raw snapshot saved but no mapping spec available to normalize data.",
          snapshot_id: snapshotId,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate + apply mapping
    const validation = validateSnapshotAgainstContract(snapData, connector?.schema_version || "v1");
    const mappingResult = applyMappingSpec(snapData, effectiveSpec);

    await writeTrace(db, runId, source, instance, "MAPPING_APPLIED", "OK", true, 0, {
      canonical_acts: mappingResult.canonicalActs.length,
      canonical_pubs: mappingResult.canonicalPubs.length,
      extras_keys: Object.keys(mappingResult.extrasByKey).length,
      warnings: mappingResult.mappingWarnings.length,
      validation_ok: validation.ok,
    });

    // ── Stage 4: UPSERTED_CANONICAL ──
    const provenance = {
      provider_instance_id: instance.id,
      provider_case_id: source.provider_case_id || "",
      source_url: source.source_url,
      retrieved_at: new Date().toISOString(),
    };

    let insertedActs = 0;
    let insertedPubs = 0;
    const insertedActIds: string[] = [];
    const insertedPubIds: string[] = [];

    if (acts.length > 0) {
      const normalized = await normalizeActuaciones(
        acts, provenance, workItem.id, workItem.owner_id, workItem.organization_id,
      );
      // Tag estados records with proper source and type for differentiation
      if (isEstadosProvider) {
        for (const record of normalized) {
          record.source = "SAMAI_ESTADOS";
          record.act_type = "ESTADO";
          record.source_platform = "SAMAI_ESTADOS";
        }
      }
      const { data: inserted } = await db
        .from("work_item_acts")
        .upsert(normalized, { onConflict: "hash_fingerprint", ignoreDuplicates: true })
        .select("id");
      insertedActs = inserted?.length || 0;
      if (inserted) insertedActIds.push(...inserted.map((r: any) => r.id));
    }

    if (pubs.length > 0) {
      const normalized = await normalizePublicaciones(
        pubs, provenance, workItem.id, workItem.owner_id, workItem.organization_id,
      );
      const { data: inserted } = await db
        .from("work_item_publicaciones")
        .upsert(normalized, { onConflict: "hash_fingerprint", ignoreDuplicates: true })
        .select("id");
      insertedPubs = inserted?.length || 0;
      if (inserted) insertedPubIds.push(...inserted.map((r: any) => r.id));
    }

    await writeTrace(db, runId, source, instance, "UPSERTED_CANONICAL", "OK", true, 0, {
      acts_upserted: insertedActs,
      pubs_upserted: insertedPubs,
    });

    // ── Stage 5: PROVENANCE_WRITTEN ──
    const provenanceRows: any[] = [];
    for (const actId of insertedActIds) {
      provenanceRows.push({
        work_item_act_id: actId,
        provider_instance_id: instance.id,
        provider_event_id: null,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      });
    }
    if (provenanceRows.length > 0) {
      await db.from("act_provenance").upsert(provenanceRows, {
        onConflict: "work_item_act_id,provider_instance_id",
        ignoreDuplicates: true,
      });
    }
    await writeTrace(db, runId, source, instance, "PROVENANCE_WRITTEN", "OK", true, 0, {
      act_provenance_rows: provenanceRows.length,
    });

    // ── Stage 6: EXTRAS_WRITTEN ──
    const extrasKeys = Object.keys(mappingResult.extrasByKey);
    let extrasWritten = 0;
    if (extrasKeys.length > 0 && insertedActIds.length > 0) {
      // Write extras for each act that has unmapped fields
      const extrasRows = insertedActIds.slice(0, extrasKeys.length).map((actId, i) => ({
        work_item_act_id: actId,
        extras: mappingResult.extrasByKey[extrasKeys[i]] || {},
      }));
      if (extrasRows.length > 0) {
        await db.from("work_item_act_extras").upsert(extrasRows, {
          onConflict: "work_item_act_id",
          ignoreDuplicates: false,
        });
        extrasWritten = extrasRows.length;
      }
    }
    await writeTrace(db, runId, source, instance, "EXTRAS_WRITTEN", "OK", true, 0, {
      extras_rows_written: extrasWritten,
    });

    // ── TERMINAL: OK ──
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

    if (securityWarnings.length > 0) {
      await writeTrace(db, runId, source, instance, "SECURITY", "WARN", true, 0, { warnings: securityWarnings });
    }

    const dataKindLabel = isEstadosProvider ? "estados" : "actuaciones";

    await writeTrace(db, runId, source, instance, "TERMINAL", "OK", true, Date.now() - startTime, {
      outcome: "OK",
      data_kind: dataKindLabel,
      [`${dataKindLabel}_received`]: acts.length,
      [`${dataKindLabel}_inserted`]: insertedActs,
      publicaciones_received: pubs.length,
      publicaciones_inserted: insertedPubs,
      extras_written: extrasWritten,
      snapshot_id: snapshotId,
    });

    // Audit action
    await db.from("atenia_ai_actions").insert({
      organization_id: source.organization_id,
      action_type: "PROVIDER_SYNC_COMPLETED",
      autonomy_tier: "SYSTEM",
      reasoning: `Synced ${insertedActs} ${dataKindLabel} + ${insertedPubs} publicaciones from "${instance.name}"`,
      target_entity_type: "work_item_source",
      target_entity_id: source.id,
      evidence: {
        work_item_id: workItem.id,
        provider_instance_id: instance.id,
        data_kind: dataKindLabel,
        [`${dataKindLabel}_received`]: acts.length,
        [`${dataKindLabel}_inserted`]: insertedActs,
        publicaciones_received: pubs.length,
        publicaciones_inserted: insertedPubs,
        extras_written: extrasWritten,
        latency_ms: snapLatency,
        duration_ms: Date.now() - startTime,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        data_kind: dataKindLabel,
        [`inserted_${dataKindLabel}`]: insertedActs,
        inserted_publicaciones: insertedPubs,
        extras_written: extrasWritten,
        snapshot_id: snapshotId,
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

async function saveRawSnapshot(
  db: any, source: any, instance: any, connector: any, payload: unknown,
  status: string, httpStatus: number, latencyMs: number, errorCode: string | null,
): Promise<string> {
  const id = crypto.randomUUID();
  const payloadHash = payload ? await hashPayload(payload) : "empty";
  await db.from("provider_raw_snapshots").insert({
    id,
    organization_id: source.organization_id,
    work_item_id: source.work_item_id,
    provider_instance_id: instance.id,
    connector_id: connector?.id || null,
    scope: "BOTH",
    provider_case_id: source.provider_case_id || "",
    fetched_at: new Date().toISOString(),
    payload: payload || {},
    payload_hash: payloadHash,
    status,
    normalized_error_code: errorCode,
    http_status: httpStatus,
    latency_ms: latencyMs,
  });
  return id;
}

async function resolveEffectiveMapping(
  db: any, connectorId: string, orgId: string, connector: any,
): Promise<MappingSpec | null> {
  if (!connectorId) {
    // No connector → check if it emits canonical v1
    if (connector?.emits_canonical_v1) return IDENTITY_MAPPING_SPEC;
    return null;
  }

  // 1. Try ORG_PRIVATE ACTIVE for this org
  if (orgId) {
    const { data: orgSpec } = await db
      .from("provider_mapping_specs")
      .select("spec")
      .eq("provider_connector_id", connectorId)
      .eq("visibility", "ORG_PRIVATE")
      .eq("organization_id", orgId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (orgSpec) return orgSpec.spec as MappingSpec;
  }

  // 2. Try GLOBAL ACTIVE
  const { data: globalSpec } = await db
    .from("provider_mapping_specs")
    .select("spec")
    .eq("provider_connector_id", connectorId)
    .eq("visibility", "GLOBAL")
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (globalSpec) return globalSpec.spec as MappingSpec;

  // 3. Connector emits canonical v1 → use identity
  if (connector?.emits_canonical_v1) return IDENTITY_MAPPING_SPEC;

  return null;
}

async function updateSourceError(db: any, sourceId: string, code: string, message: string) {
  await db
    .from("work_item_sources")
    .update({
      scrape_status: "ERROR",
      last_error_code: code,
      last_error_message: message,
    })
    .eq("id", sourceId);
}

async function writeTrace(
  db: any, runId: string, source: any, instance: any,
  stage: string, resultCode: string, ok: boolean, latencyMs: number, payload: unknown,
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
