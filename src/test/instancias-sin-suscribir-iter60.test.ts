/**
 * ITERATION 60 (A) — discovered superior instances must attach to the base
 * work item, and must never re-animate a matter the user archived.
 */
import { describe, expect, it } from "vitest";
import {
  decideSubscription,
  isSilentSuperiorActivity,
  parseInstanciasSinSuscribir,
} from "../../supabase/functions/_shared/instanciasSinSuscribir.ts";

const UPSTREAM = {
  success: true,
  total: 3,
  instancias: [
    {
      radicado_23: "05001400302820260052101",
      radicado_base_21: "050014003028202600521",
      instancia: "01",
      despacho: "JUZGADO 009 CIVIL DEL CIRCUITO DE MEDELLÍN",
      fecha_ultima_actuacion_proveedor: "2026-08-18T00:00:00",
      descubierto_por: "MANUAL",
      workflow_type_base: "CGP",
      base_activa: true,
    },
    {
      radicado_23: "05030318900120200003202",
      radicado_base_21: "050303189001202000032",
      instancia: "02",
      despacho: "TRIBUNAL SUPERIOR - CIVIL - FAMILIA - ANTIOQUIA",
      fecha_ultima_actuacion_proveedor: "2025-08-27T00:00:00",
      descubierto_por: "PROBE_ARCHIVADOS",
      workflow_type_base: "CGP",
      base_activa: false,
    },
    { radicado_23: "123", radicado_base_21: "050303189001202000032", instancia: "01" },
  ],
};

describe("iter60 — instancias sin suscribir", () => {
  it("parses the upstream envelope and drops unusable rows", () => {
    const rows = parseInstanciasSinSuscribir(UPSTREAM);
    expect(rows).toHaveLength(2);
    expect(rows[0].radicado_base_21).toBe("050014003028202600521");
    expect(rows[0].consecutivo).toBe("01");
    expect(rows[0].instancia).toBe("SEGUNDA");
    expect(rows[1].consecutivo).toBe("02");
  });

  it("rejects a declared base that contradicts the 23-digit key", () => {
    const rows = parseInstanciasSinSuscribir({
      instancias: [{
        radicado_23: "05001400302820260052101",
        radicado_base_21: "999999999999999999999",
        instancia: "01",
      }],
    });
    expect(rows).toHaveLength(0);
  });

  it("subscribes only when the base work item is ACTIVE", () => {
    const [live, archived] = parseInstanciasSinSuscribir(UPSTREAM);
    expect(decideSubscription(live, "ACTIVE")).toBe("SUSCRIBIR");
    expect(decideSubscription(archived, "DELETED")).toBe("OMITIDO_BASE_INACTIVA");
    expect(decideSubscription(live, null)).toBe("OMITIDO_SIN_WORK_ITEM");
  });

  it("never treats a '00' stream as a recurso", () => {
    const [origin] = parseInstanciasSinSuscribir({
      instancias: [{ radicado_23: "05001400302820260052100", instancia: "00" }],
    });
    expect(origin.instancia).toBe("PRIMERA");
    expect(decideSubscription(origin, "ACTIVE")).toBe("OMITIDO_ES_PRIMERA_INSTANCIA");
  });

  it("keeps archived-base discoveries as a user-facing signal", () => {
    expect(isSilentSuperiorActivity("OMITIDO_BASE_INACTIVA")).toBe(true);
    expect(isSilentSuperiorActivity("SUSCRIBIR")).toBe(false);
  });
});
