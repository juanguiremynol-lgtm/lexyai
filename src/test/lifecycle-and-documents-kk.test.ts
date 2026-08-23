/**
 * KK — lifecycle keys must be canonical, workflow_type must always travel,
 * and document presence is three states, never two.
 */
import { describe, it, expect } from "vitest";

/** Mirrors the broadcaster's emit-site assertion. */
function isCanonicalKey(radicado: string | null | undefined): boolean {
  return /^\d{23}$/.test(String(radicado ?? "").replace(/\D/g, ""));
}

type Availability = "DISPONIBLE" | "SIN_DOCUMENTO" | "NO_CONSULTADO";

function actAvailability(docsLinked: number, observedAt: string | null): Availability {
  return docsLinked ? "DISPONIBLE" : observedAt ? "SIN_DOCUMENTO" : "NO_CONSULTADO";
}

function estadoAvailability(docsLinked: number, pdfAvailable: boolean | null): Availability {
  return docsLinked
    ? "DISPONIBLE"
    : pdfAvailable === null || pdfAvailable === undefined
    ? "NO_CONSULTADO"
    : "SIN_DOCUMENTO";
}

describe("KK1 — canonical lifecycle keys", () => {
  it("rejects the 21-digit base that GCP cannot address", () => {
    expect(isCanonicalKey("050014003028202600521")).toBe(false);
  });

  it("accepts a 23-digit instance key, punctuated or not", () => {
    expect(isCanonicalKey("05001400302820260052100")).toBe(true);
    expect(isCanonicalKey("05001-4003-028-2026-00521-00")).toBe(true);
  });

  it("rejects null and empty", () => {
    expect(isCanonicalKey(null)).toBe(false);
    expect(isCanonicalKey("")).toBe(false);
  });
});

describe("KK2 — workflow_type always travels", () => {
  const send = (wf: string | null | undefined) =>
    String(wf ?? "").trim() || "INDETERMINADO";

  it("never omits the field: upstream's guard fails open without it", () => {
    expect(send(null)).toBe("INDETERMINADO");
    expect(send("  ")).toBe("INDETERMINADO");
    expect(send("EJECUTIVO")).toBe("EJECUTIVO");
  });
});

describe("KK3 — document presence has three states", () => {
  it("an unasked act is NOT 'sin documento'", () => {
    expect(actAvailability(0, null)).toBe("NO_CONSULTADO");
  });

  it("an asked act with nothing attached is an answered absence", () => {
    expect(actAvailability(0, "2026-08-20T10:00:00Z")).toBe("SIN_DOCUMENTO");
  });

  it("linked documents are available regardless of the timestamp", () => {
    expect(actAvailability(2, null)).toBe("DISPONIBLE");
  });

  it("estados: null pdf_available is silence, false is an answer", () => {
    expect(estadoAvailability(0, null)).toBe("NO_CONSULTADO");
    expect(estadoAvailability(0, false)).toBe("SIN_DOCUMENTO");
    expect(estadoAvailability(1, true)).toBe("DISPONIBLE");
  });
});
