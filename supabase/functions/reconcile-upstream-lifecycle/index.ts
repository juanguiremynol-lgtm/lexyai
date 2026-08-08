/**
 * reconcile-upstream-lifecycle — ITERATION 46 (E1/E2).
 *
 * `radicados.activo` upstream and `work_items.lifecycle_state` here are two
 * copies of the same fact, and copies drift silently. A matter we believe is
 * ACTIVE but which upstream has deactivated simply stops receiving data, with
 * no error anywhere — the worst possible failure mode.
 *
 * This runner compares the two and RECORDS every divergence. It repairs only in
 * the one direction that cannot lose data: re-enrolling upstream a matter we
 * hold as active. Deactivating locally because upstream says so is never
 * automatic — that would let an upstream bug archive a live matter.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { upstreamBaseUrl, upstreamHeaders } from "../_shared/upstreamEndpoints.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Local lifecycle states that SHOULD be enrolled upstream. */
const EXPECT_ACTIVE = new Set(["ACTIVE"]);

export function expectedActivo(lifecycleState: string | null | undefined): boolean {
  return EXPECT_ACTIVE.has((lifecycleState ?? "").toUpperCase());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { repair?: boolean } = {};
  try { body = await req.json(); } catch { /* report-only */ }
  const repair = body.repair === true;

  const base = upstreamBaseUrl("andromeda_read");
  let inventory: Array<Record<string, unknown>> = [];
  try {
    const res = await fetch(`${base}/radicados`, { headers: upstreamHeaders("andromeda_read") });
    if (!res.ok) {
      return json({ ok: false, error: "inventario_no_disponible", http_status: res.status }, 502);
    }
    const p = await res.json();
    inventory = (Array.isArray(p) ? p : (p?.radicados ?? p?.items ?? [])) as Array<Record<string, unknown>>;
  } catch (err) {
    return json({ ok: false, error: String(err) }, 502);
  }

  const upstreamByRadicado = new Map<string, boolean>();
  for (const r of inventory) {
    const rad = String(r.numero_radicacion ?? r.radicado ?? "").replace(/\D/g, "");
    if (rad) upstreamByRadicado.set(rad, r.activo === true);
  }

  const { data: items } = await supabase
    .from("work_items")
    .select("id, radicado, lifecycle_state, workflow_type")
    .is("deleted_at", null)
    .not("radicado", "is", null);

  const divergences: Array<Record<string, unknown>> = [];
  let repaired = 0;

  for (const wi of items ?? []) {
    const rad = String(wi.radicado ?? "").replace(/\D/g, "");
    if (!rad) continue;
    const upstreamActivo = upstreamByRadicado.get(rad);
    // Absent from the inventory is not the same as deactivated: no assertion.
    if (upstreamActivo === undefined) continue;

    const expected = expectedActivo(wi.lifecycle_state);
    if (expected === upstreamActivo) continue;

    let resolution = "PENDIENTE";
    if (repair && expected && !upstreamActivo) {
      // Safe direction only: re-enrol a matter we hold as active.
      try {
        const res = await fetch(`${base}/lifecycle`, {
          method: "POST",
          headers: { ...upstreamHeaders("andromeda_read"), "Content-Type": "application/json" },
          body: JSON.stringify({ numero_radicacion: rad, activo: true }),
        });
        if (res.ok) { resolution = "REENROLADO_UPSTREAM"; repaired++; }
        else resolution = `REENROLE_FALLIDO_${res.status}`;
      } catch { resolution = "REENROLE_INALCANZABLE"; }
    } else if (!expected && upstreamActivo) {
      // Never auto-deactivate locally on an upstream claim.
      resolution = "REVISION_MANUAL_UPSTREAM_ACTIVO";
    }

    const row = {
      work_item_id: wi.id,
      radicado: rad,
      local_lifecycle_state: wi.lifecycle_state,
      local_expected_activo: expected,
      upstream_activo: upstreamActivo,
      resolution,
      detected_at: new Date().toISOString(),
      resolved_at: resolution === "REENROLADO_UPSTREAM" ? new Date().toISOString() : null,
    };
    divergences.push(row);
    // One OPEN divergence per matter: clear then record (the partial unique
    // index makes ON CONFLICT unusable here).
    await supabase
      .from("upstream_lifecycle_divergences")
      .delete()
      .eq("work_item_id", wi.id)
      .is("resolved_at", null);
    await supabase.from("upstream_lifecycle_divergences").insert(row);
  }

  return json({
    ok: true,
    inventario_upstream: upstreamByRadicado.size,
    cartera_evaluada: items?.length ?? 0,
    divergencias: divergences.length,
    reenrolados: repaired,
    detalle: divergences,
  });
});
