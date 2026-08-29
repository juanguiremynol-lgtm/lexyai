/**
 * Iteration 23 (revised by IR2) — plausible-empty is the dangerous case.
 *
 * "The source is empty" is an assertion that may only rest on a clean,
 * well-formed, successful zero-row answer. Everything else is infrastructure.
 * And even a clean empty answer no longer licenses anything: nothing automatic
 * may pause a matter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import * as bridge from "@/lib/services/bridge-verification";
const { verifyWithProvider } = bridge;

describe("non-conclusive provider states are never read as emptiness", () => {
  beforeEach(() => invoke.mockReset());

  for (const state of [
    "INFRA_FAILURE",
    "PROVIDER_JOB_ABORTED",
    "PROVIDER_NEVER_COMPLETES",
    "PROVIDER_INVENTORY_SUSPECT",
  ]) {
    it(`treats ${state} as unanswered`, async () => {
      invoke.mockResolvedValue({
        data: { ok: true, lines: [{ provider_count: 0, transfer_state: state }] },
        error: null,
      });
      const v = await verifyWithProvider("wi-x");
      expect(v.providerAnswered).toBe(false);
    });
  }

  it("records a clean zero-row answer as answered — and nothing more", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, lines: [{ provider_count: 0, transfer_state: "PROVIDER_NO_ROWS" }] },
      error: null,
    });
    const v = await verifyWithProvider("wi-y");
    expect(v.providerAnswered).toBe(true);
    expect(v.hasProviderRows).toBe(false);
    expect((bridge as Record<string, unknown>).mayAutoSuspendMonitoring).toBeUndefined();
  });
});
