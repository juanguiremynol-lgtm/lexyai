/**
 * CC1 / CC4 — GCP's own discriminator, the stale-snapshot trap, and the rule
 * that a deleted matter takes its appellate streams with it.
 */
import { describe, it, expect } from "vitest";
import {
  classifyGcpResponse,
  classifyEmptyActuaciones,
  snapshotOrigenIsAuthoritative,
  requiresLiveReread,
} from "../../supabase/functions/_shared/providerStrategy.ts";
import {
  decideSubscription,
  isSilentSuperiorActivity,
} from "../../supabase/functions/_shared/instanciasSinSuscribir.ts";

describe("CC1 — empty actuaciones discriminator", () => {
  it("restringido=true is PROCESO_PRIVADO", () => {
    expect(classifyEmptyActuaciones({ restringido: true, erroresDetalle: [] })).toBe("PROCESO_PRIVADO");
  });
  it("restringido=false with detail errors is PENDING_UPSTREAM", () => {
    expect(classifyEmptyActuaciones({ restringido: false, erroresDetalle: ["timeout"] })).toBe("PENDING_UPSTREAM");
  });
  it("restringido=false with no errors is a genuine empty", () => {
    expect(classifyEmptyActuaciones({ restringido: false, erroresDetalle: [] })).toBe("GENUINE_EMPTY");
  });
});

describe("CC1 — classification never treats a refusal as absence", () => {
  it("HTTP 200 + success + found + restringido is RESTRICTED_BY_PROVIDER", () => {
    const r = classifyGcpResponse({ httpStatus: 200, success: true, found: true, restringido: true });
    expect(r.outcome).toBe("RESTRICTED_BY_PROVIDER");
    expect(r.errorCode).toBe("PROCESO_PRIVADO");
  });
  it("detail errors downgrade to UNAVAILABLE, never to an absence", () => {
    const r = classifyGcpResponse({ httpStatus: 200, success: true, restringido: false, erroresDetalle: ["e"] });
    expect(r.outcome).toBe("UNAVAILABLE");
    expect(r.errorCode).toBe("PENDING_UPSTREAM");
  });
});

describe("CC1(d) — stale snapshot trap", () => {
  it("only snapshot_origen=memoria is authoritative", () => {
    expect(snapshotOrigenIsAuthoritative("memoria")).toBe(true);
    expect(snapshotOrigenIsAuthoritative("MEMORIA")).toBe(true);
    expect(snapshotOrigenIsAuthoritative("cloudsql")).toBe(false);
    expect(snapshotOrigenIsAuthoritative(null)).toBe(false);
  });
  it("a non-memoria snapshot carrying detalleCompleto must be re-read live", () => {
    expect(requiresLiveReread({ snapshotOrigen: "cloudsql", detalleCompleto: true })).toBe(true);
    expect(requiresLiveReread({ snapshotOrigen: "memoria", detalleCompleto: true })).toBe(false);
  });
});

describe("CC4 — deleted origins", () => {
  const inst = {
    radicado_23: "05001310300520260012300" + "01",
    radicado_base_21: "050013103005202600123",
    consecutivo: "01",
    instancia: "SEGUNDA" as const,
    despacho: null,
    fecha_ultima_actuacion_proveedor: null,
    descubierto_por: null,
    acto_disparador: null,
    workflow_type_base: "CGP",
    base_activa_upstream: true,
  };

  it("a deleted base is never subscribed", () => {
    expect(decideSubscription(inst, "DELETED")).toBe("OMITIDO_BASE_ELIMINADA");
  });
  it("and never surfaces as silent superior activity", () => {
    expect(isSilentSuperiorActivity("OMITIDO_BASE_ELIMINADA")).toBe(false);
    expect(isSilentSuperiorActivity("OMITIDO_BASE_INACTIVA")).toBe(true);
  });
  it("an active base is still subscribed", () => {
    expect(decideSubscription(inst, "ACTIVE")).toBe("SUSCRIBIR");
  });
});
