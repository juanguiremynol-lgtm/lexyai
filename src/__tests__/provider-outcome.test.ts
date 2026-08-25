import { describe, expect, it } from "vitest";
import { persistedProviderOutcome } from "../../supabase/functions/_shared/providerOutcome";

describe("persistedProviderOutcome", () => {
  it.each([
    ["PENDING_UPSTREAM", "PENDING_UPSTREAM"], ["SCRAPING_INITIATED", "SCRAPING_INITIATED"],
    ["PROCESO_PRIVADO", "PROCESO_PRIVADO"], ["NOT_FOUND", "RUN_SUCCESS_NOT_FOUND"],
    ["SUCCESS_EMPTY", "RUN_SUCCESS_EMPTY"], ["SUCCESS_WITH_DATA", "RUN_SUCCESS_WITH_DATA"],
  ])("maps %s without treating non-answers as coverage", (resultCode, expected) => {
    expect(persistedProviderOutcome({ status: "success", resultCode })).toBe(expected);
  });
  it("keeps transport failures terminal", () => {
    expect(persistedProviderOutcome({ status: "timeout" })).toBe("RUN_FAILED");
  });
});