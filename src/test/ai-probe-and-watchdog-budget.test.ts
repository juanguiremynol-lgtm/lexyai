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
    expect(aiVerify.replace(/[\s*]+/g, " ")).toContain("NO debe llamarse desde trabajos programados");
  });
});

describe("watchdog heartbeat tolerance matches daily cadence", () => {
  it("HEARTBEAT_MAX_GAP_MINUTES is 1500 (24h + 60min slack)", () => {
    const m = watchdog.match(/HEARTBEAT_MAX_GAP_MINUTES\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(1500);
  });

  it("a normal daily gap does NOT retrigger; only >25h does", () => {
    const GAP = 1500;
    const wouldTrigger = (gapMinutes: number) => gapMinutes > GAP;
    expect(wouldTrigger(1440)).toBe(false); // next daily run
    expect(wouldTrigger(1499)).toBe(false); // within slack
    expect(wouldTrigger(1501)).toBe(true); // a whole day missed
  });
});

describe("daily cron cadence release script", () => {
  const fs = require("fs");
  const install: string = fs.readFileSync("supabase/release/cron_daily_cadence_20261117.sql", "utf8");
  const rows = [...install.matchAll(/\((\d+),'[^']+','([^']+)','([^']+)'/g)].slice(0, 23);
  const windowed = new Set(["21", "67", "74", "97", "99", "100"]);
  it("every ordinary job runs at most once per day; continuations stay inside a bounded window", () => {
    expect(rows.length).toBe(23);
    for (const [, id, , to] of rows) {
      const [min, hour] = to.split(" ");
      if (id === "71") { expect(to).toBe("*/15 * * * *"); continue; } // transactional outbox exception
      if (windowed.has(id)) { expect(hour).toMatch(/^\d+-\d+$/); const [a, b] = hour.split("-").map(Number); expect(b - a).toBeLessThanOrEqual(4); continue; }
      expect(min).toMatch(/^\d+$/); expect(hour).toMatch(/^\d+$/);
    }
  });
});
