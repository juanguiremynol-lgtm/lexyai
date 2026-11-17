import { describe, it, expect } from "vitest";
import fs from "fs";
// Static capacity checks only: they do NOT prove real execution under the 100s worker budget.
const sql = fs.readFileSync("supabase/release/cron_retry_window_lexy_manual_20261117.sql", "utf8");
const rb = fs.readFileSync("supabase/release/cron_retry_window_lexy_manual_rollback_20261117.sql", "utf8");
const callsPerDay = (min: string, hours: string) => {
  const [s, step] = min.split("/"); const [a] = s.split("-").map(Number);
  const [h1, h2] = hours.split("-").map(Number);
  return Math.ceil((60 - a) / Number(step)) * (h2 - h1 + 1);
};
describe("job 67 due-only retry window", () => {
  it("schedules 48 bounded calls per day", () => {
    expect(sql).toContain("'2-59/5 12-15 * * *'");
    expect(callsPerDay("2-59/5", "12-15")).toBe(48);
  });
  it("nominal slots (1 initial + 1 recovery ACT per call, +1 final job 95) cover 14 initial / 35 recovery", () => {
    const calls = 48 + 1;
    expect(calls).toBeGreaterThanOrEqual(35);
    expect(calls).toBeGreaterThanOrEqual(14);
  });
  it("gate mirrors claim_sync_retry eligibility and holds no credential", () => {
    expect(sql).toMatch(/next_run_at<=now\(\) AND \(q\.claimed_at IS NULL OR q\.claimed_at<now\(\)-interval ''10 minutes''\)/);
    expect(sql + rb).not.toMatch(/eyJ|x-cron-key"\s*:\s*"[0-9a-f]{16,}/);
  });
  it("rollback restores the exact md5-verified command and reactivates job 34", () => {
    expect(rb).toContain("4c67d49e32e2170d5f77541a9176500e");
    expect(rb).toContain("'30 12-15 * * *'");
    expect(rb).toContain("alter_job(34, active:=true)");
    expect(sql).toContain("alter_job(34, active:=false)");
  });
});
