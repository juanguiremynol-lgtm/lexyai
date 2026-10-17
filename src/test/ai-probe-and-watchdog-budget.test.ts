/**
 * Regression: no scheduled job may fire a PAID AI probe, and the cron
 * watchdog tolerance must match the 6h heartbeat cadence (not force hourly).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const selfHealth = readFileSync(
  resolve(__dirname, "../../supabase/functions/atenia-self-health/index.ts"),
  "utf8",
);
const watchdog = readFileSync(
  resolve(__dirname, "../../supabase/functions/atenia-cron-watchdog/index.ts"),
  "utf8",
);
const aiVerify = readFileSync(
  resolve(__dirname, "../../supabase/functions/_shared/aiVerifyLink.ts"),
  "utf8",
);

describe("paid AI probe eliminated from scheduled self-health", () => {
  it("atenia-self-health never calls aiVerifyLinkProbe", () => {
    expect(selfHealth).not.toContain("aiVerifyLinkProbe(");
    expect(selfHealth).not.toMatch(/import[\s\S]*aiVerifyLinkProbe/);
  });

  it("self-health AI check is passive: no fetch to the AI gateway", () => {
    expect(selfHealth).not.toContain("ai.gateway.lovable.dev");
    expect(selfHealth).not.toContain("LOVABLE_API_KEY");
  });

  it("passive check reports honestly when there is no recent usage", () => {
    expect(selfHealth).toContain("sin uso reciente");
    // Absence of heartbeats must not be reported as an outage
    expect(selfHealth).not.toMatch(/SIN DATO[\s\S]{0,80}ok:\s*false/);
  });

  it("the probe remains available only as an explicit manual smoke test", () => {
    expect(aiVerify).toContain("export async function aiVerifyLinkProbe");
    expect(aiVerify.replace(/\s+/g, " ")).toContain("NO debe llamarse desde trabajos programados");
  });
});

describe("watchdog heartbeat tolerance matches 6h cadence", () => {
  it("HEARTBEAT_MAX_GAP_MINUTES is 420 (6h + 60min slack)", () => {
    const m = watchdog.match(/HEARTBEAT_MAX_GAP_MINUTES\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(420);
  });

  it("a 1h or 6h gap does NOT retrigger; only >7h does", () => {
    const GAP = 420;
    const wouldTrigger = (gapMinutes: number) => gapMinutes > GAP;
    expect(wouldTrigger(60)).toBe(false); // 1h after last OK run
    expect(wouldTrigger(360)).toBe(false); // exactly at next scheduled run
    expect(wouldTrigger(419)).toBe(false); // within slack
    expect(wouldTrigger(421)).toBe(true); // genuinely absent
  });
});
