/**
 * Iteration 23 — plausible-empty is the dangerous case.
 *
 * "The source is empty" is an assertion that may only rest on a clean,
 * well-formed, successful zero-row answer. Everything else is infrastructure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import { mayAutoSuspendMonitoring } from "@/lib/services/bridge-verification";

describe("non-conclusive provider states never license a pause", () => {
  beforeEach(() => invoke.mockReset());

  for (const state of [
    "INFRA_FAILURE",
    "PROVIDER_JOB_ABORTED",
    "PROVIDER_NEVER_COMPLETES",
    "PROVIDER_INVENTORY_SUSPECT",
  ]) {
    it(`refuses to suspend on ${state}`, async () => {
      invoke.mockResolvedValue({
        data: { ok: true, lines: [{ provider_count: 0, transfer_state: state }] },
        error: null,
      });
      const v = await mayAutoSuspendMonitoring("wi-x");
      expect(v.allowed).toBe(false);
      expect(v.reason).toBe("PROVIDER_UNAVAILABLE_INCONCLUSIVE");
    });
  }

  it("still allows suspension on a confirmed empty source", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, lines: [{ provider_count: 0, transfer_state: "PROVIDER_NO_ROWS" }] },
      error: null,
    });
    const v = await mayAutoSuspendMonitoring("wi-y");
    expect(v.allowed).toBe(true);
  });
});