/**
 * ITERATION 53 — one attribution, honest dates, no re-read noise, and
 * instruments that know when they cannot see.
 */
import { describe, it, expect } from "vitest";
import { resolveAnchorsFromEvents, type TermEvent } from "@/lib/workflow-terms/rule-term-suggestions";
import { resolveTermAttribution } from "@/lib/workflow-terms/party-attribution";
import { classifySchemaAccess } from "@/lib/observability/schema-access-guard";

describe("B — each cited date comes from the event it names", () => {
  const events: TermEvent[] = [
    { at: "2026-07-31", text: "Auto que libra mandamiento de pago", source: "ACTUACION" },
    { at: "2026-08-03", text: "Fijación Estado — mandamiento de pago", source: "ESTADO" },
  ];

  it("cites the auto's own date, not the fijación's", () => {
    const [anchor] = resolveAnchorsFromEvents(events);
    expect(anchor.basis).toContain("mandamiento de pago del 2026-07-31");
    expect(anchor.basis).toContain("fijado en estado el 2026-08-03");
    expect(anchor.date).toBe("2026-08-04");
  });

  it("falls back to the providencia date when only the estado is known", () => {
    const [anchor] = resolveAnchorsFromEvents([
      {
        at: "2026-08-03",
        text: "Fijación Estado — mandamiento de pago",
        source: "ESTADO",
        docDate: "2026-07-31",
      },
    ]);
    expect(anchor.basis).toContain("del 2026-07-31");
    expect(anchor.basis).toContain("estado el 2026-08-03");
  });

  it("never cites an auto date it does not hold", () => {
    expect(
      resolveAnchorsFromEvents([
        { at: "2026-08-03", text: "Fijación Estado — mandamiento de pago", source: "ESTADO" },
      ]),
    ).toHaveLength(0);
  });
});

describe("A — the term is labelled by ITS bound party, never by the client's role", () => {
  it("names the counterparty when the client is the demandante", () => {
    const r = resolveTermAttribution(
      { boundPartyRole: "DEMANDADO", boundPartySource: "REGLA_RATIFICADA" },
      "DEMANDANTE",
    );
    expect(r.attribution).toBe("CONTRAPARTE");
    expect(r.statement).toContain("contraparte (demandado)");
    expect(r.statement).not.toContain("Demandante");
    expect(r.actionable).toBe(false);
  });

  it("does not present a generic-catalogue binding as the client's own action", () => {
    const r = resolveTermAttribution(
      { boundPartyRole: "AMBAS", boundPartySource: "CATALOGO_GENERICO" },
      "DEMANDANTE",
    );
    expect(r.attribution).toBe("DESCONOCIDO");
    expect(r.actionable).toBe(false);
  });

  it("asks for the capacity only when the capacity is what is missing", () => {
    const unknown = resolveTermAttribution({ boundPartyRole: "DEMANDADO" }, null);
    expect(unknown.attribution).toBe("DESCONOCIDO");
    expect(unknown.needsClientCapacity).toBe(true);
    const judge = resolveTermAttribution({ boundPartyRole: "JUEZ" }, null);
    expect(judge.attribution).toBe("JUEZ");
    expect(judge.needsClientCapacity).toBe(false);
  });
});

describe("D1 — no access is not no data", () => {
  it("flags an empty public schema while the system answers", () => {
    const v = classifySchemaAccess({ public_tables: 0, system_tables: 400, auth_tables: 16 });
    expect(v.state).toBe("ACCESO_DEGRADADO");
    expect(v.conclusionsForbidden).toBe(true);
  });

  it("flags an implausibly small read and a missing probe", () => {
    expect(classifySchemaAccess({ public_tables: 3, system_tables: 400, auth_tables: 16 }).state).toBe(
      "ACCESO_DEGRADADO",
    );
    expect(classifySchemaAccess(null).conclusionsForbidden).toBe(true);
  });

  it("accepts a full read", () => {
    const v = classifySchemaAccess({ public_tables: 280, system_tables: 400, auth_tables: 16 });
    expect(v.state).toBe("ACCESO_NORMAL");
    expect(v.conclusionsForbidden).toBe(false);
  });
});
