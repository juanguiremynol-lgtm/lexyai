/**
 * Iteration 4 — email semantics engine (Part A classifier fixtures).
 * Subjects are real observed production subjects.
 */
import { describe, it, expect } from "vitest";
import {
  classifyEvidenceSubtype,
  classifyMemorialSubtype,
  EVIDENCE_SUBTYPE_RULES,
  extractRadicados,
  extractRadicados22,
} from "../../supabase/functions/_shared/emailMatcher.ts";
import { mapStageToCanonicalPhase, getWorkflowPhases } from "@/lib/workflow-phases";

const JUD = "juzgado01civilmed@cendoj.ramajudicial.gov.co";

describe("classifyEvidenceSubtype", () => {
  it("requires a judicial sender", () => {
    expect(classifyEvidenceSubtype("NOTIFICACIÓN AUTO ADMITE TUTELA", "cliente@gmail.com")).toBeNull();
  });

  it.each([
    ["NOTIFICACIÓN AUTO ADMITE TUTELA - RADICADO 05001310300120260011300", "AUTO_ADMISORIO"],
    ["AUTO INADMITE DEMANDA 05001400302820260075400", "INADMISION"],
    ["NOTIFICO NIEGA AMPARO - TUTELA 2026-00475", "FALLO_SENTENCIA"],
    ["NOTIFICO CONCEDE IMPUGNACIÓN RAD 5001-31-03-018-2026-00313-00", "RECURSO_CONCEDIDO"],
    ["Auto concede el recurso de apelación", "RECURSO_CONCEDIDO"],
    ["NOTIFICO NIEGA AMPARO CONSTITUCIONAL RAD 05001-31-03-018-2026-00313-00", "FALLO_SENTENCIA"],
    ["Traslado por competencia - 05001333301520260011300", "TRASLADO"],
    ["ACTA REPARTO 05001400303420260089800", "ACTA_REPARTO"],
    ["Requerimiento al apoderado - 11001311001320240075200", "REQUERIMIENTO"],
    ["Citación a audiencia inicial art. 372", "CITACION_AUDIENCIA"],
    ["Citación audiencia de pruebas", "CITACION_AUDIENCIA"],
    ["Fijación en estado electrónico del 03 de julio", "FIJACION_ESTADO"],
    ["Desistimiento tácito - 05001", "DESISTIMIENTO"],
    ["NOTIFICACIÓN CURADOR AD LITEM DIVORCIO 110013110013 2024 00752 00", "NOTIFICACION_PERSONAL"],
    ["Respuesta automática: 05001400302820260075400 - Solicitud Acceso", "ACUSE_AUTOMATICO"],
    ["Token validación de acceso a información de proceso judicial", "ACCESO_EXPEDIENTE"],
    ["Comunicación del despacho", "OTRO_JUDICIAL"],
  ])("classifies %s", (subject, expected) => {
    expect(classifyEvidenceSubtype(subject, JUD)).toBe(expected);
  });

  it("never confuses inadmite with admite", () => {
    expect(classifyEvidenceSubtype("AUTO QUE INADMITE LA DEMANDA", JUD)).toBe("INADMISION");
    expect(classifyEvidenceSubtype("AUTO QUE ADMITE LA DEMANDA", JUD)).toBe("AUTO_ADMISORIO");
  });

  it("never treats a granted appeal as a fallo", () => {
    expect(classifyEvidenceSubtype("CONCEDE IMPUGNACIÓN FALLO DE TUTELA", JUD)).toBe(
      "RECURSO_CONCEDIDO",
    );
    expect(classifyEvidenceSubtype("NOTIFICO CONCEDE AMPARO", JUD)).toBe("FALLO_SENTENCIA");
  });
});

describe("classifyMemorialSubtype", () => {
  it.each([
    ["05001400303420260089800 - Subsana Demanda - 160726", "SUBSANACION"],
    ["05001333301520260011300 - Pronunciamiento Frente Excepciones - 220726", "EXCEPCIONES"],
    ["Recurso de apelación contra sentencia", "APELACION"],
    ["Impugnación del fallo de tutela", "IMPUGNACION"],
    ["Contestación de la demanda y solicitud de pruebas", "CONTESTACION"],
    ["Alegatos de conclusión", "ALEGATOS"],
    ["Memorial de impulso procesal", "MEMORIAL_GENERAL"],
  ])("classifies %s", (subject, expected) => {
    expect(classifyMemorialSubtype(subject)).toBe(expected);
  });

  it("returns null for non-memorial subjects", () => {
    expect(classifyMemorialSubtype("Reunión de equipo")).toBeNull();
  });
});

/**
 * Parity fixture: these strings are the exact regex sources mirrored inside the
 * Postgres function public.classify_email_evidence_subtype. If a rule changes in
 * TypeScript without the SQL mirror, this fails.
 */
const SQL_MIRROR: Record<string, string> = {
  RECURSO_CONCEDIDO:
    "concede\\s+(la\\s+|el\\s+|los\\s+|las\\s+)?(impugnaci[óo]n|apelaci[óo]n|recurso|recursos|alzada)",
  FALLO_SENTENCIA:
    "fallo|sentencia|resuelve|tutela +amparo|(niega|concede)\\s+(el\\s+|la\\s+|las\\s+|los\\s+)?(amparo|tutela|pretensi[óo]n|pretensiones)",
};

describe("TS ↔ SQL classifier parity", () => {
  it.each(Object.keys(SQL_MIRROR))("%s regex mirrors the DB function", (subtype) => {
    const rule = EVIDENCE_SUBTYPE_RULES.find(([s]) => s === subtype);
    expect(rule).toBeDefined();
    expect(rule![1].source).toBe(SQL_MIRROR[subtype]);
  });

  it("orders RECURSO_CONCEDIDO before FALLO_SENTENCIA", () => {
    const keys = EVIDENCE_SUBTYPE_RULES.map(([s]) => s);
    expect(keys.indexOf("RECURSO_CONCEDIDO")).toBeLessThan(keys.indexOf("FALLO_SENTENCIA"));
  });
});

describe("22-digit radicado tolerance", () => {
  const withZero = "05001310301820260031300";
  it("does not relax the 23-digit discovery rule", () => {
    expect(extractRadicados("RAD 5001-31-03-018-2026-00313-00")).toEqual([]);
  });

  it("recovers the dropped leading zero for portfolio matching", () => {
    expect(extractRadicados22("RAD 5001-31-03-018-2026-00313-00")).toContain(withZero);
  });

  it("ignores well-formed 23-digit runs", () => {
    expect(extractRadicados22(`RAD ${withZero}`)).toEqual([]);
  });
});

describe("canonical phase mapping (Part E.1)", () => {
  it("maps every legacy radicación stage onto RADICACION", () => {
    for (const stage of ["RADICADO", "RADICACION", "DEMANDA_RADICADA", "RADICADO_CONFIRMED"]) {
      expect(mapStageToCanonicalPhase("CGP", stage)).toBe("RADICACION");
    }
    expect(mapStageToCanonicalPhase("TUTELA", "TUTELA_RADICADA")).toBe("RADICACION");
  });

  it("maps unknown stages by keyword heuristic", () => {
    expect(mapStageToCanonicalPhase("CGP", "PENDIENTE_AUDIENCIA_INICIAL")).toBe("AUDIENCIAS");
    expect(mapStageToCanonicalPhase("CGP", "ZZZ_DESCONOCIDO")).toBeNull();
  });

  it("only ever returns phases that exist in the workflow catalog", () => {
    for (const wf of ["CGP", "CPACA", "TUTELA", "LABORAL"] as const) {
      const keys = new Set(getWorkflowPhases(wf).map((p) => p.key));
      for (const stage of ["RADICADO", "AUTO_ADMISORIO", "APELACION", "SENTENCIA"]) {
        const phase = mapStageToCanonicalPhase(wf, stage);
        if (phase) expect(keys.has(phase)).toBe(true);
      }
    }
  });
});
