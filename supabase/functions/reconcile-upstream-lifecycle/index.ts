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

  let body: { repair?: boolean; inspeccionar?: string[] } = {};
  try { body = await req.json(); } catch { /* report-only */ }
  const repair = body.repair === true;
  // Read-only inspection list: echoes the upstream flag for named radicados so
  // GCP's current state can be reported per matter without writing anywhere.
  const inspect = (body.inspeccionar ?? []).map((r) => String(r).replace(/\D/g, ""));

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
    // Only a BOOLEAN `activo` is an assertion. An inventory row that omits the
    // flag would otherwise be read as "deactivated upstream" and manufacture a
    // divergence for every matter — the exact false alarm this runner exists
    // to prevent.
    if (rad && typeof r.activo === "boolean") upstreamByRadicado.set(rad, r.activo);
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
    // KK1 — only a canonical 23-digit radicado addresses anything upstream.
    if (!/^\d{23}$/.test(rad)) continue;
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
          // Contract verified live (iter46): the endpoint rejects anything
          // without all four of these fields. KK2 — workflow_type is always
          // sent: upstream validates workflow only when it is present, so
          // omitting it skips the guard and defaults the matter to CGP.
          body: JSON.stringify({
            work_item_id: wi.id,
            radicado: rad,
            new_state: "ACTIVE",
            workflow_type: String(wi.workflow_type ?? "").trim() || "INDETERMINADO",
            occurred_at: new Date().toISOString(),
          }),
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

  const inspeccion = inspect.map((rad) => ({
    radicado: rad,
    upstream_presente: upstreamByRadicado.has(rad),
    upstream_activo: upstreamByRadicado.get(rad) ?? null,
  }));

  return json({
    ok: true,
    inspeccion,
    inventario_upstream: upstreamByRadicado.size,
    inventario_sin_bandera: inventory.length - upstreamByRadicado.size,
    cartera_evaluada: items?.length ?? 0,
    divergencias: divergences.length,
    reenrolados: repaired,
    detalle: divergences,
  });
});
