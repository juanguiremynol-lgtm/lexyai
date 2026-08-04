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
 *
 * ITERATION 23 — plausible-empty is the dangerous case.
 *   PROVIDER_NO_ROWS is an assertion about the SOURCE ("there is nothing
 *   there"). It may only be recorded when the provider returned a well-formed
 *   successful inventory that genuinely contained zero rows. Every other
 *   outcome — non-2xx, timeout, abort, limiter exhaustion, malformed body — is
 *   ours or the provider's infrastructure and is recorded as
 *   INFRA_FAILURE / PROVIDER_JOB_ABORTED / PROVIDER_NEVER_COMPLETES with the
 *   verbatim response. Additionally, provider 0 + local > 0 is never accepted
 *   at face value: it is recorded as PROVIDER_INVENTORY_SUSPECT and re-queried
 *   once before it may settle on PROVIDER_NO_ROWS.
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
import { canonicalPubIdentityFromRow } from "../_shared/canonicalPublicacionMapper.ts";
import { canonicalActIdentityFromRow } from "../_shared/canonicalActMapper.ts";

/**
 * ITERATION 21 — false-gap elimination.
 *
 * The reconciler used to compare the adapter's `hash_fingerprint` against the
 * stored `hash_fingerprint`. Those two strings are produced by two different
 * ingestion paths (the shared adapter vs. the sync function's own mapper) that
 * derive `tipo`/`title`/date differently, so an identical juridical fact hashed
 * to two different values and the row was reported missing even while sitting
 * in the table. El Retiro showed provider 3 / local 6 / missing 3 — arithmetic
 * that can only come from mismatched identity, never from a real gap.
 *
 * Identity is now a SET per row: the provider's own row key (asset_id / key),
 * the transported fingerprint, and the canonical fingerprint recomputed from
 * the row's juridical fields. A provider row counts as landed when any of its
 * identities matches any identity of any local row.
 *
 * ITERATION 22 — the recomputation is no longer inlined here. Both sides call
 * `canonicalPubIdentityFromRow` / `canonicalActIdentityFromRow` from the shared
 * mappers, so the reconciler can never drift from the writers again.
 */
function norm(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s && s !== "null" && s !== "undefined" ? s.toLowerCase() : null;
}

function providerIdentities(
  kind: "ACT" | "PUB",
  row: Record<string, any>,
  workItemId: string,
): string[] {
  const raw = (row.raw_data ?? {}) as Record<string, any>;
  const ids = [
    norm(row.hash_fingerprint),
    norm(row.asset_id ?? raw.asset_id ?? raw.id),
    norm(row.key ?? raw.key),
    norm(raw?.estado?.article_id),
  ];
  if (kind === "PUB") {
    ids.push(norm(canonicalPubIdentityFromRow({
      fecha_fijacion: row.fecha_fijacion ?? row.published_at ?? raw.fecha_publicacion ?? null,
      published_at: null,
      tipo_publicacion: row.tipo_publicacion ?? null,
      title: row.title ?? raw.titulo ?? null,
      raw_data: raw,
    }, workItemId)));
  } else {
    ids.push(norm(canonicalActIdentityFromRow({
      act_date: row.fecha_actuacion ?? row.act_date ?? null,
      description: row.actuacion ?? row.description ?? null,
      raw_data: raw,
    }, workItemId)));
  }
  return ids.filter((x): x is string => Boolean(x));
}

function localIdentities(kind: "ACT" | "PUB", row: Record<string, any>, workItemId: string): string[] {
  const raw = (row.raw_data ?? {}) as Record<string, any>;
  const ids = [
    norm(row.hash_fingerprint),
    norm(raw.asset_id ?? raw.id),
    norm(raw.key),
    // The sync path stores the provider article id inside a composite key
    // ("individual:184731165:<titulo>:<fecha>"); expose the bare token so it
    // matches the provider's `raw_data.estado.article_id`.
    norm(String(raw.key ?? "").split(":")[1]),
  ];
  if (kind === "PUB") {
    ids.push(norm(canonicalPubIdentityFromRow(row as any, workItemId)));
  } else {
    ids.push(norm(canonicalActIdentityFromRow(row as any, workItemId)));
  }
  return ids.filter((x): x is string => Boolean(x));
}

const PLATFORM_ORG = "a0000000-0000-0000-0000-000000000001";
const GAP_ALERT_HOURS = 24;

/**
 * ITERATION 23 — like-for-like comparison.
 *
 * Each provider only produces ONE row kind. Six ledger rows read
 * "cpnu · PUB · provider 0 / local 6 · PROVIDER_NO_ROWS": CPNU never emits
 * publicaciones, and the local side was counting `work_item_publicaciones`
 * rows written by the *Publicaciones* provider. Nothing was missing; the
 * comparison was apples-to-oranges. A provider is now only reconciled against
 * the row kind it actually produces, and the local side only counts rows
 * attributed to that same provider.
 */
const PROVIDER_ROW_KINDS: Record<string, Array<"ACT" | "PUB">> = {
  cpnu: ["ACT"],
  samai: ["ACT"],
  tutelas: ["ACT"],
  publicaciones: ["PUB"],
  samai_estados: ["PUB"],
};

/** Local `source` values attributable to each provider (case-insensitive). */
const PROVIDER_LOCAL_SOURCES: Record<string, string[]> = {
  cpnu: ["cpnu", "cpnu+tutelas"],
  samai: ["samai"],
  tutelas: ["tutelas", "cpnu+tutelas"],
  publicaciones: ["publicaciones", "pp"],
  samai_estados: ["samai_estados"],
};

/**
 * Failure taxonomy ratified with GCP (iteration 23 item 5). An exhausted
 * limiter, an aborted job, an OOM or a 401/403 is never an empty result.
 */
type FailureState = "INFRA_FAILURE" | "PROVIDER_JOB_ABORTED" | "PROVIDER_NEVER_COMPLETES";

function classifyProviderFailure(res: ProviderAdapterResult): { state: FailureState; detail: string } | null {
  const msg = String(res.errorMessage ?? "").trim();
  const lower = msg.toLowerCase();
  const http = res.httpStatus ?? 0;

  if (res.status === "TIMEOUT" || res.status === "SCRAPING_INITIATED") {
    return {
      state: "PROVIDER_NEVER_COMPLETES",
      detail: msg || `${res.provider}: ${res.status} — el trabajo no completó dentro del sondeo`,
    };
  }

  const abortish = /abort|cancel|limiter|rate.?limit|too many|429|oom|out of memory|killed|memory limit|job failed|scraping (trigger )?failed/
    .test(lower);
  const infraish = /401|403|unauthorized|forbidden|auth|invalid_json|malformed|html|cannot get|route|5\d\d|bad gateway|econn|network|fetch failed|dns/
    .test(lower) || http === 401 || http === 403 || http === 429 || http >= 500;

  if (res.status === "ERROR") {
    return {
      state: abortish && !infraish ? "PROVIDER_JOB_ABORTED" : "INFRA_FAILURE",
      detail: msg || `${res.provider}: ERROR sin mensaje (HTTP ${http || "?"})`,
    };
  }

  // `EMPTY` is the trap: several adapters return EMPTY for outcomes that are
  // in fact failures ("Scraping trigger failed", auth rejections, malformed
  // bodies). Only a clean, well-formed zero-row answer survives this filter.
  if (res.status === "EMPTY" && msg) {
    if (abortish) return { state: "PROVIDER_JOB_ABORTED", detail: msg };
    if (infraish) return { state: "INFRA_FAILURE", detail: msg };
  }
  if (http && (http < 200 || http >= 300) && http !== 404) {
    return { state: "INFRA_FAILURE", detail: msg || `HTTP ${http}` };
  }
  return null;
}

/**
 * ITERATION 21 — "the error is the bug before the bug".
 *
 * `supabase.functions.invoke()` throws away the response body and reports the
 * useless string "Edge Function returned a non-2xx status code". Two El Retiro
 * gaps sat undiagnosable on the ledger because of it. We call the sync
 * functions over raw HTTP instead and persist status + body verbatim.
 */
async function invokeSyncFunction(
  fn: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; detail: string | null }> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // The observed non-2xx was a platform-level `502 Bad Gateway` with an HTML
  // body: the worker was still saturated by the preceding 120s CPNU poll when
  // the next invocation arrived. It is transient and must be retried, not
  // recorded as a transfer defect.
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
   try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Opaque `sb_secret_` keys must travel as `apikey`; legacy JWT service
        // keys are accepted on both headers. Sending both keeps either shape
        // working and stops the gateway from 401-ing before the function runs.
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "x-invoked-by": "bridge-reconcile",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(110_000),
    });
    const text = await res.text();
    if (res.ok) return { ok: true, detail: null };
    last = `${fn} HTTP ${res.status} ${res.statusText} (attempt ${attempt}) :: ${(text || "<empty body>").slice(0, 600)}`;
    if (res.status < 500) return { ok: false, detail: last };
   } catch (err) {
    last = `${fn} FETCH_FAILED (attempt ${attempt}) :: ${String((err as Error)?.message ?? err).slice(0, 400)}`;
   }
   if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 4000));
  }
  return { ok: false, detail: last };
}

const CHAIN: Record<string, string[]> = {
  CGP: ["cpnu", "publicaciones"],
  LABORAL: ["cpnu", "publicaciones"],
  PENAL_906: ["cpnu", "publicaciones"],
  PENAL: ["cpnu", "publicaciones"],
  CPACA: ["samai", "samai_estados"],
  INDETERMINADO: ["cpnu", "publicaciones", "samai", "samai_estados"],
  TUTELA: ["cpnu", "samai", "publicaciones", "samai_estados"],
};

/** `PENAL` is a legacy in-memory alias (iteration 15 normalized it to
 *  PENAL_906) and is NOT a member of the `workflow_type` enum — filtering the
 *  portfolio query by it made Postgres reject the whole sweep. */
const QUERYABLE_WORKFLOWS = Object.keys(CHAIN).filter((w) => w !== "PENAL");

type TransferState =
  | "IN_SYNC" | "GAP" | "PROVIDER_NO_ROWS" | "TRANSFER_FAILED" | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_INVENTORY_SUSPECT" | "INFRA_FAILURE" | "PROVIDER_JOB_ABORTED" | "PROVIDER_NEVER_COMPLETES";

/** States that assert nothing about transferred rows. */
const NON_CONCLUSIVE: TransferState[] = [
  "PROVIDER_UNAVAILABLE", "PROVIDER_INVENTORY_SUSPECT",
  "INFRA_FAILURE", "PROVIDER_JOB_ABORTED", "PROVIDER_NEVER_COMPLETES",
];

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

  // Permanent auth diagnostic: iteration 21 traced the opaque non-2xx to the
  // header shape used for internal service-role calls. Keep the probe so the
  // next credential rotation is diagnosable in one call instead of a week.
  if (body.probe_auth === true) {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-publicaciones-by-work-item`;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const probe = async (headers: Record<string, string>) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body.probe_payload ?? { health_check: true }),
      });
      return { status: r.status, body: (await r.text()).slice(0, 200) };
    };
    return new Response(JSON.stringify({
      ok: true,
      key_shape: key.startsWith("sb_secret_") ? "opaque_sb_secret" : key.startsWith("ey") ? "legacy_jwt" : "unknown",
      key_len: key.length,
      authorization_only: await probe({ Authorization: `Bearer ${key}` }),
      apikey_only: await probe({ apikey: key }),
      both: await probe({ apikey: key, Authorization: `Bearer ${key}` }),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const workItemIds = Array.isArray(body.work_item_ids) ? body.work_item_ids as string[] : null;
  const radicados = Array.isArray(body.radicados) ? body.radicados as string[] : null;
  const limit = Math.min(Number(body.limit ?? 25) || 25, 100);
  const heal = body.heal !== false;
  const forceRefresh = body.force_refresh === true;
  // Portfolio sweeps must be chunked: the platform kills a function at 150s of
  // idle time, and a single CPNU deep poll can burn most of that alone.
  const providerFilter = Array.isArray(body.providers) ? (body.providers as string[]) : null;
  const offset = Math.max(Number(body.offset ?? 0) || 0, 0);
  const budgetMs = Math.min(Number(body.budget_ms ?? 100_000) || 100_000, 130_000);
  const startedAt = Date.now();

  let q = admin
    .from("work_items")
    .select("id, organization_id, radicado, workflow_type, lifecycle_state, monitoring_enabled")
    .is("deleted_at", null)
    .not("radicado", "is", null);

  if (workItemIds?.length) q = q.in("id", workItemIds);
  else if (radicados?.length) q = q.in("radicado", radicados);
  else q = q.eq("monitoring_enabled", true).in("workflow_type", QUERYABLE_WORKFLOWS).order("last_synced_at", { ascending: true, nullsFirst: true });

  const { data: items, error: itemsErr } = await q.range(offset, offset + limit - 1);
  if (itemsErr) {
    return new Response(JSON.stringify({ ok: false, error: itemsErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const lines: LedgerLine[] = [];
  let healed = 0;
  let processed = 0;
  let budgetExhausted = false;

  const openGaps: LedgerLine[] = [];

  /** Persist one ledger line immediately so a timeout never loses evidence. */
  async function persistLine(line: LedgerLine, organizationId: string | null) {
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

    const firstGapAt = isGap ? (existing?.first_gap_at ?? new Date().toISOString()) : null;

    await admin.from("bridge_inventory_ledger").upsert({
      work_item_id: line.work_item_id,
      organization_id: organizationId,
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

  for (const wi of items ?? []) {
    if (Date.now() - startedAt > budgetMs) { budgetExhausted = true; break; }
    let chain = CHAIN[String(wi.workflow_type ?? "").toUpperCase()] ?? [];
    if (providerFilter?.length) chain = chain.filter((p) => providerFilter.includes(p));
    const radicado = String(wi.radicado);
    processed++;

    for (const provider of chain) {
      if (Date.now() - startedAt > budgetMs) { budgetExhausted = true; break; }
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
        const line: LedgerLine = {
          work_item_id: wi.id, radicado, provider_key: provider, row_kind: "ACT",
          provider_count: 0, local_count: 0, missing_count: 0, recovered_count: 0,
          transfer_state: "PROVIDER_UNAVAILABLE", missing_fingerprints: [],
          last_error: res.errorMessage ?? res.status,
        };
        lines.push(line);
        await persistLine(line, wi.organization_id ?? null);
        continue;
      }

      for (const kind of ["ACT", "PUB"] as const) {
        const rows = kind === "ACT" ? res.actuaciones : res.publicaciones;
        if (kind === "PUB" && res.actuaciones.length > 0 && rows.length === 0) continue;
        if (kind === "ACT" && res.actuaciones.length === 0 && res.publicaciones.length > 0) continue;

        // Deduplicate provider rows on their strongest identity so a provider
        // that repeats a row across pages is not counted twice.
        const providerRows = new Map<string, string[]>();
        for (const r of rows as unknown as Record<string, any>[]) {
          const ids = providerIdentities(kind, r, wi.id);
          if (ids.length === 0) continue;
          if (!providerRows.has(ids[0])) providerRows.set(ids[0], ids);
        }

        const localState = async (): Promise<{ ids: Set<string>; count: number }> => {
          const table = kind === "ACT" ? "work_item_acts" : "work_item_publicaciones";
          const cols = kind === "ACT"
            ? "hash_fingerprint, act_date, description, raw_data"
            : "hash_fingerprint, fecha_fijacion, published_at, tipo_publicacion, title, raw_data";
          const { data } = await admin.from(table)
            .select(cols)
            .eq("work_item_id", wi.id)
            .limit(2000);
          const ids = new Set<string>();
          for (const r of (data ?? []) as unknown as Record<string, any>[]) {
            for (const id of localIdentities(kind, r, wi.id)) ids.add(id);
          }
          return { ids, count: (data ?? []).length };
        };

        const landed = (ids: string[], local: Set<string>) => ids.some((id) => local.has(id));


        let local = await localState();
        let missing = [...providerRows.entries()]
          .filter(([, ids]) => !landed(ids, local.ids))
          .map(([key]) => key);
        const providerCount = providerRows.size;
        let recovered = 0;
        let state: TransferState = providerCount === 0
          ? "PROVIDER_NO_ROWS"
          : missing.length === 0 ? "IN_SYNC" : "GAP";
        let lastError: string | null = null;

        // Self-healing bridge: a gap re-runs the persistence path once.
        if (heal && missing.length > 0) {
          const fn = kind === "ACT" ? "sync-by-work-item" : "sync-publicaciones-by-work-item";
          // `_scheduled` is the service-role contract of both sync functions:
          // it skips the interactive JWT/membership check. `_force` bypasses
          // the cooldown gate, which otherwise makes healing a silent no-op.
          const invoked = await invokeSyncFunction(fn, {
            work_item_id: wi.id,
            _scheduled: true,
            _force: true,
            force_refresh: true,
            trigger: "BRIDGE_RECONCILE",
          });
          if (!invoked.ok) lastError = invoked.detail;
          local = await localState();
          const stillMissing = [...providerRows.entries()]
            .filter(([, ids]) => !landed(ids, local.ids))
            .map(([key]) => key);
          recovered = missing.length - stillMissing.length;
          healed += recovered;
          missing = stillMissing;
          state = missing.length === 0 ? "IN_SYNC" : "TRANSFER_FAILED";
        }

        const line: LedgerLine = {
          work_item_id: wi.id, radicado, provider_key: provider, row_kind: kind,
          provider_count: providerCount,
          local_count: local.count,
          missing_count: missing.length,
          recovered_count: recovered,
          transfer_state: state,
          missing_fingerprints: missing.slice(0, 50),
          last_error: lastError,
        };
        lines.push(line);
        await persistLine(line, wi.organization_id ?? null);
      }
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
    processed_items: processed,
    next_offset: budgetExhausted || (items?.length ?? 0) === limit ? offset + processed : null,
    budget_exhausted: budgetExhausted,
    lines,
    recovered_rows: healed,
    open_gaps: openGaps.length,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
