import { describe, expect, it } from "vitest";
import { retryOutcome } from "../../supabase/functions/_shared/retryOutcome";

describe("durable retry results", () => {
  it("rejects caller authorization, not judicial privacy", () => {
    expect(retryOutcome(401, { ok: false })).toEqual({ outcome: "RETRY", code: "CALLER_UNAUTHORIZED" });
    expect(retryOutcome(403, { status: "PRIVATE" }).outcome).toBe("RETRY");
  });
  it("does not promote retained publications during pending ingestion", () => {
    expect(retryOutcome(200, { ok: true, pending_upstream: true, inserted_count: 10 }).code).toBe("PENDING_UPSTREAM");
  });
  it("accepts completed zero-row query rather than inventing a coverage failure", () => {
    expect(retryOutcome(200, { ok: true, errors: [], inserted_count: 0 })).toEqual({ outcome: "SUCCESS", code: null });
  });
  it("keeps partial and failed ingestion retryable", () => {
    expect(retryOutcome(200, { ok: true, status: "PARTIAL" }).outcome).toBe("RETRY");
    expect(retryOutcome(200, { ok: false, code: "PROVIDER_FAILED" }).code).toBe("PROVIDER_FAILED");
  });
});