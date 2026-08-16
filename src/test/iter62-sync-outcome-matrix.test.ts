import { describe, it, expect } from "vitest";
import {
  isCompletedProviderRead,
  estadosSignalAlerts,
  ESTADOS_SIGNAL_LABEL,
  ESTADOS_SIGNAL_EXPLANATION,
  type EstadosSignalClass,
} from "@/lib/estados-coverage-signal";

/**
 * ITER62 — four situations, four outcomes, none borrowing another's meaning.
 *
 * Mirrors the classification in supabase/functions/_shared/syncTimeline.ts and
 * the SQL guard `has_completed_estados_read`.
 */
interface Outcome { status: string; provider: string; error_code: string | null }

function classifyRun(input: {
  httpStatus: number;
  ok: boolean;
  providerResolved: string | null;
  pendingUpstream?: boolean;
  inserted?: number;
}): Outcome {
  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return { status: "rejected", provider: "none", error_code: "CALLER_UNAUTHORIZED" };
  }
  if (input.pendingUpstream) {
    return { status: "pending_upstream", provider: input.providerResolved ?? "unknown", error_code: "PENDING_UPSTREAM" };
  }
  if (!input.ok) return { status: "error", provider: input.providerResolved ?? "unknown", error_code: "PROVIDER_ERROR" };
  if (!input.providerResolved) {
    return { status: "skipped", provider: "unknown", error_code: "PROVIDER_UNRESOLVED" };
  }
  if ((input.inserted ?? 0) === 0) return { status: "empty", provider: input.providerResolved, error_code: null };
  return { status: "success", provider: input.providerResolved, error_code: null };
}

describe("iter62 — sync outcome matrix", () => {
  it("a run that cannot resolve its provider asserts nothing", () => {
    const o = classifyRun({ httpStatus: 200, ok: true, providerResolved: null });
    expect(o).toEqual({ status: "skipped", provider: "unknown", error_code: "PROVIDER_UNRESOLVED" });
    expect(isCompletedProviderRead(o)).toBe(false);
  });

  it("a provider still scraping is PENDING_UPSTREAM, never empty", () => {
    const o = classifyRun({ httpStatus: 200, ok: true, providerResolved: "publicaciones", pendingUpstream: true });
    expect(o.status).toBe("pending_upstream");
    expect(o.error_code).toBe("PENDING_UPSTREAM");
    expect(isCompletedProviderRead(o)).toBe(false);
  });

  it("a run rejected at our own gate stays out of provider health", () => {
    const o = classifyRun({ httpStatus: 401, ok: false, providerResolved: "cpnu" });
    expect(o).toEqual({ status: "rejected", provider: "none", error_code: "CALLER_UNAUTHORIZED" });
    expect(isCompletedProviderRead(o)).toBe(false);
  });

  it("only a completed zero-row provider answer is EMPTY", () => {
    const o = classifyRun({ httpStatus: 200, ok: true, providerResolved: "cpnu", inserted: 0 });
    expect(o).toEqual({ status: "empty", provider: "cpnu", error_code: null });
    expect(isCompletedProviderRead(o)).toBe(true);
  });

  it("no outcome borrows another's meaning", () => {
    const outcomes = [
      classifyRun({ httpStatus: 200, ok: true, providerResolved: null }),
      classifyRun({ httpStatus: 200, ok: true, providerResolved: "publicaciones", pendingUpstream: true }),
      classifyRun({ httpStatus: 401, ok: false, providerResolved: "cpnu" }),
      classifyRun({ httpStatus: 200, ok: true, providerResolved: "cpnu", inserted: 0 }),
    ];
    expect(new Set(outcomes.map((o) => o.status)).size).toBe(4);
  });
});

describe("iter62 — coverage verdicts never consume a false absence", () => {
  it("an incomplete read cannot feed a coverage verdict", () => {
    for (const code of ["PENDING_UPSTREAM", "PROVIDER_UNRESOLVED", "CALLER_UNAUTHORIZED"]) {
      expect(isCompletedProviderRead({ status: "empty", provider: "publicaciones", error_code: code })).toBe(false);
    }
  });

  it("LECTURA_NO_CONCLUYENTE never alerts", () => {
    expect(
      estadosSignalAlerts({
        signal_class: "LECTURA_NO_CONCLUYENTE" as EstadosSignalClass,
        recent_unmatched_count: 5,
        alertable_unmatched_count: 5,
      }),
    ).toBe(false);
  });

  it("a completed provider answer still alerts", () => {
    expect(
      estadosSignalAlerts({
        signal_class: "ESTADOS_ESPERADOS_AUSENTES",
        recent_unmatched_count: 1,
        alertable_unmatched_count: 1,
      }),
    ).toBe(true);
  });

  it("the new class is user-facing in Spanish", () => {
    expect(ESTADOS_SIGNAL_LABEL.LECTURA_NO_CONCLUYENTE).toBe("Lectura no concluyente");
    expect(ESTADOS_SIGNAL_EXPLANATION.LECTURA_NO_CONCLUYENTE).toMatch(/no afirma nada/);
  });
});
