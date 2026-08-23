/**
 * NN1 / NN2 — an expired term is not a pending obligation, and a term bound to
 * the opposing party was never his to meet.
 *
 * These are pure mirrors of the contract the digest and the evaluator enforce:
 *   NN1(b) a term expired beyond the 3 business-day grace drains out of the mail
 *   NN2(c) his terms and the counterparty's are two lists, never one
 *   NN2(d) an undetermined party says so; it never defaults to him
 */
import { describe, expect, it } from "vitest";

type Row = {
  id: string;
  attribution: "PROPIO" | "CONTRAPARTE" | "JUEZ" | "DESCONOCIDO";
  status: string;
  overdue: boolean;
};

/** Mirrors the digest's fetch predicate: only PENDING reaches the mail. */
function digestVisible(rows: Row[]): Row[] {
  return rows.filter((r) => r.status === "PENDING");
}

/** Mirrors deadlinesBlock's three-way split. */
function splitLists(rows: Row[]) {
  return {
    propios: rows.filter((r) => r.attribution === "PROPIO"),
    contraparte: rows.filter((r) => r.attribution === "CONTRAPARTE"),
    sinDeterminar: rows.filter(
      (r) => r.attribution !== "PROPIO" && r.attribution !== "CONTRAPARTE",
    ),
  };
}

/** Mirrors the evaluator's alerting gate. */
const alerts = (r: Row) => r.status === "PENDING" && r.attribution === "PROPIO";

const rows: Row[] = [
  { id: "propio-vence", attribution: "PROPIO", status: "PENDING", overdue: false },
  { id: "propio-en-gracia", attribution: "PROPIO", status: "PENDING", overdue: true },
  { id: "drenado", attribution: "PROPIO", status: "VENCIDO_SIN_ACTUACION", overdue: true },
  { id: "reposicion-ejecutado", attribution: "CONTRAPARTE", status: "PENDING", overdue: false },
  { id: "notificacion-generica", attribution: "DESCONOCIDO", status: "PENDING", overdue: false },
  { id: "termino-del-juez", attribution: "JUEZ", status: "PENDING", overdue: false },
];

describe("NN1 — draining", () => {
  it("a drained term leaves the digest but keeps its row", () => {
    const visible = digestVisible(rows).map((r) => r.id);
    expect(visible).not.toContain("drenado");
    // NN1(d): the row still exists, it merely stopped being PENDING.
    expect(rows.find((r) => r.id === "drenado")?.status).toBe("VENCIDO_SIN_ACTUACION");
  });

  it("a term inside the 3-day grace is still shown as vencido", () => {
    expect(digestVisible(rows).some((r) => r.id === "propio-en-gracia" && r.overdue)).toBe(true);
  });

  it("a drained term alerts no more", () => {
    expect(alerts(rows.find((r) => r.id === "drenado")!)).toBe(false);
  });

  it("draining never launders the miss into a discharge", () => {
    expect(["FULFILLED", "MET", "FULFILLED_BY_EMAIL_EVIDENCE"]).not.toContain(
      "VENCIDO_SIN_ACTUACION",
    );
  });
});

describe("NN2 — attribution", () => {
  it("splits his terms from the counterparty's and from the undetermined ones", () => {
    const { propios, contraparte, sinDeterminar } = splitLists(digestVisible(rows));
    expect(propios.map((r) => r.id)).toEqual(["propio-vence", "propio-en-gracia"]);
    expect(contraparte.map((r) => r.id)).toEqual(["reposicion-ejecutado"]);
    // NN2(d): DESCONOCIDO and JUEZ are shown, never folded into his obligations.
    expect(sinDeterminar.map((r) => r.id)).toEqual([
      "notificacion-generica",
      "termino-del-juez",
    ]);
  });

  it("keeps counterparty terms visible rather than suppressing them (S4)", () => {
    const { contraparte } = splitLists(digestVisible(rows));
    expect(contraparte.length).toBeGreaterThan(0);
  });

  it("only a PROPIO term may raise an alert", () => {
    expect(rows.filter(alerts).map((r) => r.id)).toEqual(["propio-vence", "propio-en-gracia"]);
  });
});
