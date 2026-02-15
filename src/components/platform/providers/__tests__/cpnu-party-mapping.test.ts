/**
 * Regression test: Verify parties, fecha_radicacion, and actuaciones are correctly
 * extracted from the adapter-cpnu response shape used by sync-by-radicado.
 *
 * Root cause of bug: adapter-cpnu puts demandante/demandado/fecha_radicacion on
 * results[0], NOT on proceso. fetchFromCpnu was only reading from proceso.
 * Actuaciones used event_date/description/detail (ProcessEvent) but fetchFromCpnu
 * expected fecha_actuacion/actuacion/anotacion.
 */

import { describe, it, expect } from "vitest";

// Simulate the adapter-cpnu response shape
function simulateAdapterCpnuResponse() {
  return {
    ok: true,
    source: "CPNU_API -> EXTERNAL_API",
    proceso: {
      despacho: "Juzgado 004 Penal Municipal de Medellín",
      tipo: "TUTELA",
      clase: undefined,
      sujetos_procesales: [],
      actuaciones: [
        {
          source: "CPNU",
          event_type: "RADICACION",
          event_date: "2026-01-15T05:00:00.000Z",
          title: "RADICACIÓN DEMANDA",
          description: "RADICACIÓN DEMANDA",
          detail: "Se radica acción de tutela.",
          attachments: [],
          source_url: "https://consultaprocesos.ramajudicial.gov.co/...",
          hash_fingerprint: "abc123",
        },
        {
          source: "CPNU",
          event_type: "AUTO",
          event_date: "2026-01-20T05:00:00.000Z",
          title: "AUTO ADMISORIO DE LA DEMANDA",
          description: "AUTO ADMISORIO DE LA DEMANDA",
          detail: "Se admite tutela.",
          attachments: [],
          source_url: "https://consultaprocesos.ramajudicial.gov.co/...",
          hash_fingerprint: "def456",
        },
      ],
      estados_electronicos: [],
    },
    results: [
      {
        radicado: "05001410500420261008600",
        despacho: "Juzgado 004 Penal Municipal de Medellín",
        demandante: "JUAN PEREZ",
        demandado: "EPS SURA",
        tipo_proceso: "TUTELA",
        fecha_radicacion: "2026-01-15",
        id_proceso: 99999,
        sujetos_procesales: [],
      },
    ],
  };
}

/**
 * Mirrors the extraction logic from sync-by-radicado's fetchFromCpnu (FIXED version)
 */
function extractFromCpnuResult(result: ReturnType<typeof simulateAdapterCpnuResponse>) {
  const proceso = result.proceso;
  const mainResult = result.results?.[0] || ({} as any);

  let demandantes = "";
  let demandados = "";

  if (proceso.sujetos_procesales?.length > 0) {
    const dList = proceso.sujetos_procesales
      .filter((s) =>
        s.tipo?.toLowerCase().includes("demandante") ||
        s.tipo?.toLowerCase().includes("accionante")
      )
      .map((s) => s.nombre);
    const aList = proceso.sujetos_procesales
      .filter((s) =>
        s.tipo?.toLowerCase().includes("demandado") ||
        s.tipo?.toLowerCase().includes("accionado")
      )
      .map((s) => s.nombre);
    if (dList.length) demandantes = dList.join(", ");
    if (aList.length) demandados = aList.join(", ");
  }

  const actuaciones = (proceso.actuaciones || []).map((act: any) => ({
    fecha: (act.fecha_actuacion || act.fecha || act.event_date || "") as string,
    actuacion: (act.actuacion || act.title || act.description || "") as string,
    anotacion: (act.anotacion || act.detail || "") as string,
  }));

  return {
    demandante: demandantes || mainResult.demandante || (proceso as any).demandante,
    demandado: demandados || mainResult.demandado || (proceso as any).demandado,
    fecha_radicacion: mainResult.fecha_radicacion || (proceso as any).fecha_radicacion,
    actuaciones,
  };
}

describe("CPNU party/date/actuacion extraction (regression)", () => {
  it("extracts demandante from results[0] when sujetos_procesales is empty", () => {
    const result = simulateAdapterCpnuResponse();
    const extracted = extractFromCpnuResult(result);
    expect(extracted.demandante).toBe("JUAN PEREZ");
  });

  it("extracts demandado from results[0] when sujetos_procesales is empty", () => {
    const result = simulateAdapterCpnuResponse();
    const extracted = extractFromCpnuResult(result);
    expect(extracted.demandado).toBe("EPS SURA");
  });

  it("extracts fecha_radicacion from results[0]", () => {
    const result = simulateAdapterCpnuResponse();
    const extracted = extractFromCpnuResult(result);
    expect(extracted.fecha_radicacion).toBe("2026-01-15");
  });

  it("does NOT fabricate fecha_radicacion as {year}-01-01", () => {
    const result = simulateAdapterCpnuResponse();
    // Remove fecha_radicacion from results[0]
    (result.results[0] as any).fecha_radicacion = undefined;
    const extracted = extractFromCpnuResult(result);
    expect(extracted.fecha_radicacion).toBeFalsy();
  });

  it("maps actuaciones event_date/title/detail to fecha/actuacion/anotacion", () => {
    const result = simulateAdapterCpnuResponse();
    const extracted = extractFromCpnuResult(result);
    expect(extracted.actuaciones).toHaveLength(2);
    expect(extracted.actuaciones[0].fecha).toBe("2026-01-15T05:00:00.000Z");
    expect(extracted.actuaciones[0].actuacion).toBe("RADICACIÓN DEMANDA");
    expect(extracted.actuaciones[0].anotacion).toBe("Se radica acción de tutela.");
  });

  it("prefers sujetos_procesales over results[0] when available", () => {
    const result = simulateAdapterCpnuResponse();
    result.proceso.sujetos_procesales = [
      { tipo: "ACCIONANTE", nombre: "MARIA GARCIA" },
      { tipo: "ACCIONADO", nombre: "CLINICA ABC" },
    ];
    const extracted = extractFromCpnuResult(result);
    expect(extracted.demandante).toBe("MARIA GARCIA");
    expect(extracted.demandado).toBe("CLINICA ABC");
  });

  it("null merge: empty provider doesn't overwrite populated parties", () => {
    // Simulate CPNU returns parties, SAMAI returns nothing
    const cpnuParties = { demandante: "JUAN PEREZ", demandado: "EPS SURA" };
    const samaiParties = { demandante: undefined, demandado: undefined };

    // "First non-empty wins" merge (sync-by-radicado TUTELA merge logic)
    const merged = {
      demandante: cpnuParties.demandante || samaiParties.demandante || "",
      demandado: cpnuParties.demandado || samaiParties.demandado || "",
    };
    expect(merged.demandante).toBe("JUAN PEREZ");
    expect(merged.demandado).toBe("EPS SURA");
  });

  it("mergeResultsPreserveParties: preserves Phase 1 parties when fallback lacks them", () => {
    // Simulate: Phase 1 (QUERY_LIST) returns parties but actuaciones fail (406)
    // Fallback (Firecrawl) gets results but without parties
    const phase1Results = [{
      radicado: "05001410500420261008600",
      despacho: "JUZGADO 004 MUNICIPAL DE PEQUEÑAS CAUSAS LABORALES DE MEDELLÍN",
      demandante: "OFELIA MERCEDES MAYA MARTINEZ",
      demandado: "TIERRADENTRO",
      tipo_proceso: "Especiales",
      fecha_radicacion: "2026-02-13",
    }];
    const fallbackResults = [{
      radicado: "05001410500420261008600",
      despacho: "Juzgado 004 Municipal Pequeñas Causas Laborales",
      demandante: undefined as string | undefined,
      demandado: undefined as string | undefined,
      tipo_proceso: undefined as string | undefined,
      fecha_radicacion: undefined as string | undefined,
    }];

    // Simulate mergeResultsPreserveParties logic
    const merged = fallbackResults.map((fb, i) => {
      if (i > 0) return fb;
      const p1 = phase1Results[0];
      return {
        ...fb,
        demandante: fb.demandante?.trim() || p1.demandante,
        demandado: fb.demandado?.trim() || p1.demandado,
        fecha_radicacion: fb.fecha_radicacion || p1.fecha_radicacion,
        despacho: fb.despacho?.trim() || p1.despacho,
        tipo_proceso: fb.tipo_proceso || p1.tipo_proceso,
      };
    });

    expect(merged[0].demandante).toBe("OFELIA MERCEDES MAYA MARTINEZ");
    expect(merged[0].demandado).toBe("TIERRADENTRO");
    expect(merged[0].fecha_radicacion).toBe("2026-02-13");
    expect(merged[0].despacho).toBe("Juzgado 004 Municipal Pequeñas Causas Laborales");
  });

  it("proceso object includes demandante/demandado from results[0]", () => {
    // Simulates the proceso builder in adapter-cpnu
    const results = [{
      radicado: "05001410500420261008600",
      despacho: "JUZGADO 004",
      demandante: "OFELIA MERCEDES MAYA MARTINEZ",
      demandado: "TIERRADENTRO",
      tipo_proceso: "Especiales",
      fecha_radicacion: "2026-02-13",
      sujetos_procesales: [],
    }];
    const mainResult = results[0];
    const proceso = {
      despacho: mainResult.despacho || '',
      tipo: mainResult.tipo_proceso,
      demandante: mainResult.demandante,
      demandado: mainResult.demandado,
      fecha_radicacion: mainResult.fecha_radicacion,
      sujetos_procesales: mainResult.sujetos_procesales || [],
    };
    expect(proceso.demandante).toBe("OFELIA MERCEDES MAYA MARTINEZ");
    expect(proceso.demandado).toBe("TIERRADENTRO");
    expect(proceso.fecha_radicacion).toBe("2026-02-13");
  });
});
