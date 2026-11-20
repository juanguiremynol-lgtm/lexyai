/**
 * 30/09–01/10/2026 incident: the monitor asked for depth 60 while
 * claim_estados_monitor_run only accepted <= 32, so every daily estados claim
 * was rejected and no matter was read. Keep both numbers in lockstep.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const MON = readFileSync("supabase/functions/_shared/estadosMonitor.ts", "utf8");
const MIG = readFileSync("supabase/migrations/20261020010000_public_monitor_durable.sql", "utf8");

describe("estados monitor depth budget", () => {
  it("continues the same durable run only while its database budget and claimed work remain", () => {
    expect(MON).toContain('db.rpc("start_public_monitor_run"');
    expect(MON).toContain('db.rpc("finish_public_monitor_hop"');
    expect(MON).toMatch(/state\?\.remaining_count > 0 && state\.depth_remaining > 0 && \(claimed \?\? \[\]\)\.length > 0/);
    expect(MON).toContain('run_id: runId, depth_remaining: state.depth_remaining');
    expect(MIG).toMatch(/SET depth_remaining=\s*[1-9]\d*/i);
    expect(MIG).toMatch(/depth_remaining=greatest\(r\.depth_remaining-1,0\)/i);
  });

  it("a rejected claim is recorded, not silent", () => {
    expect(MON).toContain("RUN_NOT_STARTED");
    expect(MON).toContain("attempted: 0");
  });
});
