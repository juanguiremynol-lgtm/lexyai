/**
 * ITERATION 29 — the three guards on GCP's clase_proceso contract.
 *
 * A — absence of the block is not absence of the class.
 * B — ineligible or disagreeing mappings are suggestions, never writes.
 * C — unmapped classes are logged verbatim, never guessed.
 */
import { describe, it, expect } from "vitest";
import {
  parseClaseProveedor,
  extractClaseProveedor,
  CLASE_PROCESO_UNAVAILABLE,
  MOTIVO_BLOQUE_AUSENTE,
} from "../../supabase/functions/_shared/claseProcesoContract";
import {
  decideClaseProcesoWrite,
  classifyRead,
  matchClaseToWorkflow,
} from "../../supabase/functions/_shared/claseProcesoWriter";

const MAP = [
  { pattern: "ejecutivos de menor y minima cuantia", workflow_type: "CGP", label: "Ejecutivo de mínima cuantía" },
  { pattern: "ejecutivo singular", workflow_type: "CGP", label: "Ejecutivo singular" },
  { pattern: "ordinario laboral", workflow_type: "LABORAL", label: "Ordinario laboral" },
  { pattern: "nulidad simple", workflow_type: "CPACA", label: "Nulidad simple" },
];

const present = parseClaseProveedor({
  disponible: true,
  clase_proceso: "EJECUTIVOS DE MENOR Y MINIMA CUANTIA",
  subclase_proceso: "EJECUTIVO MÍNIMA CUANTÍA",
  procedencia: { endpoint: "/Proceso/Detalle", id_proceso: 42 },
});

describe("GUARD A — absence is not erasure", () => {
  it("classifies a missing block as INCONCLUSIVE", () => {
    expect(classifyRead(extractClaseProveedor({ ok: true }))).toBe("INCONCLUSIVE");
    expect(classifyRead(CLASE_PROCESO_UNAVAILABLE)).toBe("INCONCLUSIVE");
  });

  it("leaves a previously stored class untouched on a degraded payload", () => {
    const d = decideClaseProcesoWrite({
      contract: extractClaseProveedor({ procesos: [{}] }),
      current: { clase_proceso: "EJECUTIVOS DE MENOR Y MINIMA CUANTIA", workflow_type: "CGP" },
      map: MAP,
    });
    expect(d.readCase).toBe("INCONCLUSIVE");
    expect(d.patch).toEqual({});
    expect(d.claseChanged).toBe(false);
    expect(d.workflow.kind).toBe("NONE");
  });

  it("records the motive — not a bare null — when the provider declines", () => {
    const d = decideClaseProcesoWrite({
      contract: parseClaseProveedor({ disponible: false, motivo_ausencia: "PROVIDER_UNAVAILABLE" }),
      current: { clase_proceso: "EJECUTIVO SINGULAR" },
      map: MAP,
    });
    expect(d.readCase).toBe("DECLINED");
    expect(d.patch.clase_proceso_motivo_ausencia).toBe("PROVIDER_UNAVAILABLE");
    expect(d.patch).not.toHaveProperty("clase_proceso");
  });

  it("uses the block-absent sentinel when nothing was located", () => {
    expect(extractClaseProveedor(null).motivo_ausencia).toBe(MOTIVO_BLOQUE_AUSENTE);
  });
});

describe("GUARD A (i) — present classes are written verbatim", () => {
  it("stores the provider strings unchanged and maps to CGP", () => {
    const d = decideClaseProcesoWrite({ contract: present, current: { workflow_type: "CGP" }, map: MAP });
    expect(d.readCase).toBe("PRESENT");
    expect(d.patch.clase_proceso).toBe("EJECUTIVOS DE MENOR Y MINIMA CUANTIA");
    expect(d.patch.subclase_proceso).toBe("EJECUTIVO MÍNIMA CUANTÍA");
    expect(d.patch.clase_proceso_disponible).toBe(true);
    expect(d.workflow.kind).toBe("APPLY");
    expect(d.patch.workflow_type_source).toBe("PROVIDER_CLASS");
    expect(d.claseChanged).toBe(true);
  });
});

describe("GUARD B — suggestion-only materias and MANUAL primacy", () => {
  it("never auto-assigns LABORAL", () => {
    const d = decideClaseProcesoWrite({
      contract: parseClaseProveedor({ disponible: true, clase_proceso: "ORDINARIO LABORAL" }),
      current: { workflow_type: "INDETERMINADO", workflow_type_source: "AUTO" },
      map: MAP,
    });
    expect(d.workflow.kind).toBe("SUGGEST");
    expect(d.patch).not.toHaveProperty("workflow_type");
  });

  it("suggests, never rewrites, when the class disagrees with a non-MANUAL type", () => {
    const d = decideClaseProcesoWrite({
      contract: parseClaseProveedor({ disponible: true, clase_proceso: "NULIDAD SIMPLE" }),
      current: { workflow_type: "CGP", workflow_type_source: "AUTO" },
      map: MAP,
    });
    expect(d.workflow.kind).toBe("SUGGEST");
    expect(d.patch).not.toHaveProperty("workflow_type");
  });

  it("records a MANUAL matter's class as corroboration and touches no workflow field", () => {
    const d = decideClaseProcesoWrite({
      contract: parseClaseProveedor({ disponible: true, clase_proceso: "NULIDAD SIMPLE" }),
      current: { workflow_type: "CGP", workflow_type_source: "MANUAL" },
      map: MAP,
    });
    expect(d.workflow.kind).toBe("NONE");
    expect(d.patch.clase_proceso).toBe("NULIDAD SIMPLE");
    expect(d.patch).not.toHaveProperty("workflow_type");
    expect(d.patch).not.toHaveProperty("workflow_type_source");
  });
});

describe("GUARD C — unmapped classes are logged, never guessed", () => {
  it("stores the class verbatim and leaves workflow_type alone", () => {
    const d = decideClaseProcesoWrite({
      contract: parseClaseProveedor({ disponible: true, clase_proceso: "PROCESO EXÓTICO SIN CATÁLOGO" }),
      current: { workflow_type: "CGP", workflow_type_source: "AUTO" },
      map: MAP,
    });
    expect(d.unmappedClase).toBe("PROCESO EXÓTICO SIN CATÁLOGO");
    expect(d.patch.clase_proceso).toBe("PROCESO EXÓTICO SIN CATÁLOGO");
    expect(d.patch).not.toHaveProperty("workflow_type");
  });
});

describe("catalogue matching", () => {
  it("is accent- and case-insensitive and prefers the longest pattern", () => {
    expect(matchClaseToWorkflow("Ejecutivos de Menor y Mínima Cuantía", MAP)?.workflow_type).toBe("CGP");
    expect(matchClaseToWorkflow(null, MAP)).toBeNull();
  });
});
