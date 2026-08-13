/**
 * detect-remision-succession — ITERATION 57.
 *
 * Reads the acts of open matters, finds the remisión, and writes the
 * succession. It never invents the successor: when no successor can be
 * established the row stays `PENDIENTE_SUCESOR` and SAYS so in the UI.
 *
 * What it does per detected remisión por competencia:
 *   1. records `work_item_successions` (relation REMISION_COMPETENCIA)
 *   2. extracts the destination despacho (name always, 12-digit code when both
 *      city and especialidad resolve; otherwise NO_RESUELTO with the reason)
 *   3. searches OUR OWN portfolio for a matter at the destination whose parties
 *      match (`party_name_match`) — the upstream contracts expose no
 *      party-by-despacho search, so this is the only automatic route
 *   4. closes the origin as CERRADO_POR_REMISION and closes its open terms
 *   5. enqueues a census request for the destination despacho
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  classifyRemisionText,
  extractDestinoDespacho,
  relationForRemision,
} from "../_shared/remisionCompetencia.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ActRow {
  id: string;
  work_item_id: string;
  description: string | null;
  act_type: string | null;
  act_date: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { work_item_id?: string; dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const dryRun = body.dry_run === true;

  let actQuery = supabase
    .from("work_item_acts")
    .select("id, work_item_id, description, act_type, act_date")
    .order("act_date", { ascending: false })
    .limit(4000);
  if (body.work_item_id) actQuery = actQuery.eq("work_item_id", body.work_item_id);

  const { data: acts, error: actErr } = await actQuery;
  if (actErr) return json({ ok: false, error: actErr.message }, 500);

  // One verdict per matter: the most recent act that carries the vocabulary.
  const perItem = new Map<string, { act: ActRow; evidence: string; klass: string }>();
  for (const a of (acts ?? []) as ActRow[]) {
    if (perItem.has(a.work_item_id)) continue;
    const text = `${a.description ?? ""} ${a.act_type ?? ""}`;
    const v = classifyRemisionText(text);
    if (v.klass === "NO_REMISION") continue;
    perItem.set(a.work_item_id, { act: a, evidence: v.evidence ?? text.trim(), klass: v.klass });
  }

  const detected: unknown[] = [];

  for (const [workItemId, hit] of perItem) {
    const relation = relationForRemision(hit.klass as never);
    if (!relation) continue;

    const { data: wi } = await supabase
      .from("work_items")
      .select("id, radicado, demandantes, demandados, owner_id, organization_id, closure_reason, lifecycle_state")
      .eq("id", workItemId)
      .maybeSingle();
    if (!wi) continue;

    const text = `${hit.act.description ?? ""} ${hit.act.act_type ?? ""}`;
    const destino = extractDestinoDespacho(text, null);

    // Successor search — our own portfolio only, and only when we know where to look.
    let successorId: string | null = null;
    let successorRadicado: string | null = null;
    let confidence: number | null = null;
    if (destino.codigo) {
      const { data: candidates } = await supabase
        .from("work_items")
        .select("id, radicado, demandantes, demandados")
        .neq("id", workItemId)
        .like("radicado", `${destino.codigo}%`)
        .limit(50);
      for (const c of candidates ?? []) {
        const { data: score } = await supabase.rpc("party_name_match", {
          a: String(wi.demandantes ?? ""),
          b: String((c as { demandantes?: string }).demandantes ?? ""),
        });
        const s = typeof score === "number" ? score : 0;
        if (s >= 0.6 && (confidence === null || s > confidence)) {
          confidence = s;
          successorId = (c as { id: string }).id;
          successorRadicado = (c as { radicado: string | null }).radicado ?? null;
        }
      }
    }

    const row = {
      origin_work_item_id: workItemId,
      successor_work_item_id: successorId,
      relation_type: relation,
      status: successorId ? "SUCESOR_PROPUESTO" : "PENDIENTE_SUCESOR",
      trigger_act_id: hit.act.id,
      trigger_act_date: hit.act.act_date,
      trigger_evidence: hit.evidence,
      destino_despacho_nombre: destino.nombre,
      destino_despacho_codigo: destino.codigo,
      destino_codigo_status: destino.codigo_status,
      destino_codigo_motivo: destino.codigo_motivo,
      successor_radicado: successorRadicado,
      successor_confidence: confidence,
      detected_by: "SYSTEM",
      owner_id: wi.owner_id,
      organization_id: wi.organization_id,
      evidence: { act_text: text.trim().slice(0, 800) },
    };

    detected.push({ ...row, dry_run: dryRun });
    if (dryRun) continue;

    const { error: upErr } = await supabase
      .from("work_item_successions")
      .upsert(row, { onConflict: "origin_work_item_id,relation_type,trigger_act_id" });
    if (upErr) {
      detected.push({ origin: workItemId, persist_error: upErr.message });
      continue;
    }

    if (relation === "REMISION_COMPETENCIA") {
      // The origin is closed by remisión — its silence is explained, not a ghost.
      await supabase
        .from("work_items")
        .update({
          closure_reason: "CERRADO_POR_REMISION",
          closure_at: new Date().toISOString(),
          closure_note: destino.nombre
            ? `Expediente remitido por competencia a ${destino.nombre}.`
            : "Expediente remitido por competencia; el despacho receptor no está identificado en el auto.",
        })
        .eq("id", workItemId);

      // Terms of the origin do not expire — they close with the file. CANCELLED
      // is the catalogue's "no longer running", and `closure_reason` says why.
      await supabase
        .from("work_item_deadlines")
        .update({ status: "CANCELLED", closure_reason: "CERRADO_POR_REMISION" })
        .eq("work_item_id", workItemId)
        .in("status", ["PENDING", "PENDING_REVIEW", "SUGGESTED_BY_EMAIL", "SUGGESTED_BY_PROVIDER"]);

      if (destino.codigo) {
        const { data: known } = await supabase
          .from("despacho_coverage")
          .select("radicado_prefix")
          .eq("radicado_prefix", destino.codigo)
          .maybeSingle();
        if (!known) {
          await supabase.from("despacho_census_requests").insert({
            despacho_code: destino.codigo,
            work_item_id: workItemId,
            radicado: wi.radicado,
            status: "PENDING",
          });
        }
      }
    }
  }

  return json({ ok: true, scanned: (acts ?? []).length, detected: detected.length, rows: detected });
});