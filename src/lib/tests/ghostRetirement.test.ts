/**
 * IR1 / IR2 — the ghost detector is gone and no automatic path may pause a matter.
 *
 * These tests fail loudly if any of the retired surfaces come back.
 */
import { describe, it, expect } from "vitest";
import * as bridge from "@/lib/services/bridge-verification";
import { processUnreachableItems } from "@/lib/services/atenia-ai-engine";

// Specifiers are built at runtime so TypeScript never tries to resolve
// modules that must not exist.
const retired = (p: string) => import(/* @vite-ignore */ `${"@/lib/"}${p}`);

describe("IR1 · the ghost detector no longer exists", () => {
  it("has no ghost-parking module", async () => {
    await expect(retired("ghost-parking")).rejects.toBeTruthy();
  });

  it("has no ghost remediation service", async () => {
    await expect(retired("services/atenia-ghost-remediation")).rejects.toBeTruthy();
  });
});


describe("IR2 · nothing automatic may stop monitoring", () => {
  it("exposes no auto-suspension helper on the bridge", () => {
    expect((bridge as Record<string, unknown>).mayAutoSuspendMonitoring).toBeUndefined();
  });

  it("keeps the retired auto-demonitor pass as a no-op", async () => {
    const r = await processUnreachableItems("any-org");
    expect(r.demonitored).toBe(0);
    expect(r.items).toEqual([]);
  });
});
