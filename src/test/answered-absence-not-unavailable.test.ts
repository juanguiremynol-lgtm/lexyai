/**
 * An answered absence is an ANSWER.
 *
 * Adapters report "the provider replied and had nothing" as ok:false with HTTP
 * 200. Feeding that straight into the transport classifier as success:false
 * turned every routine "sin novedades" read into UNAVAILABLE: the run was
 * downgraded to PARTIAL/FAILED with PROVIDER_UNAVAILABLE, and the fallback
 * provider — which only fires on NOT_FOUND — was never consulted.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const orchestrator = readFileSync("supabase/functions/_shared/syncOrchestrator.ts", "utf8");

describe("safeProviderFetch — answered absence vs silence", () => {
  it("treats an empty or not-found adapter result as an answer", () => {
    expect(orchestrator).toMatch(
      /const answeredAbsence = result\.isEmpty === true \|\| isAnsweredAbsence\(result\.errorCode\)/,
    );
    expect(orchestrator).toMatch(/const answered = result\.ok === true \|\| answeredAbsence/);
    expect(orchestrator).toMatch(/success: answered,/);
  });

  it("no longer derives the success flag from `ok` alone", () => {
    expect(orchestrator).not.toMatch(/success: result\.ok \? true : false/);
  });

  it("does not read a missing httpStatus on an answered read as network silence", () => {
    expect(orchestrator).toMatch(/httpStatus: result\.httpStatus \?\? \(answered \? 200 : null\)/);
  });

  it("reports an answered absence as found:false so it classifies as ANSWERED_ABSENCE", () => {
    expect(orchestrator).toMatch(/found: answeredAbsence \? false : result\.found/);
  });
});
