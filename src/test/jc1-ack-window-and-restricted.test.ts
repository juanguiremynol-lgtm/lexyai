/**
 * JC1 — the daily loop stops waiting for the provider.
 * JC2 — a refusal is an ANSWER; a fast failure is not "sin movimiento".
 *
 * CPNU answers a scraped read at ~28.5 s (and sometimes ~59 s) while the loop
 * aborted at 20 s, so reads that had SUCCEEDED upstream were recorded here as
 * timeouts. The per-item timeout is NOT raised: the loop waits only for an
 * acknowledgement, the callee seals its own outcome, and the poller converges
 * whatever is still in flight.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ADAPTER_SENTINEL_CODES,
  attemptIsRestricted,
  classifyGcpResponse,
} from "../../supabase/functions/_shared/providerStrategy.ts";
import { persistedProviderOutcome } from "../../supabase/functions/_shared/providerOutcome.ts";

const dailySync = readFileSync("supabase/functions/scheduled-daily-sync/index.ts", "utf8");
const orchestrator = readFileSync("supabase/functions/_shared/syncOrchestrator.ts", "utf8");
const adapters = readFileSync("supabase/functions/_shared/providerAdapters.ts", "utf8");
const digest = readFileSync("supabase/functions/scheduled-daily-digest/html.ts", "utf8");

describe("JC1(a) — ack window replaces the abort", () => {
  it("keeps the per-item timeout at its original value", () => {
    expect(dailySync).toMatch(/DAILY_SYNC_ITEM_TIMEOUT_MS"\) \|\| "20000"/);
  });

  it("waits only for an acknowledgement in the daily loop", () => {
    expect(dailySync).toMatch(/const ACK_WINDOW_MS = /);
    expect(dailySync).toMatch(/syncSingleItemWithAck\(supabase, item, orgId, ACK_WINDOW_MS/);
  });

  it("records an unanswered call as DISPATCHED, never as timeout or failure", () => {
    expect(dailySync).toMatch(/if \(ack\.kind === "dispatched"\) \{[\s\S]*?itemsDispatched\+\+/);
    expect(dailySync).toMatch(/items_dispatched: itemsDispatched/);
  });

  it("counts a dispatched item as attempted and not failed", () => {
    expect(dailySync).toMatch(/const nonFailed = itemsSucceeded \+ itemsDispatched/);
  });

  it("reserves ack-window headroom, not item-timeout headroom", () => {
    expect(dailySync).toMatch(/HARD_BUDGET_MS - \(ACK_WINDOW_MS \+ 5_000\)/);
  });
});

describe("JC1(b) — the callee owns last_synced_at", () => {
  it("no longer stamps last_synced_at from the orchestrating loop", () => {
    expect(dailySync).not.toMatch(/from\("work_items"\)\s*\n\s*\.update\(\{ last_synced_at/);
  });
});

describe("JC1(c) — poller hand-off", () => {
  it("kicks the poller only when something was left in flight", () => {
    expect(dailySync).toMatch(
      /if \(itemsDispatched > 0\) \{[\s\S]*?invoke\("cpnu-job-poller"/,
    );
  });
});

describe("JC2 — a refusal is an answer", () => {
  it("keeps the adapter's canonical verdict instead of PROVIDER_ERROR", () => {
    expect(ADAPTER_SENTINEL_CODES.has("PROCESO_PRIVADO")).toBe(true);
    expect(adapters).toMatch(/ADAPTER_SENTINEL_CODES\.has\(sentinel\)/);
  });

  it("classifies a restricted read as RESTRICTED_BY_PROVIDER, not UNAVAILABLE", () => {
    const gcp = classifyGcpResponse({
      httpStatus: 200,
      success: true,
      found: false,
      restringido: true,
    } as any);
    expect(gcp.outcome).toBe("RESTRICTED_BY_PROVIDER");
    expect(gcp.errorCode).toBe("PROCESO_PRIVADO");
  });

  it("persists a restricted attempt as PROCESO_PRIVADO, not RUN_FAILED", () => {
    expect(
      persistedProviderOutcome({
        status: "restricted",
        resultCode: "PROCESO_PRIVADO",
        errorCode: "PROCESO_PRIVADO",
        insertedCount: 0,
      }),
    ).toBe("PROCESO_PRIVADO");
  });

  it("treats a restricted attempt as an answered read in the rollup", () => {
    expect(attemptIsRestricted("restricted", null)).toBe(true);
    expect(attemptIsRestricted("error", "PROCESO_PRIVADO")).toBe(true);
    expect(attemptIsRestricted("error", "PROVIDER_TIMEOUT")).toBe(false);
    expect(orchestrator).toMatch(/attemptIsRestricted\(a\.status, a\.error_code\)/);
  });

  it("never renders a failed read as 'sin movimiento'", () => {
    expect(digest).toMatch(/\$\{r\.success_empty_count\} leídos sin movimiento/);
    expect(digest).toMatch(/sin lectura \(falla, no significa "sin novedades"\)/);
  });
});
