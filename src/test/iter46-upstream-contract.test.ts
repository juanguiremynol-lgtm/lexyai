/**
 * iter46-upstream-contract — locks the three upstream contracts we got wrong,
 * each verified against a LIVE probe on 2026-08-08 rather than assumed.
 *
 *  1. `/reserva/estado` returns the REGISTRY of private matters, not a per-item
 *     lookup: probing it with one radicado answered with a different one.
 *  2. `/salud/source-health` does not exist (404 on the route). Source health is
 *     derived from `/radicados`, whose per-source flags carry the same truth.
 *  3. `/lifecycle` requires {work_item_id, radicado, new_state, occurred_at}.
 */
import { describe, it, expect } from "vitest";
import {
  parsePrivateRegistry,
  readingFor,
} from "../../supabase/functions/sync-detalle-exposicion/index.ts";
import {
  deriveSourceHealth,
  normalizeStreak,
} from "../../supabase/functions/ingest-source-health/index.ts";
import { classifyProbe, UPSTREAM_ENDPOINTS } from "../../supabase/functions/_shared/upstreamEndpoints.ts";

/** Verbatim shape returned by the live probe. */
const LIVE_REGISTRY = {
  success: true,
  total: 1,
  radicados: [
    {
      radicado: "08001405301420240080600",
      en_reserva: true,
      cpnu_id_proceso: "178654231",
      desde: "2026-08-05T01:04:44.237Z",
      ultima_verificacion: "2026-08-05T01:04:44.237Z",
      verificaciones: 1,
      workflow_type: "CGP",
    },
  ],
};

describe("iter46 · /reserva/estado is a registry, not a lookup", () => {
  it("reads the listed matter as PROCESO_PRIVADO", () => {
    const reg = parsePrivateRegistry(LIVE_REGISTRY);
    expect(reg.conclusive).toBe(true);
    const r = readingFor(reg, "08001405301420240080600");
    expect(r.expuesto).toBe(false);
    expect(r.motivo).toBe("PROCESO_PRIVADO");
    expect(r.desde).toBe("2026-08-05T01:04:44.237Z");
  });

  it("treats absence from a successfully-read registry as exposure", () => {
    const reg = parsePrivateRegistry(LIVE_REGISTRY);
    expect(readingFor(reg, "05001333301520260011300").expuesto).toBe(true);
  });

  it("a payload it cannot parse asserts NOTHING — never an empty registry", () => {
    for (const bad of [null, undefined, "", 42, {}, { success: true }]) {
      const reg = parsePrivateRegistry(bad);
      expect(reg.conclusive).toBe(false);
      // and therefore no matter may be declared exposed
      expect(readingFor(reg, "08001405301420240080600").expuesto).toBeNull();
    }
  });

  it("does not mark a matter the registry explicitly flags as no-longer-private", () => {
    const reg = parsePrivateRegistry({
      radicados: [{ radicado: "08001405301420240080600", en_reserva: false }],
    });
    expect(reg.entries.size).toBe(0);
    expect(readingFor(reg, "08001405301420240080600").expuesto).toBe(true);
  });
});

describe("iter46 · source health is derived from /radicados", () => {
  const inventory = [
    { radicado: "1", en_cpnu: true, cpnu_estado: "SUCCESS", cpnu_total_actuaciones: 4 },
    { radicado: "2", en_pp: true, pp_estado: "SUCCESS_EMPTY", pp_total_actuaciones: 0 },
    { radicado: "3", en_samai: true, samai_estado: null, samai_total_actuaciones: 0 },
    { radicado: "4", en_samai: true, samai_estado: "ERROR", samai_total_actuaciones: 0 },
  ];

  it("judges each source only on the matters enrolled in it", () => {
    const rows = deriveSourceHealth(inventory);
    // samai_estados has no enrolled matter, so it is not reported as broken
    expect(rows.map((r) => r.source).sort()).toEqual(["cpnu", "publicaciones", "samai"]);
  });

  it("counts SUCCESS_EMPTY and NOT_FOUND as successes, not failures", () => {
    const rows = deriveSourceHealth(inventory);
    expect(rows.find((r) => r.source === "publicaciones")!.status).toBe("SUCCESS");
    expect(
      deriveSourceHealth([{ radicado: "9", en_cpnu: true, cpnu_estado: "NOT_FOUND" }])[0].status,
    ).toBe("SUCCESS");
  });

  it("surfaces the SAMAI outage as DEGRADED", () => {
    const samai = deriveSourceHealth(inventory).find((r) => r.source === "samai")!;
    expect(samai.status).toBe("DEGRADED");
    expect(samai.consecutive_errors).toBe(1);
    expect(samai.last_error_message).toContain("sin lectura");
  });

  it("never read at all is SIN_LECTURA, which is not an error streak", () => {
    const rows = deriveSourceHealth([{ radicado: "9", en_samai: true, samai_estado: null }]);
    expect(rows[0].status).toBe("SIN_LECTURA");
  });

  it("LIVE STATE WINS: a successful run zeroes a reconstructed streak", () => {
    expect(normalizeStreak("SUCCESS", 9)).toBe(0);
    expect(normalizeStreak("NOT_FOUND", 9)).toBe(0);
    expect(normalizeStreak("DEGRADED", 9)).toBe(9);
  });

  it("the non-existent /salud/source-health route is no longer in the registry", () => {
    expect(UPSTREAM_ENDPOINTS.some((e) => e.path.includes("source-health"))).toBe(false);
  });
});

describe("iter46 · probe classification distinguishes sample from route", () => {
  const claseProceso = UPSTREAM_ENDPOINTS.find((e) => e.key === "cpnu.clase_proceso")!;
  const lifecycle = UPSTREAM_ENDPOINTS.find((e) => e.key === "andromeda.lifecycle")!;

  it("an unknown sample is MUESTRA_DESCONOCIDA, not a missing feature", () => {
    expect(classifyProbe(claseProceso, 404, { ok: false, error: "work_item no encontrado" }))
      .toBe("MUESTRA_DESCONOCIDA");
  });

  it("a 404 on a route that takes no sample is a genuine absence", () => {
    const health = UPSTREAM_ENDPOINTS.find((e) => e.key === "cpnu.health")!;
    expect(classifyProbe(health, 404, null)).toBe("NO_EXISTE");
  });

  it("a validation 400 proves /lifecycle exists and enforces its contract", () => {
    expect(
      classifyProbe(lifecycle, 400, { ok: false, error: "payload incompleto" }),
    ).toBe("RESUELVE");
  });

  it("health endpoints answering {status:'healthy'} resolve", () => {
    for (const key of ["samai.health", "samai_estados.health", "publicaciones.health"]) {
      const ep = UPSTREAM_ENDPOINTS.find((e) => e.key === key)!;
      expect(classifyProbe(ep, 200, { status: "healthy" })).toBe("RESUELVE");
      expect(classifyProbe(ep, 200, { status: "ok" })).toBe("RESUELVE");
    }
  });
});
