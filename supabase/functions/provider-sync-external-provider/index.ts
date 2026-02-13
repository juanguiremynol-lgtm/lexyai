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
import { normalizeActuaciones, normalizePublicaciones, translateSamaiFormat } from "../_shared/providerNormalize.ts";
import {
  validateSnapshotAgainstContract,
  applyMappingSpec,
  computeDedupeKeys,
  IDENTITY_MAPPING_SPEC,
  type MappingSpec,
} from "../_shared/mappingEngine.ts";
import { parseSnapshot } from "../_shared/snapshotParser.ts";
import { resolveActiveSecret } from "../_shared/resolveActiveSecret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
};

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

    // ── Secret Resolution (single source of truth via shared resolver) ──
    // Import key mode diagnostics
    const { getKeyDerivationMode } = await import("../_shared/cryptoKey.ts");
    let platformKeyMode = "UNAVAILABLE";
    try { platformKeyMode = getKeyDerivationMode(); } catch { /* */ }

    const secretResult = await resolveActiveSecret(db, instance.id);

    // Write SECRET_RESOLUTION trace (Deliverable C) — never log secrets
    const resolutionPayload = {
      connector_id: instance.connector_id,
      connector_key: connector?.key || "unknown",
      instance_id: instance.id,
      instance_scope: instance.scope || "UNKNOWN",
      instance_enabled: instance.is_enabled,
      secret_present: secretResult.ok,
      resolution_source: instance.scope === "PLATFORM" ? "GLOBAL_ROUTE_PLATFORM_INSTANCE" : "ORG_OVERRIDE_ORG_INSTANCE",
      auth_mode: instance.auth_type,
      failure_reason: secretResult.ok ? null : secretResult.failure_reason,
      platform_key_mode: platformKeyMode,
      decrypt_ok: secretResult.ok,
      secret_id: secretResult.ok ? secretResult.secret_id : null,
    };
    await writeTrace(db, runId, source, instance, "SECRET_RESOLUTION",
      secretResult.ok ? "OK" : secretResult.failure_reason, secretResult.ok, 0, resolutionPayload);

    if (!secretResult.ok) {
      // Terminal: hard-fail with typed error code BEFORE any external fetch
      const failCode = secretResult.failure_reason;
      const remediationHint = failCode === "DECRYPT_FAILED" 
        ? "Re-encripte el secreto con la clave actual en el Wizard (Instancia → Estado del Secreto → 'Re-encriptar')."
        : "Configure una API key activa en el Wizard (Instancia → Secretos).";
      
      await writeTrace(db, runId, source, instance, "SECRET_MISSING", failCode, false, 0, {
        remediation: remediationHint,
        instance_id: instance.id,
        instance_scope: instance.scope,
        connector_key: connector?.key,
        failure_detail: secretResult.detail,
        platform_key_mode: platformKeyMode,
      });

      await updateSourceError(db, source.id, failCode, secretResult.detail);

      if (instance.scope === "PLATFORM") {
        const alertFingerprint = failCode === "DECRYPT_FAILED" 
          ? `decrypt_failed_${instance.connector_id}_${instance.scope}`
          : `missing_secret_${instance.connector_id}_${instance.scope}`;
        
        const alertTitle = failCode === "DECRYPT_FAILED"
          ? "🔐 Secreto no descifrable en instancia de plataforma"
          : "🔑 Secreto faltante en instancia de plataforma";
        
        const alertMessage = failCode === "DECRYPT_FAILED"
          ? `La instancia PLATFORM "${instance.name}" (conector: ${connector?.key}) no puede descifrarse con la clave actual. Re-encripte el secreto sin cambiar su valor.`
          : `La instancia PLATFORM "${instance.name}" (conector: ${connector?.key}) no tiene secreto activo. Error: ${failCode}.`;

        await db.from("alert_instances").upsert({
          entity_type: "provider_instance",
          entity_id: instance.id,
          organization_id: source.organization_id,
          owner_id: instance.created_by || source.organization_id,
          severity: "CRITICAL",
          title: alertTitle,
          message: alertMessage,
          status: "PENDING",
          fired_at: new Date().toISOString(),
          alert_type: failCode === "DECRYPT_FAILED" ? "PROVIDER_SECRET_DECRYPT_FAILED" : "MISSING_PROVIDER_SECRET",
          alert_source: "provider-sync-external-provider",
          fingerprint: alertFingerprint,
        }, { onConflict: "fingerprint", ignoreDuplicates: true });
      }

      await writeTrace(db, runId, source, instance, "TERMINAL", failCode, false, Date.now() - startTime, {
        outcome: failCode,
        scope: instance.scope,
        platform_key_mode: platformKeyMode,
      });

      return new Response(JSON.stringify({
        ok: false,
        code: failCode,
        message: secretResult.detail,
        instance_id: instance.id,
        instance_scope: instance.scope,
        platform_key_mode: platformKeyMode,
        duration_ms: Date.now() - startTime,
      }), {
        status: 424,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Secret loaded and decrypted successfully — typed result
    const decryptedSecret: string = secretResult.decrypted_value;

    await writeTrace(db, runId, source, instance, "SECRET_LOADED", "OK", true, 0, {
      secret_id: secretResult.secret_id,
      key_version: secretResult.key_version,
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

    // Build request body — use adapter-aware field names based on connector capabilities
    // SAMAI Estados expects "radicado" not "provider_case_id"
    const caps_set = new Set(caps.map((c: string) => c.toLowerCase()));
    const useRadicadoField = caps_set.has("search_by_radicado") || connector?.key === "SAMAI_ESTADOS";
    const caseIdField = useRadicadoField ? "radicado" : "provider_case_id";
    const snapshotBodyObj: Record<string, unknown> = {
      [caseIdField]: source.provider_case_id,
      since: source.last_synced_at || null,
    };
    // Only include "include" param if the provider uses it (Estados providers)
    if (isEstadosProvider) {
      snapshotBodyObj.include = includeParam;
    }
    const snapshotBody = JSON.stringify(snapshotBodyObj);
    const headers = await buildAuthHeaders({
      instance: providerInfo,
      decryptedSecret: decryptedSecret,
      method: "POST",
      path: "/snapshot",
      body: snapshotBody,
      orgId: source.organization_id,
    });

    // ── Trace: EXT_PROVIDER_REQUEST — includes header names and redacted request body ──
    const redactedUrl = new URL(snapshotUrl);
    const headerNames = Object.keys(headers).sort();
    // Redacted request body: replace secret values but keep structure
    const redactedRequestBody = JSON.parse(snapshotBody);
    await writeTrace(db, runId, source, instance, "EXT_PROVIDER_REQUEST", "SENT", true, 0, {
      url_host: redactedUrl.hostname,
      url_path: redactedUrl.pathname,
      method: "POST",
      header_names: headerNames,
      auth_type: instance.auth_type,
      timeout_ms: providerInfo.timeout_ms,
      include: includeParam,
      provider_case_id: source.provider_case_id,
      request_body: redactedRequestBody,
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
      await writeTrace(db, runId, source, instance, "EXT_PROVIDER_RESPONSE", "ERROR", false, snapLatency, {
        error: errMsg,
        status_code: 0,
        body_kind: "NONE",
        bytes_length: 0,
      });
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

    // ── Trace: EXT_PROVIDER_RESPONSE — now captures redacted error body for 4xx/5xx ──
    const bodyKind = contentTypeHeader.includes("json") ? "JSON" : "TEXT";
    // Redact error body: first 4KB, strip any strings that look like secrets/keys
    const redactedSnippet = (() => {
      if (snapRes.ok) return undefined;
      const snippet = rawBodyText.slice(0, 4096);
      // Redact common secret patterns (API keys, tokens, passwords)
      return snippet
        .replace(/(?:api[_-]?key|token|secret|password|authorization|bearer)\s*[:=]\s*["']?[^\s"',}{]{8,}["']?/gi, "[REDACTED]")
        .replace(/eyJ[A-Za-z0-9_-]{20,}/g, "[JWT_REDACTED]");
    })();
    await writeTrace(db, runId, source, instance, "EXT_PROVIDER_RESPONSE", String(snapRes.status), snapRes.ok, snapLatency, {
      status_code: snapRes.status,
      body_kind: bodyKind,
      bytes_length: rawBodyText.length,
      content_type: contentTypeHeader,
      ...(redactedSnippet ? { error_body_redacted: redactedSnippet } : {}),
    });

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
    // Consider response OK if HTTP was 2xx, even if snapData.ok is not explicitly true
    // Many providers (e.g., SAMAI Estados) return {error: null, actuaciones: [...]} without an explicit "ok" field
    const hasExplicitError = snapData.error && snapData.error !== null;
    if (!snapRes.ok || (snapData.ok === false) || hasExplicitError) rawStatus = "ERROR";
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

    // Generic error — only if HTTP failed or explicit ok=false or explicit error present
    if (!snapRes.ok || snapData.ok === false || hasExplicitError) {
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
      source_platform: isEstadosProvider ? "SAMAI_ESTADOS" : connector?.key || "unknown",
      data_kind: isEstadosProvider ? "estados" : "actuaciones",
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
    // Track ALL canonical IDs that this provider confirms (inserted + dedup-matched)
    const allConfirmedActIds: string[] = [];

    if (acts.length > 0) {
      // Translate SAMAI-format Spanish field names to canonical before normalization
      const isSamaiFormat = isEstadosProvider || 
        (acts[0] && (acts[0]["Actuación"] || acts[0]["Fecha Providencia"] || acts[0]["actuacion"]));
      const translatedActs = isSamaiFormat ? translateSamaiFormat(acts) : acts;

      const normalized = await normalizeActuaciones(
        translatedActs, provenance, workItem.id, workItem.owner_id, workItem.organization_id,
      );
      if (isEstadosProvider) {
        for (const record of normalized) {
          record.source = "SAMAI_ESTADOS";
          record.act_type = "ESTADO";
          record.source_platform = "SAMAI_ESTADOS";
        }
      }

      // ── Semantic dedup: match against existing canonical rows by (date, normalized_description) ──
      // This prevents duplicates when fingerprint schemes differ between built-in and external providers
      const { data: existingActs } = await db
        .from("work_item_acts")
        .select("id, act_date, description, hash_fingerprint")
        .eq("work_item_id", workItem.id)
        .eq("is_archived", false);

      // Build semantic set: normalize descriptions for fuzzy matching
      const normalizeForDedup = (desc: string) =>
        (desc || "").toLowerCase()
          .replace(/[\u2014\u2013—–]/g, "-")   // em/en dash → hyphen
          .replace(/\s+/g, " ")
          .replace(/[^\w\s\-áéíóúñü]/gi, "")
          .trim()
          .slice(0, 120);

      const existingSemanticSet = new Map<string, string>(); // semanticKey → canonical act ID
      const existingFpSet = new Set<string>();
      for (const existing of existingActs || []) {
        const semKey = `${existing.act_date || ""}|${normalizeForDedup(existing.description)}`;
        existingSemanticSet.set(semKey, existing.id);
        existingFpSet.add(existing.hash_fingerprint);
      }

      const toInsert: any[] = [];
      let semanticDedupCount = 0;
      let fpDedupCount = 0;

      for (const record of normalized) {
        // Check fingerprint-level dedup first
        if (existingFpSet.has(record.hash_fingerprint)) {
          fpDedupCount++;
          // Find canonical ID by fingerprint
          const matched = (existingActs || []).find((e: any) => e.hash_fingerprint === record.hash_fingerprint);
          if (matched) allConfirmedActIds.push(matched.id);
          continue;
        }
        // Check semantic dedup (date + normalized description)
        const semKey = `${record.act_date || ""}|${normalizeForDedup(record.description)}`;
        const matchedId = existingSemanticSet.get(semKey);
        if (matchedId) {
          semanticDedupCount++;
          allConfirmedActIds.push(matchedId);
          continue;
        }
        toInsert.push(record);
      }

      console.log(`[EXT_PROVIDER] Dedup: ${normalized.length} incoming, ${fpDedupCount} fp-matched, ${semanticDedupCount} semantic-matched, ${toInsert.length} genuinely new`);

      if (toInsert.length > 0) {
        const { data: inserted, error: upsertErr } = await db
          .from("work_item_acts")
          .upsert(toInsert, { onConflict: "work_item_id,hash_fingerprint", ignoreDuplicates: true })
          .select("id");
        if (upsertErr) {
          console.error(`[EXT_PROVIDER] Upsert error: ${upsertErr.message} (code: ${upsertErr.code})`);
        }
        insertedActs = inserted?.length || 0;
        if (inserted) {
          insertedActIds.push(...inserted.map((r: any) => r.id));
          allConfirmedActIds.push(...inserted.map((r: any) => r.id));
        }
      }
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
      acts_confirmed: allConfirmedActIds.length,
      source_platform: isEstadosProvider ? "SAMAI_ESTADOS" : connector?.key || "unknown",
      data_kind: isEstadosProvider ? "estados" : "actuaciones",
    });

    // ── Stage 5: PROVENANCE_WRITTEN ──
    // Write provenance for ALL confirmed canonical IDs (both newly inserted AND dedup-matched)
    // This ensures multi-source attribution works even when acts_upserted=0
    const now = new Date().toISOString();
    const provenanceRows: any[] = [];
    for (const actId of allConfirmedActIds) {
      provenanceRows.push({
        work_item_act_id: actId,
        provider_instance_id: instance.id,
        provider_event_id: null,
        first_seen_at: now,
        last_seen_at: now,
      });
    }
    let provenanceUpserted = 0;
    if (provenanceRows.length > 0) {
      // Use ignoreDuplicates: false so last_seen_at gets updated on re-runs
      const { data: provResult } = await db.from("act_provenance").upsert(provenanceRows, {
        onConflict: "work_item_act_id,provider_instance_id",
        ignoreDuplicates: false,
      }).select("id");
      provenanceUpserted = provResult?.length || provenanceRows.length;
    }
    await writeTrace(db, runId, source, instance, "PROVENANCE_WRITTEN", "OK", true, 0, {
      act_provenance_rows: provenanceRows.length,
      provenance_upserted: provenanceUpserted,
      provenance_from_dedup: allConfirmedActIds.length - insertedActIds.length,
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
      [`${dataKindLabel}_confirmed`]: allConfirmedActIds.length,
      provenance_upserted: provenanceUpserted,
      provenance_from_dedup: allConfirmedActIds.length - insertedActIds.length,
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

  // 4. Known connectors that return SAMAI-compatible format (actuaciones array with standard fields)
  // These use identity mapping since normalizeActuaciones handles the transformation
  const connectorKey = connector?.key || "";
  const caps: string[] = connector?.capabilities || [];
  if (connectorKey === "SAMAI_ESTADOS" || caps.includes("snapshot")) {
    return IDENTITY_MAPPING_SPEC;
  }

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
