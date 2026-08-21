/**
 * BB1 — CPACA is SAMAI-exclusive for actuaciones (CPNU fallback retired).
 * BB3c — the provider's PROCESO_PRIVADO answer is a restriction, not an absence.
 */
import { describe, it, expect } from "vitest";
import { resolveProviders } from "../../supabase/functions/_shared/providerRouting.ts";
import {
  classifyGcpResponse,
  gcpOutcomeAuthorisesFallback,
} from "../../supabase/functions/_shared/providerStrategy.ts";

describe("BB1 — CPACA routing", () => {
  it("actuaciones resolve to SAMAI only", () => {
    expect(resolveProviders("CPACA").actuaciones).toEqual(["SAMAI"]);
  });

  it("CPNU is nowhere in the CPACA chain", () => {
    const r = resolveProviders("CPACA");
    expect(r.actuaciones).not.toContain("CPNU");
    expect(r.estados).toEqual(["SAMAI_ESTADOS"]);
  });

  it("tutela keeps its union — the retirement is CPACA-scoped", () => {
    expect(resolveProviders("TUTELA").actuaciones).toEqual(["CPNU", "SAMAI"]);
  });
});

describe("BB3c — PROCESO_PRIVADO is a restriction, not an absence", () => {
  it("motivoAusencia=PROCESO_PRIVADO maps to RESTRICTED_BY_PROVIDER", () => {
    const r = classifyGcpResponse({
      httpStatus: 200,
      success: true,
      found: false,
      motivoAusencia: "PROCESO_PRIVADO",
    });
    expect(r.outcome).toBe("RESTRICTED_BY_PROVIDER");
    expect(r.errorCode).toBe("PROCESO_PRIVADO");
  });

  it("a restricted answer never authorises a fallback", () => {
    expect(gcpOutcomeAuthorisesFallback("RESTRICTED_BY_PROVIDER")).toBe(false);
  });

  it("plain found:false is still an answered absence", () => {
    expect(classifyGcpResponse({ httpStatus: 200, success: true, found: false }).outcome)
      .toBe("ANSWERED_ABSENCE");
  });

  it("restriction wins even when the transport looks like an error", () => {
    expect(classifyGcpResponse({ httpStatus: 404, motivoAusencia: "proceso_privado" }).outcome)
      .toBe("RESTRICTED_BY_PROVIDER");
  });
});
