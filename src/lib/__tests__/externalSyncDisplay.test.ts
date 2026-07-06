import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ONLINE_SYNC_ELIGIBLE_WORKFLOWS,
  externalDisplayModeFor,
} from "@/lib/externalSyncDisplay";

/**
 * Consistency check: the frontend display mapping must not drift from
 * supabase/functions/_shared/onlineSyncEligibility.ts.
 * If this test fails, update BOTH files together.
 */
describe("externalSyncDisplay", () => {
  it("mirrors the backend ONLINE_SYNC_ELIGIBLE_WORKFLOWS list", () => {
    const backendSrc = readFileSync(
      resolve(process.cwd(), "supabase/functions/_shared/onlineSyncEligibility.ts"),
      "utf-8",
    );
    // Extract the array literal after ONLINE_SYNC_ELIGIBLE_WORKFLOWS =
    const match = backendSrc.match(/ONLINE_SYNC_ELIGIBLE_WORKFLOWS\s*=\s*\[([^\]]+)\]/);
    expect(match, "backend eligibility list not found").toBeTruthy();
    const backendList = (match![1].match(/"([A-Z0-9_]+)"/g) ?? []).map((s) =>
      s.replace(/"/g, ""),
    );
    expect([...ONLINE_SYNC_ELIGIBLE_WORKFLOWS].sort()).toEqual(backendList.sort());
  });

  it("maps CPACA to estados, other eligible to publicaciones, ineligible to none", () => {
    expect(externalDisplayModeFor("CPACA")).toBe("estados");
    expect(externalDisplayModeFor("CGP")).toBe("publicaciones");
    expect(externalDisplayModeFor("LABORAL")).toBe("publicaciones");
    expect(externalDisplayModeFor("TUTELA")).toBe("publicaciones");
    expect(externalDisplayModeFor("PENAL_906")).toBe("publicaciones");
    expect(externalDisplayModeFor("GOV_PROCEDURE")).toBe("none");
    expect(externalDisplayModeFor("PETICION")).toBe("none");
    expect(externalDisplayModeFor(null)).toBe("none");
    expect(externalDisplayModeFor("UNKNOWN")).toBe("none");
  });
});