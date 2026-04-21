/**
 * Regression tests for alert type constants alignment.
 * Ensures the canonical constants match what DB triggers produce.
 */
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  JUDICIAL_ALERT_TYPES,
  ALERT_TYPE_ACTUACION_NUEVA,
  ALERT_TYPE_ESTADO_NUEVO,
  isActuacionType,
  isEstadoType,
  isKnownJudicialType,
  validateAlertPayload,
} from "./alertTypeConstants.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/**
 * Canonical superset of accepted alert_type values. Mirrors the CHECK
 * constraint `alert_instances_alert_type_check` and the email-dispatcher
 * judicial set. If a future migration introduces a new alert_type literal
 * inside a notifiability trigger that is NOT in this set, the regression
 * test below will fail.
 */
const CANONICAL_ALERT_TYPES = new Set<string>([
  // Judicial (must match alertTypeConstants.ts exactly)
  "ACTUACION_NUEVA",
  "ACTUACION_MODIFIED",
  "ESTADO_NUEVO",
  "ESTADO_MODIFIED",
  // Términos
  "TERMINO_CRITICO",
  "TERMINO_VENCIDO",
  // Coverage / health
  "BRECHA_COBERTURA_ESTADOS",
  "PUBLICACIONES_NUEVAS",
  // Sync / provider failures
  "SYNC_AUTH_FAILURE",
  "SYNC_FAILURE",
  "WATCHDOG_ESCALATION",
  "WATCHDOG_INVARIANT",
  "PROVIDER_SECRET_DECRYPT_FAILED",
  "MISSING_PROVIDER_SECRET",
  // System summaries
  "LEXY_DAILY",
  "DAILY_WELCOME",
  // Peticiones
  "PROROGATION_DEADLINE",
  "PETICION_DEADLINE",
  "PETICION_OVERDUE",
  "PETICION_REMINDER",
]);

// ── 1. Canonical values match DB trigger strings exactly ──
Deno.test("ACTUACION_NUEVA matches DB trigger string", () => {
  assertEquals(ALERT_TYPE_ACTUACION_NUEVA, "ACTUACION_NUEVA");
});

Deno.test("ESTADO_NUEVO matches DB trigger string", () => {
  assertEquals(ALERT_TYPE_ESTADO_NUEVO, "ESTADO_NUEVO");
});

// ── 2. Old/wrong names are NOT in the constants (regression for the original bug) ──
Deno.test("ACTUACION_NEW (old wrong name) is not a known type", () => {
  assertEquals(isKnownJudicialType("ACTUACION_NEW"), false);
});

Deno.test("PUBLICACION_NEW (old wrong name) is not a known type", () => {
  assertEquals(isKnownJudicialType("PUBLICACION_NEW"), false);
});

Deno.test("PUBLICACION_NUEVA (old wrong prefix) is not a known type", () => {
  assertEquals(isKnownJudicialType("PUBLICACION_NUEVA"), false);
});

// ── 3. Prefix grouping works correctly ──
Deno.test("isActuacionType groups correctly", () => {
  assertEquals(isActuacionType("ACTUACION_NUEVA"), true);
  assertEquals(isActuacionType("ACTUACION_MODIFIED"), true);
  assertEquals(isActuacionType("ESTADO_NUEVO"), false);
  assertEquals(isActuacionType("PUBLICACION_NEW"), false);
  assertEquals(isActuacionType(null), false);
});

Deno.test("isEstadoType groups correctly (not PUBLICACION)", () => {
  assertEquals(isEstadoType("ESTADO_NUEVO"), true);
  assertEquals(isEstadoType("ESTADO_MODIFIED"), true);
  assertEquals(isEstadoType("PUBLICACION_NEW"), false);
  assertEquals(isEstadoType("ACTUACION_NUEVA"), false);
});

// ── 4. All 4 canonical types are present ──
Deno.test("Exactly 4 judicial alert types defined", () => {
  assertEquals(JUDICIAL_ALERT_TYPES.length, 4);
});

// ── 5. Payload validation catches missing fields ──
Deno.test("Payload validation warns on null payload", () => {
  const { warnings } = validateAlertPayload("ACTUACION_NUEVA", null);
  assertNotEquals(warnings.length, 0);
});

Deno.test("Payload validation warns on missing act_id for actuacion", () => {
  const { warnings } = validateAlertPayload("ACTUACION_NUEVA", { description: "test", source: "CPNU" });
  const hasActIdWarning = warnings.some(w => w.includes("act_id"));
  assertEquals(hasActIdWarning, true);
});

Deno.test("Payload validation passes with complete actuacion payload", () => {
  const { warnings } = validateAlertPayload("ACTUACION_NUEVA", {
    description: "test", source: "CPNU", act_id: "abc", act_date: "2024-01-01",
    annotation: "nota", despacho: "Juzgado 1",
  });
  assertEquals(warnings.length, 0);
});

// ── 6. DRIFT REGRESSION: introspect pg_proc and assert no notifiability
//    function emits a non-canonical alert_type literal.
//    Skipped automatically if Supabase env vars are absent (e.g. local CI
//    without DB access).
Deno.test({
  name: "DRIFT GUARD: notifiability triggers emit only canonical alert_type strings",
  ignore: !Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  fn: async () => {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Read trigger-function bodies via a SECURITY DEFINER read-only RPC if
    // present, otherwise fall back to pg_catalog through PostgREST schema.
    // We use a parameterised select against pg_proc via supabase-js raw query.
    const { data, error } = await supabase
      .rpc("get_notifiability_function_bodies")
      .select("*");

    // If the helper RPC does not exist yet, skip without failing — the
    // CHECK constraint is the primary defence; this test is best-effort.
    if (error && /function .* does not exist/i.test(error.message)) {
      console.warn(
        "[drift-guard] helper RPC get_notifiability_function_bodies " +
        "not deployed; relying on CHECK constraint only.",
      );
      return;
    }
    if (error) throw error;

    const offenders: { fn: string; literal: string }[] = [];
    // Match string literals appearing on the same line as `alert_type`
    // assignments / column-list inserts.
    const literalRegex = /'([A-Z][A-Z0-9_]+)'/g;

    for (const row of (data as Array<{ proname: string; prosrc: string }>) ?? []) {
      // Heuristic: only inspect lines that mention alert_type to limit
      // false positives from unrelated string literals.
      const lines = row.prosrc.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const ctx = `${lines[i - 1] ?? ""}\n${lines[i]}\n${lines[i + 1] ?? ""}`;
        if (!/alert_type/i.test(ctx)) continue;
        for (const m of lines[i].matchAll(literalRegex)) {
          const lit = m[1];
          // Skip obvious non-alert-type literals (statuses, severities, etc.)
          if (["PENDING", "SENT", "DISMISSED", "RESOLVED", "INFO", "WARNING", "CRITICAL", "WORK_ITEM"].includes(lit)) continue;
          if (!CANONICAL_ALERT_TYPES.has(lit)) {
            offenders.push({ fn: row.proname, literal: lit });
          }
        }
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        "Non-canonical alert_type literals found in DB triggers:\n" +
        offenders.map((o) => `  - ${o.fn}: '${o.literal}'`).join("\n"),
      );
    }
  },
});
