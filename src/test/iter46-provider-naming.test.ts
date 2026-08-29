/**
 * ITERATION 46 — the provider's own name, the district as a rate, the probe
 * that asserts success, and the parking gate.
 */
import { describe, it, expect } from "vitest";
import {
  ESTADOS_SIGNAL_LABEL,
  ESTADOS_SIGNAL_EXPLANATION,
  estadosSignalAlerts,
  estadosSignalTone,
} from "@/lib/estados-coverage-signal";
import { claseMotivoLabel, isClaseMotivoAccionable } from "@/lib/clase-motivo";
import {
  despachoKeyFromRadicado,
  distritoKeyFromRadicado,
  privacyRateCopy,
  privacyRatePct,
  privacyRateMaySuppressAlarm,
  resolvePrivacyRate,
  type DespachoPrivacyRate,
} from "@/lib/despacho-privacy-rate";
import { derivePenalRouting } from "@/lib/penal-routing";

// ── A. the provider's own name ──
describe("A · PROCESO_PRIVADO is the provider's term, attributed", () => {
  it("labels the signal with the provider's wording", () => {
    expect(ESTADOS_SIGNAL_LABEL.PROCESO_PRIVADO).toBe(
      "Marcado como proceso privado por el proveedor",
    );
  });

  it("quotes the provider verbatim and attributes the statement", () => {
    const copy = ESTADOS_SIGNAL_EXPLANATION.PROCESO_PRIVADO;
    expect(copy).toContain("La Rama Judicial marca");
    expect(copy).toContain("PROCESO PRIVADO");
    expect(copy).toContain("No se puede ver el detalle de un proceso privado");
  });

  it("never asserts a legal cause of its own", () => {
    const copy = ESTADOS_SIGNAL_EXPLANATION.PROCESO_PRIVADO + claseMotivoLabel("PROCESO_PRIVADO");
    expect(copy.toLowerCase()).not.toContain("reserva sumarial");
    expect(copy).toContain("no está declarada");
  });

  it("says the mark is per-matter and mutable", () => {
    expect(ESTADOS_SIGNAL_EXPLANATION.PROCESO_PRIVADO).toContain("por proceso");
    expect(ESTADOS_SIGNAL_EXPLANATION.PROCESO_PRIVADO).toContain("de un día para otro");
  });

  it("is a conclusion, so no retry is offered", () => {
    expect(isClaseMotivoAccionable("PROCESO_PRIVADO")).toBe(false);
  });

  it("keeps the old vocabulary out of the signal union", () => {
    expect(Object.keys(ESTADOS_SIGNAL_LABEL)).not.toContain("DETALLE_NO_EXPUESTO");
    expect(estadosSignalTone("PROCESO_PRIVADO")).toContain("slate");
  });

  it("still never raises a coverage alarm", () => {
    expect(
      estadosSignalAlerts({ signal_class: "PROCESO_PRIVADO", recent_unmatched_count: 9 }),
    ).toBe(false);
  });
});

// ── B. the district is a rate ──
describe("B · the district is a rate, never a property", () => {
  const rates: DespachoPrivacyRate[] = [
    {
      scope: "DISTRITO",
      scope_key: "08001",
      scope_label: "Barranquilla (Atlántico)",
      flagged: 20,
      total: 43,
      despacho_distribution: [
        { flagged: 4, total: 6 }, { flagged: 3, total: 6 }, { flagged: 3, total: 6 },
        { flagged: 1, total: 6 }, { flagged: 2, total: 6 }, { flagged: 2, total: 6 },
      ],
    },
    { scope: "DISTRITO", scope_key: "11001", scope_label: "Bogotá D.C.", flagged: 0, total: 23 },
    {
      scope: "DESPACHO", scope_key: "080013153006", scope_label: "Juzgado 6 Civil del Circuito de Barranquilla",
      flagged: 4, total: 6,
    },
  ];

  it("keys despacho on 12 CUI digits and district on 5", () => {
    expect(despachoKeyFromRadicado("08001315300620250013000")).toBe("080013153006");
    expect(distritoKeyFromRadicado("08001315300620250013000")).toBe("08001");
    expect(despachoKeyFromRadicado("0800")).toBeNull();
  });

  it("prefers a despacho measurement over the district", () => {
    const r = resolvePrivacyRate("08001315300620250013000", rates);
    expect(r?.scope).toBe("DESPACHO");
    expect(privacyRatePct(r!)).toBe(67);
  });

  it("falls back to the district when the despacho was not measured", () => {
    const r = resolvePrivacyRate("08001405301420240080600", rates);
    expect(r?.scope).toBe("DISTRITO");
    expect(privacyRatePct(r!)).toBe(47);
  });

  it("says a Barranquilla mark is frequent, with the sample size", () => {
    const copy = privacyRateCopy(rates[0])!;
    expect(copy).toContain("Frecuente");
    expect(copy).toContain("20 de 43");
    expect(copy).toContain("47%");
  });

  it("records that every measured despacho is mixed, so the despacho explains nothing", () => {
    expect(privacyRateCopy(rates[0])!).toContain("todos mixtos");
  });

  it("says a Bogotá mark would be unusual", () => {
    expect(privacyRateCopy(rates[1])!).toContain("Inusual");
  });

  it("returns nothing where there is no measurement", () => {
    expect(privacyRateCopy(resolvePrivacyRate("05001333301020230019900", rates))).toBeNull();
  });

  it("may never suppress a coverage alarm", () => {
    expect(privacyRateMaySuppressAlarm()).toBe(false);
  });
});

// ── D4 / iter45-D. structural identifiers outrank narrative ones ──
describe("D · penal routing prefers the CUI over the provider's prose", () => {
  it("routes on the CUI even when the provider says something else", () => {
    const s = derivePenalRouting({
      radicado: "08001600125720253122600",
      providerEspecialidad: "CIVIL",
    });
    expect(s.isPenal).toBe(true);
    expect(s.determinant).toBe("CUI");
  });

  it("still honours the provider when the CUI is not penal", () => {
    const s = derivePenalRouting({
      radicado: "05001333301020230019900",
      providerEspecialidad: "PENAL Ley 906",
    });
    expect(s.determinant).toBe("PROVIDER");
  });

  it("lets the lawyer's declaration win over everything", () => {
    const s = derivePenalRouting({ radicado: "11001310300120240001100", userDeclared: true });
    expect(s.determinant).toBe("USER");
  });

  it("routes a private matter with no ficha at all", () => {
    const s = derivePenalRouting({ radicado: "08001600125720253122600" });
    expect(s.isPenal).toBe(true);
  });
});
