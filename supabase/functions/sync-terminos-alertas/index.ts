// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TERMINOS_URL =
  "https://andromeda-read-api-zcrd2ua7xq-uc.a.run.app/terminos";

interface TerminoApi {
  id: number | string;
  radicado: string;
  workflow_type?: string | null;
  despacho?: string | null;
  demandante?: string | null;
  demandado?: string | null;
  tipo_auto?: string | null;
  accion_abogado?: string | null;
  dias_habiles?: number | null;
  prioridad?: string | null;
  norma?: string | null;
  consecuencia?: string | null;
  fecha_auto?: string | null;
  fecha_limite?: string | null;
  descripcion_auto?: string | null;
  estado?: string | null;
  alerta?: string | null;
}

function normalizeRadicado(r: string): string {
  return (r || "").trim().replace(/\s+/g, "");
}

function mapEntityType(workflow: string | null | undefined): string {
  switch ((workflow || "").toUpperCase()) {
    case "CGP":
      return "CGP_FILING";
    case "CPACA":
      return "CPACA";
    case "TUTELA":
      return "TUTELA";
    case "LABORAL":
      return "LABORAL";
    case "PENAL_906":
    case "PENAL":
      return "CGP_FILING";
    case "GOV_PROCEDURE":
      return "PETICION";
    default:
      return "CGP_FILING";
  }
}

async function sha256Hex32(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = new Date().toISOString();
  console.log("[sync-terminos-alertas] start", startedAt);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let fetched = 0;
  let candidates = 0;
  let alertsCreated = 0;
  let alertsSkippedDuplicate = 0;
  let noOwner = 0;
  let errors = 0;

  try {
    const resp = await fetch(TERMINOS_URL, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      throw new Error(`Andromeda /terminos HTTP ${resp.status}`);
    }
    const raw = await resp.json();
    const terminos: TerminoApi[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.items)
      ? raw.items
      : [];
    fetched = terminos.length;

    // TASK 5: env-gated debug logging for radicado matching visibility
    const DEBUG = (Deno.env.get("LOG_LEVEL") ?? "").toLowerCase() === "debug";
    if (DEBUG) {
      console.log(
        `[sync-terminos-alertas][debug] /terminos returned ${fetched} rows. ` +
        `Sample radicados: ${terminos.slice(0, 5).map((t) => t.radicado).join(", ")}`,
      );
    }

    // No-op guard: surface upstream API silence so operators can distinguish
    // "Andromeda has no terminos" from "we filtered everything out".
    if (fetched === 0) {
      console.warn(
        "[sync-terminos-alertas] noop_no_upstream_data: Andromeda /terminos returned 0 rows. " +
        "No alert_instances will be created. Check upstream API health.",
      );
      const summary = {
        ok: true,
        noop: true,
        reason: "no_upstream_data",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        fetched: 0,
        candidates: 0,
        alerts_created: 0,
        alerts_skipped_duplicate: 0,
        no_owner: 0,
        errors: 0,
      };
      console.log("[sync-terminos-alertas] done", summary);
      return new Response(JSON.stringify(summary), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const candidatos = terminos.filter((t) => {
      const alerta = (t.alerta || "").toUpperCase();
      const estado = (t.estado || "").toUpperCase();
      return (
        (alerta === "URGENTE" || alerta === "VENCIDO") &&
        estado === "PENDIENTE"
      );
    });
    candidates = candidatos.length;

    if (candidates === 0) {
      console.warn(
        `[sync-terminos-alertas] noop_no_candidates: fetched ${fetched} rows ` +
        `but none matched filter (alerta IN URGENTE/VENCIDO AND estado=PENDIENTE). ` +
        `Sample estados: ${terminos.slice(0, 5).map((t) => `${t.alerta}/${t.estado}`).join(", ")}`,
      );
    }

    for (const term of candidatos) {
      const radNorm = normalizeRadicado(term.radicado);
      if (!radNorm) {
        noOwner++;
        continue;
      }

      if (DEBUG) {
        console.log(
          `[sync-terminos-alertas][debug] candidate termino_id=${term.id} ` +
          `raw_radicado="${term.radicado}" normalized="${radNorm}" ` +
          `alerta=${term.alerta} estado=${term.estado}`,
        );
      }

      const { data: items, error: wiErr } = await supabase
        .from("work_items")
        .select("id, owner_id, organization_id, workflow_type")
        .eq("radicado", radNorm)
        .is("deleted_at", null);

      if (wiErr) {
        console.error("[sync-terminos-alertas] work_items query error", wiErr);
        errors++;
        continue;
      }

      if (!items || items.length === 0) {
        console.warn(
          `[sync-terminos-alertas] no_owner radicado=${radNorm} termino_id=${term.id}`,
        );
        noOwner++;
        continue;
      }

      // Dedup por owner
      const seenOwners = new Set<string>();
      for (const wi of items) {
        if (seenOwners.has(wi.owner_id)) continue;
        seenOwners.add(wi.owner_id);

        const alertaUpper = (term.alerta || "").toUpperCase();
        const prioridadUpper = (term.prioridad || "").toUpperCase();

        const alertType =
          alertaUpper === "VENCIDO" ? "TERMINO_VENCIDO" : "TERMINO_CRITICO";
        const severity =
          prioridadUpper === "CRITICA" ? "CRITICAL" : "WARNING";

        const fingerprint = await sha256Hex32(
          `${wi.owner_id}:${radNorm}:${term.id}:${term.fecha_limite ?? ""}`,
        );

        const title = term.tipo_auto || "Término procesal";
        const message = `${
          term.accion_abogado || "Acción requerida"
        } — Vence: ${term.fecha_limite || "sin fecha"}`;

        const payload = {
          ...term,
          radicado: radNorm,
          source: "andromeda-terminos-api",
        };

        const actions = [
          {
            label: "Ver expediente",
            action: "navigate",
            params: { path: `/app/work-items/${wi.id}` },
          },
        ];

        // ── Cross-check against LOCAL term engine ────────────────────────
        // The local engine (work_item_deadlines) is now the source of truth.
        // If a matching PENDING deadline exists near the upstream fecha_limite,
        // suppress the Andromeda alert (avoid duplication).
        // If not, emit a DATA_QUALITY discrepancy for review instead of a
        // TERMINO_* alert.
        const upstreamLimite = term.fecha_limite;
        let localMatch = false;
        if (upstreamLimite) {
          const from = new Date(new Date(upstreamLimite).getTime() - 3 * 86400000)
            .toISOString().slice(0, 10);
          const to = new Date(new Date(upstreamLimite).getTime() + 3 * 86400000)
            .toISOString().slice(0, 10);
          const { data: dl } = await supabase
            .from("work_item_deadlines")
            .select("id")
            .eq("work_item_id", wi.id)
            .in("status", ["PENDING", "REQUIERE_REVISION_MANUAL"])
            .gte("deadline_date", from)
            .lte("deadline_date", to)
            .limit(1);
          localMatch = !!(dl && dl.length > 0);
        }

        if (localMatch) {
          // Local engine already covers this — do not duplicate as TERMINO_*.
          alertsSkippedDuplicate++;
          continue;
        }

        // No local coverage — emit a DATA_QUALITY discrepancy for operators to
        // reconcile. Fingerprint dedupes per (radicado, termino_id, fecha_limite).
        const dqFingerprint = await sha256Hex32(
          `dq:${wi.owner_id}:${radNorm}:${term.id}:${term.fecha_limite ?? ""}`,
        );
        await supabase.from("alert_instances").upsert(
          {
            owner_id: wi.owner_id,
            organization_id: wi.organization_id,
            entity_type: mapEntityType(wi.workflow_type),
            entity_id: wi.id,
            alert_type: "TERM_ENGINE_DISCREPANCY",
            alert_source: "TERMINOS_API",
            severity: severity === "CRITICAL" ? "WARNING" : "INFO",
            status: "PENDING",
            title: `Discrepancia: upstream ${alertaUpper} sin equivalente local`,
            message: `Andromeda reporta ${term.tipo_auto ?? "término"} (vence ${term.fecha_limite ?? "?"}) pero el motor local no tiene un deadline equivalente. Revisar clasificación o reglas.`,
            payload: {
              ...payload,
              kind: "LOCAL_MISSING",
              upstream_deadline_date: term.fecha_limite,
              engine_local: "work_item_deadlines",
            },
            actions,
            fingerprint: dqFingerprint,
            fired_at: new Date().toISOString(),
          },
          { onConflict: "fingerprint", ignoreDuplicates: true },
        );
        alertsCreated++;
        continue;

        const { data: inserted, error: insErr } = await supabase
          .from("alert_instances")
          .upsert(
            {
              owner_id: wi.owner_id,
              organization_id: wi.organization_id,
              entity_type: mapEntityType(wi.workflow_type),
              entity_id: wi.id,
              alert_type: alertType,
              alert_source: "TERMINOS_API",
              severity,
              status: "PENDING",
              title,
              message,
              payload,
              actions,
              fingerprint,
              fired_at: new Date().toISOString(),
            },
            { onConflict: "fingerprint", ignoreDuplicates: true },
          )
          .select("id");

        if (insErr) {
          console.error(
            `[sync-terminos-alertas] insert error radicado=${radNorm} termino_id=${term.id} owner=${wi.owner_id}`,
            insErr,
          );
          errors++;
          continue;
        }

        if (inserted && inserted.length > 0) {
          alertsCreated++;
          console.log(
            `[sync-terminos-alertas] created radicado=${radNorm} termino_id=${term.id} owner=${wi.owner_id} type=${alertType}`,
          );
        } else {
          alertsSkippedDuplicate++;
        }
      }
    }

    const summary = {
      ok: true,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      fetched,
      candidates,
      alerts_created: alertsCreated,
      alerts_skipped_duplicate: alertsSkippedDuplicate,
      no_owner: noOwner,
      errors,
    };
    console.log("[sync-terminos-alertas] done", summary);
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("[sync-terminos-alertas] fatal", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: (err as Error)?.message ?? String(err),
        fetched,
        candidates,
        alerts_created: alertsCreated,
        alerts_skipped_duplicate: alertsSkippedDuplicate,
        no_owner: noOwner,
        errors: errors + 1,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});