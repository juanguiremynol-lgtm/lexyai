/**
 * Iteration 20 (revised by IR2) — the bridge reports what the provider gave us.
 * It no longer feeds an auto-suspension decision: no automatic path may pause a
 * work item at all. What survives is the reading itself, and the rule that an
 * errored call is inconclusive rather than empty.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import * as bridge from "@/lib/services/bridge-verification";
const { verifyWithProvider } = bridge;

describe("bridge verification reads, it does not judge", () => {
  beforeEach(() => invoke.mockReset());

  it("no longer exposes any auto-suspension helper", () => {
    expect((bridge as Record<string, unknown>).mayAutoSuspendMonitoring).toBeUndefined();
  });

  it("reports provider rows when the bridge lost them", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, lines: [{ provider_count: 12, transfer_state: "TRANSFER_FAILED" }], recovered_rows: 0 },
      error: null,
    });
    const v = await verifyWithProvider("wi-1");
    expect(v.hasProviderRows).toBe(true);
    expect(v.providerRowCount).toBe(12);
  });

  it("marks a non-conclusive provider state as unanswered", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, lines: [{ provider_count: 0, transfer_state: "PROVIDER_UNAVAILABLE" }] },
      error: null,
    });
    const v = await verifyWithProvider("wi-2");
    expect(v.providerAnswered).toBe(false);
  });

  it("treats an errored reconcile call as inconclusive, never as emptiness", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    const v = await verifyWithProvider("wi-4");
    expect(v.providerAnswered).toBe(false);
    expect(v.hasProviderRows).toBe(false);
  });
});
