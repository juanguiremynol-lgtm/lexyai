/**
 * subscribe-superior-instances — ITERATION 60 (A).
 *
 * GCP discovered 23-digit recurso streams (superior-court files) whose base-21
 * process is one of our matters but which nobody had subscribed. Their half is
 * built: `GET {cpnu_jobs}/instancias/sin-suscribir` enumerates them. Ours is
 * the missing step — emit a lifecycle ACTIVE event per eligible stream so the
 * provider links it to the SAME work item (iteration 59: one work item, two
 * provider streams; a recurso NEVER creates a second matter).
 *
 * Doctrine enforced here:
 *   • The subscription is emitted against the BASE work item id, with the
 *     23-digit key as the radicado, so GCP can attach the stream without
 *     inventing a second subject.
 *   • A base that is not ACTIVE is NOT re-animated. The discovery is recorded
 *     as OMITIDO_BASE_INACTIVA — live activity at a superior on an archived
 *     matter is a signal for the user, not a licence to resume monitoring.
 *   • Upstream `base_activa` is advisory; our lifecycle table is the truth and
 *     the disagreement is stored rather than resolved silently.
 *
 * Delivery goes through `gcp_lifecycle_outbox`, so it inherits FIFO ordering,
 * retries and the existing broadcaster — no second delivery path.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { upstreamBaseUrl, upstreamHeaders } from "../_shared/upstreamEndpoints.ts";
import {
  decideSubscription,
  type InstanciaSinSuscribir,
  parseInstanciasSinSuscribir,
  type SubscriptionDecision,
} from "../_shared/instanciasSinSuscribir.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATE_FOR_DECISION: Record<SubscriptionDecision, string> = {
  SUSCRIBIR: "PENDIENTE_ENTREGA",
  OMITIDO_BASE_INACTIVA: "OMITIDO_BASE_INACTIVA",
  OMITIDO_BASE_ELIMINADA: "OMITIDO_BASE_ELIMINADA",
  OMITIDO_SIN_WORK_ITEM: "OMITIDO_SIN_WORK_ITEM",
  OMITIDO_ES_PRIMERA_INSTANCIA: "OMITIDO_ES_PRIMERA_INSTANCIA",
};


function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let dryRun = false;
  try {
    const b = await req.json();
    dryRun = b?.dry_run === true;
  } catch { /* no body — live run */ }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 1. read the provider's discovery list ──────────────────────────────────
  const url = `${upstreamBaseUrl("cpnu_jobs")}/instancias/sin-suscribir`;
  let instancias: InstanciaSinSuscribir[] = [];
  try {
    const resp = await fetch(url, { headers: upstreamHeaders("cpnu_jobs") });
    const text = await resp.text();
    if (!resp.ok) {
      return json({ ok: false, error: `upstream HTTP ${resp.status}`, body: text.slice(0, 300) }, 502);
    }
    instancias = parseInstanciasSinSuscribir(JSON.parse(text));
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 502);
  }

  if (instancias.length === 0) {
    return json({ ok: true, discovered: 0, subscribed: 0, skipped: [] });
  }

  // ── 2. resolve each base-21 against OUR work items ─────────────────────────
  const bases = [...new Set(instancias.map((i) => i.radicado_base_21))];
  const { data: items, error: itemsError } = await supabase
    .from("work_items")
    .select("id, radicado, organization_id, owner_id, workflow_type, lifecycle_state, deleted_at");
  if (itemsError) return json({ ok: false, error: itemsError.message }, 500);

  const byBase = new Map<string, Record<string, unknown>>();
  for (const w of items ?? []) {
    const digits = String(w.radicado ?? "").replace(/\D/g, "");
    if (digits.length < 21) continue;
    const base = digits.slice(0, 21);
    if (!bases.includes(base)) continue;
    // Prefer a live matter when duplicates exist: the subscription must not be
    // attached to a soft-deleted twin of an active process.
    const prev = byBase.get(base);
    if (!prev || (prev.lifecycle_state !== "ACTIVE" && w.lifecycle_state === "ACTIVE")) {
      byBase.set(base, w as Record<string, unknown>);
    }
  }

  // ── 3. record + enqueue ────────────────────────────────────────────────────
  const results: unknown[] = [];
  let subscribed = 0;

  for (const inst of instancias) {
    const wi = byBase.get(inst.radicado_base_21);
    const lifecycle = wi
      ? (wi.deleted_at ? "DELETED" : String(wi.lifecycle_state ?? "ACTIVE"))
      : null;
    const decision = decideSubscription(inst, lifecycle);

    const row = {
      radicado_23: inst.radicado_23,
      radicado_base_21: inst.radicado_base_21,
      consecutivo: inst.consecutivo,
      instancia_grado: inst.instancia,
      work_item_id: (wi?.id as string) ?? null,
      organization_id: (wi?.organization_id as string) ?? null,
      owner_id: (wi?.owner_id as string) ?? null,
      despacho: inst.despacho,
      workflow_type_base: inst.workflow_type_base ?? (wi?.workflow_type as string) ?? null,
      descubierto_por: inst.descubierto_por,
      acto_disparador: inst.acto_disparador,
      fecha_ultima_actuacion_proveedor: inst.fecha_ultima_actuacion_proveedor
        ? inst.fecha_ultima_actuacion_proveedor.slice(0, 10)
        : null,
      base_activa_upstream: inst.base_activa_upstream,
      base_lifecycle_state: lifecycle,
      subscription_state: STATE_FOR_DECISION[decision],
      last_seen_upstream_at: new Date().toISOString(),
    };

    if (!dryRun) {
      const { error: upErr } = await supabase
        .from("work_item_recurso_streams")
        .upsert(row, { onConflict: "radicado_23" });
      if (upErr) {
        results.push({ radicado_23: inst.radicado_23, decision, error: upErr.message });
        continue;
      }
    }

    if (decision === "SUSCRIBIR" && !dryRun) {
      const { error: obErr } = await supabase.from("gcp_lifecycle_outbox").insert({
        work_item_id: wi!.id as string,
        // The 23-digit key IS the subscription target; the base work item is
        // the subject it must be attached to.
        radicado: inst.radicado_23,
        workflow_type: row.workflow_type_base,
        prev_state: null,
        new_state: "ACTIVE",
        reason: "RECURSO_STREAM_SUBSCRIPTION",
        actor: "SYSTEM",
        metadata: {
          iteration: 60,
          radicado_base_21: inst.radicado_base_21,
          radicado_23: inst.radicado_23,
          consecutivo_recurso: inst.consecutivo,
          instancia: inst.instancia,
          despacho: inst.despacho,
          descubierto_por: inst.descubierto_por,
          subscribe_only: true,
        },
      });
      if (obErr) {
        results.push({ radicado_23: inst.radicado_23, decision, error: obErr.message });
        continue;
      }
      await supabase
        .from("work_item_recurso_streams")
        .update({ subscription_state: "SUSCRITO", subscribed_at: new Date().toISOString() })
        .eq("radicado_23", inst.radicado_23);
      subscribed++;
    }

    results.push({
      radicado_23: inst.radicado_23,
      base21: inst.radicado_base_21,
      work_item_id: (wi?.id as string) ?? null,
      base_lifecycle_state: lifecycle,
      base_activa_upstream: inst.base_activa_upstream,
      despacho: inst.despacho,
      ultima_actuacion: inst.fecha_ultima_actuacion_proveedor,
      decision,
    });
  }

  return json({
    ok: true,
    dry_run: dryRun,
    discovered: instancias.length,
    subscribed,
    results,
  });
});
