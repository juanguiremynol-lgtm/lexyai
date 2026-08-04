/**
 * bridge-reconcile — iteration 20.
 *
 * The provider (GCP) is treated as the inventory of record. For each work item
 * we ask every provider in its chain what rows exist, compare the fingerprint
 * set against what actually landed in `work_item_acts` /
 * `work_item_publicaciones`, and record the outcome in
 * `public.bridge_inventory_ledger`.
 *
 * A missing row is never "no news": it is a transfer defect. When a gap is
 * detected the function re-runs the persistence path (self-healing bridge) and
 * re-counts. Whatever is still missing stays on the ledger with `first_gap_at`
 * so the age of the defect is auditable, and a platform alert fires once the
 * gap is older than 24h.
 *
 * States recorded per (work_item, provider, row_kind):
 *   IN_SYNC              — provider rows == local rows
 *   PROVIDER_NO_ROWS     — provider answered successfully with zero rows
 *   GAP                  — provider has rows we do not have
 *   TRANSFER_FAILED      — re-sync ran and rows still did not land
 *   PROVIDER_UNAVAILABLE — provider errored/timed out; nothing can be concluded
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  fetchFromCpnu,
  fetchFromPublicaciones,
  fetchFromSamai,
  fetchFromSamaiEstados,
  type ProviderAdapterResult,
} from "../_shared/providerAdapters/index.ts";

const PLATFORM_ORG = "a0000000-0000-0000-0000-000000000001";
const GAP_ALERT_HOURS = 24;

const CHAIN: Record<string, string[]> = {
  CGP: ["cpnu", "publicaciones"],
  LABORAL: ["cpnu", "publicaciones"],
  PENAL_906: ["cpnu", "publicaciones"],
  PENAL: ["cpnu", "publicaciones"],
  CPACA: ["samai", "samai_estados"],
  INDETERMINADO: ["cpnu", "publicaciones", "samai", "samai_estados"],
  TUTELA: ["cpnu", "samai", "publicaciones", "samai_estados"],
};

type TransferState =
  | "IN_SYNC" | "GAP" | "PROVIDER_NO_ROWS" | "TRANSFER_FAILED" | "PROVIDER_UNAVAILABLE";

interface LedgerLine {
  work_item_id: string;
  radicado: string;
  provider_key: string;
  row_kind: "ACT" | "PUB";
  provider_count: number;
  local_count: number;
  missing_count: number;
  recovered_count: number;
  transfer_state: TransferState;
  missing_fingerprints: string[];
  last_error: string | null;
}

async function callProvider(
  provider: string,
  radicado: string,
  workItemId: string,
  forceRefresh: boolean,
): Promise<ProviderAdapterResult | null> {
  const opts = {
    radicado,
    mode: "monitoring" as const,
    workItemId,
    timeoutMs: 45_000,
    forceRefresh,
    allowBuscar: true,
  };
  try {
    switch (provider) {
      case "cpnu": return await fetchFromCpnu(opts);
      case "publicaciones": return await fetchFromPublicaciones(opts);
      case "samai": return await fetchFromSamai(opts);
      case "samai_estados": return await fetchFromSamaiEstados(opts);
      default: return null;
    }
  } catch (err) {
    return {
      provider,
      status: "ERROR",
      actuaciones: [],
      publicaciones: [],
      metadata: null,
      parties: null,
      durationMs: 0,
      errorMessage: String((err as Error)?.message ?? err).slice(0, 400),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is valid */ }

  const workItemIds = Array.isArray(body.work_item_ids) ? body.work_item_ids as string[] : null;
  const radicados = Array.isArray(body.radicados) ? body.radicados as string[] : null;
  const limit = Math.min(Number(body.limit ?? 25) || 25, 100);
  const heal = body.heal !== false;
  const forceRefresh = body.force_refresh === true;

  let q = admin
    .from("work_items")
    .select("id, organization_id, radicado, workflow_type, lifecycle_state, monitoring_enabled")
    .is("deleted_at", null)
    .not("radicado", "is", null);

  if (workItemIds?.length) q = q.in("id", workItemIds);
  else if (radicados?.length) q = q.in("radicado", radicados);
  else q = q.eq("monitoring_enabled", true).in("workflow_type", Object.keys(CHAIN)).order("last_synced_at", { ascending: true, nullsFirst: true });

  const { data: items, error: itemsErr } = await q.limit(limit);
  if (itemsErr) {
    return new Response(JSON.stringify({ ok: false, error: itemsErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const lines: LedgerLine[] = [];
  let healed = 0;

  for (const wi of items ?? []) {
    const chain = CHAIN[String(wi.workflow_type ?? "").toUpperCase()] ?? [];
    const radicado = String(wi.radicado);

    for (const provider of chain) {
      const res = await callProvider(provider, radicado, wi.id, forceRefresh);
      if (!res) continue;

      // Record raw source health regardless of outcome.
      const emitted = res.actuaciones.length + res.publicaciones.length;
      await admin.from("provider_source_health").upsert({
        work_item_id: wi.id,
        radicado,
        provider_key: provider,
        last_run_at: new Date().toISOString(),
        last_row_emitted_at: emitted > 0 ? new Date().toISOString() : undefined,
        terminal_state: res.status === "ERROR"
          ? "PROVIDER_JOB_FAILED"
          : res.status === "TIMEOUT"
            ? "PROVIDER_NEVER_COMPLETES"
            : null,
        note: res.errorMessage?.slice(0, 400) ?? null,
      }, { onConflict: "radicado,provider_key" });

      if (res.status === "ERROR" || res.status === "TIMEOUT" || res.status === "SCRAPING_INITIATED") {
        lines.push({
          work_item_id: wi.id, radicado, provider_key: provider, row_kind: "ACT",
          provider_count: 0, local_count: 0, missing_count: 0, recovered_count: 0,
          transfer_state: "PROVIDER_UNAVAILABLE", missing_fingerprints: [],
          last_error: res.errorMessage ?? res.status,
        });
        continue;
      }

      for (const kind of ["ACT", "PUB"] as const) {
        const rows = kind === "ACT" ? res.actuaciones : res.publicaciones;
        if (kind === "PUB" && res.actuaciones.length > 0 && rows.length === 0) continue;
        if (kind === "ACT" && res.actuaciones.length === 0 && res.publicaciones.length > 0) continue;

        const providerFps = [...new Set(rows.map((r) => r.hash_fingerprint).filter(Boolean))];

        const localFps = async (): Promise<Set<string>> => {
          const table = kind === "ACT" ? "work_item_acts" : "work_item_publicaciones";
          const { data } = await admin.from(table)
            .select("hash_fingerprint")
            .eq("work_item_id", wi.id)
            .limit(2000);
          return new Set((data ?? []).map((r: { hash_fingerprint: string }) => r.hash_fingerprint));
        };

        let local = await localFps();
        let missing = providerFps.filter((fp) => !local.has(fp));
        let recovered = 0;
        let state: TransferState = providerFps.length === 0
          ? "PROVIDER_NO_ROWS"
          : missing.length === 0 ? "IN_SYNC" : "GAP";
        let lastError: string | null = null;

        // Self-healing bridge: a gap re-runs the persistence path once.
        if (heal && missing.length > 0) {
          const fn = kind === "ACT" ? "sync-by-work-item" : "sync-publicaciones-by-work-item";
          const { error: syncErr } = await admin.functions.invoke(fn, {
            body: { work_item_id: wi.id, force_refresh: true, trigger: "BRIDGE_RECONCILE" },
          });
          if (syncErr) lastError = String(syncErr.message).slice(0, 400);
          local = await localFps();
          const stillMissing = providerFps.filter((fp) => !local.has(fp));
          recovered = missing.length - stillMissing.length;
          healed += recovered;
          missing = stillMissing;
          state = missing.length === 0 ? "IN_SYNC" : "TRANSFER_FAILED";
        }

        lines.push({
          work_item_id: wi.id, radicado, provider_key: provider, row_kind: kind,
          provider_count: providerFps.length,
          local_count: local.size,
          missing_count: missing.length,
          recovered_count: recovered,
          transfer_state: state,
          missing_fingerprints: missing.slice(0, 50),
          last_error: lastError,
        });
      }
    }
  }

  // Persist the ledger, preserving first_gap_at across runs.
  const openGaps: LedgerLine[] = [];
  for (const line of lines) {
    const isGap = line.transfer_state === "GAP"
      || line.transfer_state === "TRANSFER_FAILED"
      || line.transfer_state === "PROVIDER_UNAVAILABLE";

    const { data: existing } = await admin
      .from("bridge_inventory_ledger")
      .select("id, first_gap_at")
      .eq("work_item_id", line.work_item_id)
      .eq("provider_key", line.provider_key)
      .eq("row_kind", line.row_kind)
      .maybeSingle();

    const firstGapAt = isGap
      ? (existing?.first_gap_at ?? new Date().toISOString())
      : null;

    const wi = (items ?? []).find((i) => i.id === line.work_item_id);
    await admin.from("bridge_inventory_ledger").upsert({
      work_item_id: line.work_item_id,
      organization_id: wi?.organization_id ?? null,
      radicado: line.radicado,
      provider_key: line.provider_key,
      row_kind: line.row_kind,
      provider_count: line.provider_count,
      local_count: line.local_count,
      missing_count: line.missing_count,
      recovered_count: line.recovered_count,
      transfer_state: line.transfer_state,
      missing_fingerprints: line.missing_fingerprints,
      last_error: line.last_error,
      first_gap_at: firstGapAt,
      last_checked_at: new Date().toISOString(),
    }, { onConflict: "work_item_id,provider_key,row_kind" });

    if (isGap && firstGapAt
        && Date.now() - new Date(firstGapAt).getTime() > GAP_ALERT_HOURS * 3600_000) {
      openGaps.push(line);
    }
  }

  if (openGaps.length > 0) {
    await admin.from("alert_instances").insert({
      organization_id: PLATFORM_ORG,
      owner_id: null,
      entity_type: "SYSTEM",
      entity_id: null,
      alert_type: "BRIDGE_TRANSFER_GAP",
      severity: "CRITICAL",
      status: "PENDING",
      title: `🔌 Puente GCP→Andromeda: ${openGaps.length} brecha(s) abiertas >${GAP_ALERT_HOURS}h`,
      message: openGaps.slice(0, 10)
        .map((g) => `${g.radicado} · ${g.provider_key} · faltan ${g.missing_count} (${g.transfer_state})`)
        .join(" | "),
      payload: { gaps: openGaps.slice(0, 25) },
      fingerprint: `bridge_transfer_gap_${new Date().toISOString().slice(0, 10)}`,
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    checked_items: items?.length ?? 0,
    lines,
    recovered_rows: healed,
    open_gaps: openGaps.length,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
