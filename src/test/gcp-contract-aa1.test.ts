/**
 * AA1 — GCP's HTTP contract is read explicitly, never inferred.
 */
import { describe, it, expect } from "vitest";
import {
  classifyGcpResponse,
  gcpOutcomeAuthorisesFallback,
} from "../../supabase/functions/_shared/providerStrategy.ts";

describe("AA1 — GCP contract mapping", () => {
  it("500 + success:false is UNAVAILABLE", () => {
    const r = classifyGcpResponse({ httpStatus: 500, success: false });
    expect(r.outcome).toBe("UNAVAILABLE");
    expect(gcpOutcomeAuthorisesFallback(r.outcome)).toBe(false);
  });

  it("200 + success:true + found:false is an answered absence", () => {
    const r = classifyGcpResponse({ httpStatus: 200, success: true, found: false });
    expect(r.outcome).toBe("ANSWERED_ABSENCE");
    expect(gcpOutcomeAuthorisesFallback(r.outcome)).toBe(true);
  });

  it("200 + success:true + found:true is data", () => {
    expect(classifyGcpResponse({ httpStatus: 200, success: true, found: true }).outcome)
      .toBe("ANSWERED_DATA");
  });

  it('404 "Job no encontrado" is UNAVAILABLE, not an absence', () => {
    const r = classifyGcpResponse({ httpStatus: 404, success: false, message: "Job no encontrado" });
    expect(r.outcome).toBe("UNAVAILABLE");
    expect(r.errorCode).toBe("PROVIDER_JOB_LOST");
  });

  it("plain 404 is an answered absence", () => {
    expect(classifyGcpResponse({ httpStatus: 404, message: "radicado not found" }).outcome)
      .toBe("ANSWERED_ABSENCE");
  });

  it("200 + success:false is UNAVAILABLE (explicit flag wins over body shape)", () => {
    expect(classifyGcpResponse({ httpStatus: 200, success: false, found: false }).outcome)
      .toBe("UNAVAILABLE");
  });

  it("429 and network silence are UNAVAILABLE", () => {
    expect(classifyGcpResponse({ httpStatus: 429 }).outcome).toBe("UNAVAILABLE");
    expect(classifyGcpResponse({ httpStatus: null }).outcome).toBe("UNAVAILABLE");
  });

  it("an unmapped shape is UNCLASSIFIED and never authorises fallback", () => {
    const r = classifyGcpResponse({ httpStatus: 302 });
    expect(r.outcome).toBe("UNCLASSIFIED");
    expect(gcpOutcomeAuthorisesFallback(r.outcome)).toBe(false);
  });
});
