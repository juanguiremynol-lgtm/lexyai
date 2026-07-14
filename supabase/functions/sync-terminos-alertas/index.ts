// DEPRECATED — 2026-07-14
//
// This function is a no-op stub. It previously read Andromeda's `/terminos`
// endpoint and generated TERMINO_CRITICO/TERMINO_VENCIDO alerts, and later
// TERM_ENGINE_DISCREPANCY alerts as a cross-check against the local engine.
//
// Andromeda `/terminos` was audited (GCP side) and found unfit as an oracle:
//   1. `terminos_procesales` catalog has 0 rows → endpoint always empty.
//   2. Arithmetic (when it fires) is `ancla + (dias_habiles * 1.5)::INT` in
//      CALENDAR days, ignoring holidays, judicial vacancy and the "next
//      business day" rule.
//   3. Anchor date is the SCRAPE timestamp for CPNU/SAMAI (not the legal
//      fecha_actuacion) — only correct for PP.
//
// Because contrasting against an oracle with that behavior would only
// generate noise, `sync-terminos-alertas` is deprecated. The single source
// of truth for procedural terms is now the LOCAL engine
// (`work_item_deadlines`, `deadline_rules`, `providencia_classification_rules`,
// `compute_deadline_for_publicacion`, `compute_deadline_for_actuacion`,
// evaluated daily by `evaluate-deadline-alerts`).
//
// The cron job is also disabled (see cronRegistry / cron-registry).
// This stub is preserved so the deployed HTTP surface returns a documented
// noop (200) instead of 404.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = {
    ok: true,
    noop: true,
    deprecated: true,
    reason: "andromeda_terminos_unfit_as_oracle",
    detail:
      "Andromeda /terminos catalog is empty; when computing it uses calendar-day arithmetic (dias_habiles * 1.5) with a scrape-timestamp anchor for CPNU/SAMAI. Cannot serve as cross-check. Local engine (work_item_deadlines) is the sole source of truth.",
    replaced_by: "compute_deadline_for_publicacion / compute_deadline_for_actuacion + evaluate-deadline-alerts",
    finished_at: new Date().toISOString(),
  };

  console.warn("[sync-terminos-alertas] deprecated_noop", payload);
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
