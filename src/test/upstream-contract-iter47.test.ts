/**
 * ITERATION 47 — the constraint conflict, the derived defects, the loose ends.
 *
 * These tests pin down the REASONING, not just the values: each one exists
 * because a specific wrong inference already cost us a production defect.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateBulkFlip,
  DEFAULT_BULK_FLIP_THRESHOLD,
} from "@/lib/upstream/bulk-flip-guard";

describe("ITER47 — bulk-flip guard (the registry near-miss, generalised)", () => {
  it("refuses the exact shape of the iteration-46 misreading: one read flipping the whole portfolio", () => {
    // Had /reserva/estado been queried per item and each answer read as being
    // about the item we asked for, all 50 matters would have gone private.
    const v = evaluateBulkFlip({
      endpointKey: "cpnu.detalle_estado",
      field: "provider_detail_exposure",
      targetState: "PROCESO_PRIVADO",
      affectedRows: 50,
      totalRows: 50,
    });
    expect(v.allowed).toBe(false);
    expect(v.raisesAlert).toBe(true);
    expect(v.reason).toMatch(/malentendido del contrato/i);
  });

  it("allows an ordinary handful of genuine changes", () => {
    const v = evaluateBulkFlip({
      endpointKey: "cpnu.detalle_estado",
      field: "provider_detail_exposure",
      targetState: "PROCESO_PRIVADO",
      affectedRows: 2,
      totalRows: 50,
    });
    expect(v.allowed).toBe(true);
    expect(v.raisesAlert).toBe(false);
  });

  it("does not fire on a small portfolio, where a fraction means nothing", () => {
    // 3 of 4 is 75% but is entirely plausible; the guard must not make a tiny
    // tenant unable to record real state.
    const v = evaluateBulkFlip({
      endpointKey: "cpnu.detalle_estado",
      field: "provider_detail_exposure",
      targetState: "PROCESO_PRIVADO",
      affectedRows: 3,
      totalRows: 4,
    });
    expect(v.allowed).toBe(true);
  });

  it("treats a no-op read as allowed rather than suspicious", () => {
    const v = evaluateBulkFlip({
      endpointKey: "cpnu.detalle_estado",
      field: "provider_detail_exposure",
      targetState: "PROCESO_PRIVADO",
      affectedRows: 0,
      totalRows: 50,
    });
    expect(v.allowed).toBe(true);
    expect(v.fraction).toBe(0);
  });

  it("sits just above and just below the threshold coherently", () => {
    const below = evaluateBulkFlip({
      endpointKey: "e", field: "f", targetState: "T",
      affectedRows: 29, totalRows: 100,
    });
    const above = evaluateBulkFlip({
      endpointKey: "e", field: "f", targetState: "T",
      affectedRows: 31, totalRows: 100,
    });
    expect(DEFAULT_BULK_FLIP_THRESHOLD).toBe(0.3);
    expect(below.allowed).toBe(true);
    expect(above.allowed).toBe(false);
  });

  it("explains itself in Spanish, with the numbers an operator needs", () => {
    const v = evaluateBulkFlip({
      endpointKey: "cpnu.detalle_estado", field: "provider_detail_exposure",
      targetState: "PROCESO_PRIVADO", affectedRows: 40, totalRows: 50,
    });
    expect(v.reason).toContain("40 de 50");
    expect(v.reason).toContain("PROCESO_PRIVADO");
    expect(v.reason).toContain("no se escribió nada");
  });
});
