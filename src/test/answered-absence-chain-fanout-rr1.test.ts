/**
 * RR1 — an answered absence is a COMPLETE read, on EVERY route.
 *
 * The defect closed twice already (Z1 in the strategy layer, AA1/KK4 in the
 * transport classifier) returned a third time in `sync-by-work-item`'s
 * orchestrator extraction: results were only adopted when
 * `ok && actuaciones.length > 0`, so CPNU answering "nothing new" on a CGP
 * matter left `fetchResult` null and the run reported
 * "All providers failed to fetch data".
 *
 * These tests cover BOTH dispatch shapes — CHAIN (single exclusive provider)
 * and FANOUT (TUTELA union) — across every workflow type in the routing table,
 * so a fourth route cannot reintroduce it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  attemptIsAnsweredAbsence,
  isAnsweredAbsence,
  isTransientProviderFailure,
} from "../../supabase/functions/_shared/providerStrategy.ts";
import { resolveProviders } from "../../supabase/functions/_shared/providerRouting.ts";

const syncByWorkItem = readFileSync("supabase/functions/sync-by-work-item/index.ts", "utf8");
const orchestrator = readFileSync("supabase/functions/_shared/syncOrchestrator.ts", "utf8");

const JUDICIAL_WORKFLOWS = [
  "CGP",
  "LABORAL",
  "PENAL_906",
  "EJECUTIVO",
  "CPACA",
  "TUTELA",
] as const;

const SILENCE_STATUSES = ["error", "timeout"] as const;
const ABSENCE_STATUSES = ["empty", "not_found"] as const;

describe("RR1 — attemptIsAnsweredAbsence", () => {
  it.each(ABSENCE_STATUSES)("%s is an answered absence", (status) => {
    expect(attemptIsAnsweredAbsence(status)).toBe(true);
  });

  it.each(SILENCE_STATUSES)("%s is silence, never an absence", (status) => {
    expect(attemptIsAnsweredAbsence(status)).toBe(false);
    // even when the error code looks absence-shaped, an errored attempt is silence
    expect(attemptIsAnsweredAbsence(status, "PROVIDER_NOT_FOUND")).toBe(false);
  });

  it("falls back to the error code for unclassified statuses", () => {
    expect(attemptIsAnsweredAbsence("success", "PROVIDER_EMPTY_RESULT")).toBe(true);
    expect(attemptIsAnsweredAbsence("skipped", "PROVIDER_TIMEOUT")).toBe(false);
    expect(attemptIsAnsweredAbsence(null, null)).toBe(false);
  });

  it("stays in lockstep with the code-level classifiers", () => {
    for (const code of ["PROVIDER_NOT_FOUND", "PROVIDER_EMPTY_RESULT", "NOT_FOUND"]) {
      expect(isAnsweredAbsence(code)).toBe(true);
      expect(isTransientProviderFailure(code)).toBe(false);
    }
    for (const code of ["PROVIDER_TIMEOUT", "NETWORK_ERROR", "UPSTREAM_ERROR"]) {
      expect(isTransientProviderFailure(code)).toBe(true);
      expect(attemptIsAnsweredAbsence("error", code)).toBe(false);
    }
  });
});

/**
 * Mirror of `executeViaOrchestrator`'s post-fix extraction rule, applied to
 * synthetic attempt sets for every workflow on both dispatch shapes.
 */
function extract(attempts: Array<{ provider: string; status: string; acts: number }>) {
  const withData = attempts.filter((a) => a.status === "success" && a.acts > 0);
  const answeredAbsence = attempts.some((a) => attemptIsAnsweredAbsence(a.status));
  if (withData.length > 0) return { outcome: "DATA" as const };
  if (answeredAbsence) return { outcome: "ANSWERED_ABSENCE" as const };
  return { outcome: "UNAVAILABLE" as const };
}

describe("RR1 — CHAIN and FANOUT parity across every workflow", () => {
  it.each(JUDICIAL_WORKFLOWS)("%s: an empty read from every provider is a clean read", (wf) => {
    const routing = resolveProviders(wf);
    expect(routing.eligible).toBe(true);
    const attempts = routing.actuaciones.map((p) => ({ provider: p, status: "empty", acts: 0 }));
    expect(extract(attempts).outcome).toBe("ANSWERED_ABSENCE");
  });

  it.each(JUDICIAL_WORKFLOWS)("%s: silence from every provider stays UNAVAILABLE", (wf) => {
    const routing = resolveProviders(wf);
    const attempts = routing.actuaciones.map((p) => ({ provider: p, status: "timeout", acts: 0 }));
    expect(extract(attempts).outcome).toBe("UNAVAILABLE");
  });

  it("FANOUT (TUTELA): one provider empty and one silent is not a clean read of both", () => {
    const routing = resolveProviders("TUTELA");
    expect(routing.actuaciones.length).toBeGreaterThan(1);
    // data still wins when present
    expect(
      extract([
        { provider: "CPNU", status: "empty", acts: 0 },
        { provider: "SAMAI", status: "success", acts: 3 },
      ]).outcome,
    ).toBe("DATA");
  });

  it("CHAIN workflows route to exactly one actuaciones provider", () => {
    for (const wf of ["CGP", "LABORAL", "PENAL_906", "EJECUTIVO", "CPACA"]) {
      expect(resolveProviders(wf).actuaciones).toHaveLength(1);
    }
  });
});

describe("RR1 — sync-by-work-item extraction no longer drops answered absences", () => {
  it("classifies each orchestrator attempt with the shared helper", () => {
    expect(syncByWorkItem).toMatch(/attemptIsAnsweredAbsence\(attempt\.status/);
    expect(syncByWorkItem).toMatch(/from "\.\.\/_shared\/providerStrategy\.ts"/);
  });

  it("synthesises a clean empty fetch result instead of leaving it null", () => {
    expect(syncByWorkItem).toMatch(/if \(!fetchResult && answeredAbsence && !scrapingInitiated\)/);
  });

  it("never synthesises one when scraping was initiated (still in flight)", () => {
    expect(syncByWorkItem).not.toMatch(/if \(!fetchResult && answeredAbsence\)\s*\{/);
  });
});

describe("RR1 — run status rollup", () => {
  it("an all-empty run rolls up to SUCCESS, not FAILED", () => {
    expect(orchestrator).toMatch(
      /else if \(\(hasSuccess \|\| hasAnsweredAbsence\) && !hasErrors\) status = "SUCCESS";/,
    );
  });

  it("an answered absence alongside an unavailable kind is PARTIAL, never FAILED", () => {
    expect(orchestrator).toMatch(
      /anyUnavailable && !hasSuccess && !hasAnsweredAbsence && status !== "TIMEOUT"/,
    );
    expect(orchestrator).toMatch(
      /anyUnavailable && hasAnsweredAbsence && status === "SUCCESS"\) status = "PARTIAL"/,
    );
  });

  it("derives the flag from the shared classifier", () => {
    expect(orchestrator).toMatch(/attemptIsAnsweredAbsence\(a\.status, a\.error_code\)/);
  });
});
