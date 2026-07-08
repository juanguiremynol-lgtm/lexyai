/**
 * Hearings Extract Backfill — admin/token-guarded, bounded batches.
 *
 * Scans existing `work_item_acts` for hearing-scheduling text, inserts one
 * `hearings` row per unique (work_item_id, starts_at) with:
 *   status=scheduled  when starts_at is in the future,
 *   status=past       when starts_at has already elapsed (NO alerts fired),
 *   status=suspended  for acts that suspend a currently-scheduled hearing.
 *
 * Bounded by TIME_BUDGET_MS and by an `after` cursor (created_at).
 * Idempotent — safe to re-run.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { extractHearingFromAct, isSuspensionAct } from "../_shared/hearingExtractor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIME_BUDGET_MS = 45_000;
const BATCH_SIZE = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  const url = new URL(req.url);
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = Deno.env.get("PLATFORM_ADMIN_TOKEN") ?? "";
  if (!expected || !authHeader.includes(expected)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let workItemFilter = url.searchParams.get("work_item_id");
  try {
    const body = await req.json().catch(() => ({}));
    workItemFilter = body?.work_item_id || workItemFilter;
  } catch (_) { /* ignore */ }

  let cursor: string | null = null;
  let scanned = 0;
  let inserted_future = 0;
  let inserted_past = 0;
  let suspended = 0;
  let skipped_existing = 0;
  let errors = 0;

  const now = new Date();

  while (Date.now() - started < TIME_BUDGET_MS) {
    let q = supabase
      .from("work_item_acts")
      .select("id, work_item_id, act_date, act_type, description, created_at, organization_id, owner_id")
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (workItemFilter) q = q.eq("work_item_id", workItemFilter);
    if (cursor) q = q.gt("created_at", cursor);
    const { data: acts, error } = await q;
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!acts || acts.length === 0) break;

    for (const a of acts) {
      scanned++;
      cursor = a.created_at as string;
      try {
        const cand = extractHearingFromAct({ act_type: a.act_type, description: a.description });
        if (cand) {
          const isFuture = new Date(cand.starts_at_iso) > now;
          const { data: existing } = await supabase
            .from("hearings")
            .select("id")
            .eq("work_item_id", a.work_item_id)
            .eq("scheduled_at", cand.starts_at_iso)
            .maybeSingle();
          if (existing) { skipped_existing++; continue; }

          await supabase.from("hearings").insert({
            owner_id: a.owner_id,
            organization_id: a.organization_id,
            work_item_id: a.work_item_id,
            title: cand.title,
            scheduled_at: cand.starts_at_iso,
            auto_detected: true,
            status: isFuture ? "scheduled" : "past",
            source_act_id: a.id,
            extraction_method: "act_regex_v1_backfill",
            time_inferred: cand.time_inferred,
            discovery_type: isFuture ? "NOVEDAD" : "HISTORICO_DETECTADO",
          });

          if (isFuture) inserted_future++;
          else inserted_past++;
        } else if (isSuspensionAct(a.act_type, a.description)) {
          const { data: upd } = await supabase
            .from("hearings")
            .update({ status: "suspended", updated_at: new Date().toISOString() })
            .eq("work_item_id", a.work_item_id)
            .eq("status", "scheduled")
            .select("id");
          suspended += upd?.length ?? 0;
        }
      } catch (e) {
        errors++;
        console.warn("[hearings-backfill] act err", (e as Error).message);
      }
    }
    if (acts.length < BATCH_SIZE) break;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      scanned,
      inserted_future,
      inserted_past,
      suspended,
      skipped_existing,
      errors,
      cursor,
      duration_ms: Date.now() - started,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
