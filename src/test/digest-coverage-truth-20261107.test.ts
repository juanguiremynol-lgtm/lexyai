import { describe, expect, it } from "vitest";
import {
  digestCoverageIncomplete,
  digestHasContent,
  digestSubject,
} from "../../supabase/functions/scheduled-daily-digest/content.ts";
import { buildDigestHtml } from "../../supabase/functions/scheduled-daily-digest/html.ts";

const source = {
  source: "publicaciones", label: "Publicaciones Procesales (estados)",
  expected_count: 53, attempted_count: 53, answered_count: 13,
  usable_confirmed_count: 13, success_count: 13, success_empty_count: 0,
  not_found_count: 0, restricted_count: 0, pending_upstream_count: 40,
  error_count: 0, state: "SOURCE_DEGRADED_PARTIAL", authoritative: false,
  chain: [],
};

function payload(overrides: Record<string, unknown> = {}): any {
  return {
    recipientName: "Prueba", windowFrom: "2026-11-06T13:00:00Z", windowTo: "2026-11-07T13:00:00Z",
    monitoredCount: 53, nonJudicialCount: 0, silentCount: 0,
    actuaciones: [], estados: [], hearings: [], hearingsBeyond: [],
    stats: { procesosConNovedad: 0, publicaciones: 0, cpnu: 0, samai: 0, erroresFuente: 0 },
    deadlines: [], nonJudicialDeadlines: [], unverifiedTerms: [], importedHistory: [], reconciliations: [],
    manualReviewTerms: [], connectionIssues: [], autoPaused: [], sourceQuality: [source], coverageIncomplete: true,
    coverageExceptions: [], coveragePersistence: [], coverageWindowFrom: "2026-11-06T13:00:00Z",
    coverageWindowTo: "2026-11-07T13:00:00Z", windowLabel: "sábado", neverRead: [],
    workItems: new Map(), appBaseUrl: "https://andromeda.legal", linkExpiryDays: 30,
    ...overrides,
  };
}

describe("daily digest coverage evidence", () => {
  it("warns when a source is partial and there are no persistence rows", () => {
    const html = buildDigestHtml(payload());
    expect(html).toContain("Cobertura por verificar");
    expect(html).toContain("Aún pueden existir novedades pendientes");
    expect(html).not.toMatch(/La cobertura no cambió|siguen los mismos 0 asunto/);
    expect(digestHasContent({ rowCount: 0, manualReviewCount: 0, coverageIncomplete: true })).toBe(true);
    expect(digestSubject({ critical: false, estados: 0, actuaciones: 0, coverageIncomplete: true }))
      .toContain("cobertura por verificar");
  });

  it("does not call a failed quality check with zero denominator complete", () => {
    const failed = { ...source, expected_count: 0, answered_count: 0, usable_confirmed_count: 0,
      authoritative: false, check_failed: true, state: "SOURCE_RUN_FAILED" };
    expect(digestCoverageIncomplete([failed])).toBe(true);
    const html = buildDigestHtml(payload({ sourceQuality: [failed], coverageIncomplete: false }));
    expect(html).toContain("Cobertura por verificar");
    expect(html).toContain("Verificación no disponible");
  });

  it("treats absent quality data as unknown even if the incoming flag is false", () => {
    expect(digestCoverageIncomplete([])).toBe(true);
    expect(buildDigestHtml(payload({ sourceQuality: [], coverageIncomplete: false }))).toContain("Cobertura por verificar");
  });

  it("distinguishes answers from confirmed usable reads", () => {
    const restricted = { ...source, answered_count: 53, usable_confirmed_count: 50, authoritative: true };
    expect(digestCoverageIncomplete([restricted])).toBe(true);
    expect(digestCoverageIncomplete([{ ...restricted, usable_confirmed_count: Number.NaN }])).toBe(true);
  });

  it("omits the coverage warning only when evidence is complete", () => {
    const complete = { ...source, answered_count: 53, usable_confirmed_count: 53, authoritative: true,
      pending_upstream_count: 0, state: "SOURCE_HEALTHY_COMPLETE" };
    expect(digestCoverageIncomplete([complete])).toBe(false);
    const html = buildDigestHtml(payload({ sourceQuality: [complete], coverageIncomplete: false }));
    expect(html).toContain("0 novedades registradas");
    expect(html).not.toContain("Cobertura por verificar");
  });

  it("retains the warning in the subject when news or a critical connection issue exists", () => {
    expect(digestSubject({ critical: false, estados: 1, actuaciones: 0, coverageIncomplete: true }))
      .toContain("1 novedad · cobertura por verificar");
    expect(digestSubject({ critical: true, estados: 0, actuaciones: 0, coverageIncomplete: true }))
      .toContain("Conexión de correo caída · Resumen diario · cobertura por verificar");
    expect(digestSubject({ critical: false, estados: 0, actuaciones: 0, coverageIncomplete: false }))
      .toBe("Andromeda · Resumen diario");
  });

  it("sends a visible warning when no news is recorded and the agenda or terms could not be read", () => {
    const complete = { ...source, usable_confirmed_count: 53, authoritative: true };
    expect(digestHasContent({ rowCount: 0, manualReviewCount: 0, coverageIncomplete: false, checksUnavailable: true }))
      .toBe(true);
    expect(digestSubject({ critical: false, estados: 0, actuaciones: 0, coverageIncomplete: false, checksUnavailable: true }))
      .toBe("Andromeda · Resumen diario · verificación parcial");
    const html = buildDigestHtml(payload({
      sourceQuality: [complete], coverageIncomplete: false, unavailableChecks: ["los términos vigentes"],
      fechasPorPerderUnavailable: true,
    }));
    expect(html).toContain("No se pudieron consultar los términos vigentes.");
    expect(html).toContain("No se pudo comprobar qué fijaciones de SAMAI están en riesgo.");
  });
});
