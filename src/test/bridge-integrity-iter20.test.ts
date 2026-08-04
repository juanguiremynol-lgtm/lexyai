/**
 * Iteration 20 — the bridge doctrine: no automatic path may pause a work item
 * unless the provider itself confirms there is nothing there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import { mayAutoSuspendMonitoring, verifyWithProvider } from "@/lib/services/bridge-verification";

describe("bridge verification before auto-suspension", () => {
  beforeEach(() => invoke.mockReset());

  it("refuses to suspend when the provider has rows (bridge defect)", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, lines: [{ provider_count: 12, transfer_state: "TRANSFER_FAILED" }], recovered_rows: 0 },
      error: null,
    });
    const v = await mayAutoSuspendMonitoring("wi-1");
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("PROVIDER_HAS_ROWS_BRIDGE_DEFECT");
  });

  it("refuses to suspend when the provider is unreachable", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, lines: [{ provider_count: 0, transfer_state: "PROVIDER_UNAVAILABLE" }] },
      error: null,
    });
    const v = await mayAutoSuspendMonitoring("wi-2");
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("PROVIDER_UNAVAILABLE_INCONCLUSIVE");
  });

  it("allows suspension only when the provider answers with zero rows", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, lines: [{ provider_count: 0, transfer_state: "PROVIDER_NO_ROWS" }] },
      error: null,
    });
    const v = await mayAutoSuspendMonitoring("wi-3");
    expect(v.allowed).toBe(true);
  });

  it("treats an errored reconcile call as inconclusive, never as emptiness", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    const v = await verifyWithProvider("wi-4");
    expect(v.providerAnswered).toBe(false);
    expect(v.hasProviderRows).toBe(false);
    expect((await mayAutoSuspendMonitoring("wi-4")).allowed).toBe(false);
  });
});
