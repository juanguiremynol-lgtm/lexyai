/**
 * ITER44 — the guard lifts, the vocabulary widens, and reserva becomes
 * structural. Each test below pins a decision that would otherwise rot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  UPSTREAM_LIFECYCLE_WORKFLOWS,
  UPSTREAM_TERM_DETECTION_WORKFLOWS,
  isUpstreamEnrollable,
} from "@/lib/upstream-capability";
import { PROVIDER_CHAIN_BY_WORKFLOW, providerChainFor } from "@/lib/monitoring-matrix";
import {
  claseMotivoLabel,
  isClaseMotivoAccionable,
  isReservaVencida,
} from "@/lib/clase-motivo";
import { derivePenalRouting, cuiEspecialidad, isPenalCui } from "@/lib/penal-routing";

describe("EJECUTIVO guard lifted", () => {
  it("admits EJECUTIVO upstream", () => {
    expect([...UPSTREAM_LIFECYCLE_WORKFLOWS]).toContain("EJECUTIVO");
    expect(isUpstreamEnrollable("EJECUTIVO")).toBe(true);
  });

  it("keeps the mechanism: an área upstream does not know stays blocked", () => {
    expect(isUpstreamEnrollable("AREA_FUTURA")).toBe(false);
  });

  it("records upstream term detection as a permanent absence", () => {
    expect([...UPSTREAM_TERM_DETECTION_WORKFLOWS]).toHaveLength(0);
  });
});

describe("PENAL alias lives in exactly one place", () => {
  it("is absent from the routing matrix", () => {
    expect(Object.keys(PROVIDER_CHAIN_BY_WORKFLOW)).not.toContain("PENAL");
  });

  it("still resolves through normalization", () => {
    expect(providerChainFor("PENAL")).toEqual(["cpnu", "publicaciones"]);
    expect(providerChainFor("PENAL_906")).toEqual(["cpnu", "publicaciones"]);
  });

  it("no longer appears in the bridge provider matrix", () => {
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/_shared/bridgeProviderMatrix.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/^\s*PENAL:/m);
  });
});

describe("absence vocabulary distinguishes conclusions from interruptions", () => {
  it("never invites a retry on a conclusion", () => {
    expect(isClaseMotivoAccionable("PROCESO_PRIVADO")).toBe(false);
    expect(isClaseMotivoAccionable("PROCESO_NO_ENCONTRADO_EN_PROVEEDOR")).toBe(false);
  });

  it("offers a retry on an interruption", () => {
    expect(isClaseMotivoAccionable("LECTURA_FALLIDA")).toBe(true);
    expect(isClaseMotivoAccionable("NO_CONSULTADO_AUN")).toBe(true);
    expect(isClaseMotivoAccionable("DETALLE_NO_DISPONIBLE")).toBe(true);
  });

  it("treats an unknown motive as non-actionable", () => {
    expect(isClaseMotivoAccionable("MOTIVO_INVENTADO")).toBe(false);
    expect(claseMotivoLabel("MOTIVO_INVENTADO")).toBe("MOTIVO_INVENTADO");
  });

  it("labels reserva in Spanish", () => {
    expect(claseMotivoLabel("PROCESO_PRIVADO")).toBe("Proceso con reserva sumarial");
  });
});

describe("reserva TTL", () => {
  const now = new Date("2026-08-10T00:00:00Z");
  it("flags a reserva never revalidated", () => {
    expect(isReservaVencida(null, 7, now)).toBe(true);
  });
  it("flags a reserva older than its TTL", () => {
    expect(isReservaVencida("2026-08-01T00:00:00Z", 7, now)).toBe(true);
  });
  it("accepts a fresh revalidation", () => {
    expect(isReservaVencida("2026-08-08T00:00:00Z", 7, now)).toBe(false);
  });
});

describe("penal routing determinant is structural, not class-based", () => {
  it("reads especialidad 60 from the CUI", () => {
    expect(cuiEspecialidad("08001600125720253122600")).toBe("60");
    expect(isPenalCui("08001600125720253122600")).toBe(true);
    expect(isPenalCui("05001333303320240007800")).toBe(false);
  });

  it("prefers the provider statement over the CUI", () => {
    const s = derivePenalRouting({
      radicado: "05001333303320240007800",
      providerEspecialidad: "PENAL",
    });
    expect(s.isPenal).toBe(true);
    expect(s.determinant).toBe("PROVIDER");
  });

  it("routes a reserved matter with a null class purely on structure", () => {
    const s = derivePenalRouting({ radicado: "08001600125720253122600" });
    expect(s.isPenal).toBe(true);
    expect(s.determinant).toBe("CUI");
  });

  it("lets the user declaration win", () => {
    const s = derivePenalRouting({ radicado: "05001", userDeclared: true });
    expect(s.determinant).toBe("USER");
  });

  it("declines to guess when nothing says penal", () => {
    expect(derivePenalRouting({ radicado: "05001333303320240007800" }).isPenal).toBe(false);
  });
});
