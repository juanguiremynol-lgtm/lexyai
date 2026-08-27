/**
 * XX1/XX3 regression — source labels and despacho profiles.
 *
 * The label rule mirrors `ppLabelFromResult` in
 * `supabase/functions/_shared/estadosMonitor.ts`. A routing skip is not a read
 * and must never be displayed as an error; a pending upstream is not a success.
 */
import { describe, it, expect } from "vitest";

function ppLabelFromResult(success: boolean, errorCode: string | null, result: Record<string, unknown>): string {
  const signal = String(result.result_code ?? result.outcome ?? errorCode ?? "").toUpperCase();
  if (signal.startsWith("ROUTING_SKIP") || signal.startsWith("SKIP")) return "no_aplica";
  if (signal.includes("PRIVADO")) return "privado";
  if (signal.startsWith("PENDING") || signal === "NO_DATA" || signal === "SCRAPING_INITIATED") return "pending";
  if (signal.includes("NOT_FOUND")) return "no_encontrado";
  return success ? "ok" : "error";
}

describe("pp_estado label", () => {
  it("never reports a routing skip as a failure", () => {
    expect(ppLabelFromResult(false, "ROUTING_SKIP_PP_NOT_IN_CHAIN", {})).toBe("no_aplica");
    expect(ppLabelFromResult(false, null, { result_code: "ROUTING_SKIP_PP_NOT_IN_CHAIN" })).toBe("no_aplica");
  });

  it("keeps pending upstream distinct from success and from error", () => {
    expect(ppLabelFromResult(true, null, { result_code: "PENDING_UPSTREAM" })).toBe("pending");
    expect(ppLabelFromResult(true, null, { result_code: "SCRAPING_INITIATED" })).toBe("pending");
    expect(ppLabelFromResult(true, null, { result_code: "NO_DATA" })).toBe("pending");
  });

  it("marks restricted matters as privado, not error", () => {
    expect(ppLabelFromResult(false, null, { result_code: "PROCESO_PRIVADO" })).toBe("privado");
  });

  it("treats an answered absence as a completed read", () => {
    expect(ppLabelFromResult(true, null, { result_code: "SUCCESS_EMPTY" })).toBe("ok");
    expect(ppLabelFromResult(true, null, { result_code: "PROVIDER_NOT_FOUND" })).toBe("no_encontrado");
  });

  it("still reports genuine transport failures", () => {
    expect(ppLabelFromResult(false, "HTTP_502", {})).toBe("error");
  });
});

/** Mirror of the SQL evidence gate in `derive_despacho_profiles()`. */
function evidenceSufficient(matters: number, observationDays: number, spanDays: number): boolean {
  return matters >= 2 && observationDays >= 8 && spanDays >= 30;
}

describe("despacho profile evidence gate", () => {
  it("refuses to profile a single matter, however long observed", () => {
    expect(evidenceSufficient(1, 60, 365)).toBe(false);
  });

  it("refuses to profile a short window", () => {
    expect(evidenceSufficient(3, 25, 27)).toBe(false); // Rionegro today
  });

  it("accepts two matters with a month of reads", () => {
    expect(evidenceSufficient(2, 31, 30)).toBe(true);
  });
});
