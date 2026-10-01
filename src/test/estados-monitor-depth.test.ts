/**
 * 30/09–01/10/2026 incident: the monitor asked for depth 60 while
 * claim_estados_monitor_run only accepted <= 32, so every daily estados claim
 * was rejected and no matter was read. Keep both numbers in lockstep.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const MON = readFileSync("supabase/functions/_shared/estadosMonitor.ts", "utf8");
const MIG = readFileSync("drizzle/migrations/0035_estados_monitor_depth_budget_64.sql", "utf8");

describe("estados monitor depth budget", () => {
  it("monitor MAX_DEPTH fits the claim RPC ceiling", () => {
    const max = Number(MON.match(/const MAX_DEPTH = (\d+)/)?.[1]);
    const ceiling = Number(MIG.match(/_depth_budget > (\d+)/)?.[1]);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(ceiling);
  });

  it("a rejected claim is recorded, not silent", () => {
    expect(MON).toContain("RUN_NOT_STARTED");
    expect(MON).toContain("attempted: 0");
  });
});
