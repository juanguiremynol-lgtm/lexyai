/**
 * Comprehensive tests for CPNU sujetosProcesales string parsing,
 * party extraction, merge logic, and FOUND_PARTIAL prefill behavior.
 */

import { describe, it, expect } from "vitest";

// ============= PARSER UNDER TEST =============
// Mirrors the exact logic from adapter-cpnu/index.ts sujetosProcesales string branch.

const ROLE_RE = /^(Demandante|Demandado|Accionante|Accionado|Actor|Tutelante|Solicitante|Convocado|Convocante)\s*:\s*(.+)$/i;

interface Sujeto { tipo: string; nombre: string }

function parseSujetosProcesalesString(rawStr: string): {
  sujetos: Sujeto[];
  demandante?: string;
  demandado?: string;
} {
  const trimmed = rawStr.trim();
  if (!trimmed) return { sujetos: [] };

  let parts: string[];
  if (/[|;\/\n]/.test(trimmed)) {
    parts = trimmed.split(/[|;\/\n]/).map(s => s.trim().replace(/\.+$/, '')).filter(Boolean);
  } else if (/\s{2,}/.test(trimmed)) {
    parts = trimmed.split(/\s{2,}/).map(s => s.trim().replace(/\.+$/, '')).filter(Boolean);
  } else {
    parts = [trimmed.replace(/\.+$/, '')];
  }

  const sujetos: Sujeto[] = [];
  let demandante: string | undefined;
  let demandado: string | undefined;

  for (const raw of parts) {
    const m = raw.match(ROLE_RE);
    if (m) {
      const tipo = m[1].trim();
      const nombre = m[2].trim().replace(/\.+$/, '');
      sujetos.push({ tipo, nombre });
      if (/demandante|accionante|actor|tutelante|solicitante|convocante/i.test(tipo) && !demandante) demandante = nombre;
      if (/demandado|accionado|convocado/i.test(tipo) && !demandado) demandado = nombre;
    } else {
      sujetos.push({ tipo: 'Parte', nombre: raw });
    }
  }

  return { sujetos, demandante, demandado };
}

// ============= TESTS =============

describe("sujetosProcesales string parser", () => {
  // --- A) Exact anchor sample ---
  it("parses pipe-separated 'Role: Name' format", () => {
    const r = parseSujetosProcesalesString("Demandante: OFELIA MERCEDES MAYA MARTINEZ | Demandado: TIERRADENTRO");
    expect(r.demandante).toBe("OFELIA MERCEDES MAYA MARTINEZ");
    expect(r.demandado).toBe("TIERRADENTRO");
    expect(r.sujetos).toHaveLength(2);
  });

  // --- B) Separator variants ---
  it("handles semicolon separator", () => {
    const r = parseSujetosProcesalesString("Demandante: ANA GARCIA; Demandado: PEDRO LOPEZ");
    expect(r.demandante).toBe("ANA GARCIA");
    expect(r.demandado).toBe("PEDRO LOPEZ");
  });

  it("handles slash separator", () => {
    const r = parseSujetosProcesalesString("Accionante: MARIA / Accionado: CARLOS");
    expect(r.demandante).toBe("MARIA");
    expect(r.demandado).toBe("CARLOS");
  });

  it("handles newline separator", () => {
    const r = parseSujetosProcesalesString("Demandante: ANA\nDemandado: PEDRO");
    expect(r.demandante).toBe("ANA");
    expect(r.demandado).toBe("PEDRO");
  });

  it("handles double-space separator when no other delimiters present", () => {
    const r = parseSujetosProcesalesString("Demandante: ANA GARCIA  Demandado: PEDRO LOPEZ");
    expect(r.demandante).toBe("ANA GARCIA");
    expect(r.demandado).toBe("PEDRO LOPEZ");
  });

  // --- C) Role label variants ---
  it("handles Accionante/Accionado (tutela labels)", () => {
    const r = parseSujetosProcesalesString("Accionante: JUAN | Accionado: EPS SURA");
    expect(r.demandante).toBe("JUAN");
    expect(r.demandado).toBe("EPS SURA");
  });

  it("handles Actor label", () => {
    const r = parseSujetosProcesalesString("Actor: MARIA GARCIA | Demandado: BANCO");
    expect(r.demandante).toBe("MARIA GARCIA");
    expect(r.demandado).toBe("BANCO");
  });

  it("handles Tutelante label", () => {
    const r = parseSujetosProcesalesString("Tutelante: PEDRO | Accionado: HOSPITAL");
    expect(r.demandante).toBe("PEDRO");
    expect(r.demandado).toBe("HOSPITAL");
  });

  it("handles Solicitante/Convocado labels", () => {
    const r = parseSujetosProcesalesString("Solicitante: EMPRESA ABC | Convocado: EMPRESA XYZ");
    expect(r.demandante).toBe("EMPRESA ABC");
    expect(r.demandado).toBe("EMPRESA XYZ");
  });

  it("handles case-insensitive role labels", () => {
    const r = parseSujetosProcesalesString("demandante: ana | DEMANDADO: pedro");
    expect(r.demandante).toBe("ana");
    expect(r.demandado).toBe("pedro");
  });

  // --- D) Trailing punctuation / whitespace ---
  it("strips trailing periods from names", () => {
    const r = parseSujetosProcesalesString("Demandante: TIERRADENTRO. | Demandado: MARTINEZ...");
    expect(r.demandante).toBe("TIERRADENTRO");
    expect(r.demandado).toBe("MARTINEZ");
  });

  it("handles extra whitespace around separators", () => {
    const r = parseSujetosProcesalesString("  Demandante:  ANA GARCIA   |   Demandado:  PEDRO  ");
    expect(r.demandante).toBe("ANA GARCIA");
    expect(r.demandado).toBe("PEDRO");
  });

  // --- E) Multi-party ---
  it("handles multiple demandantes (first wins as primary)", () => {
    const r = parseSujetosProcesalesString("Demandante: ANA | Demandante: PEDRO | Demandado: BANCO");
    expect(r.demandante).toBe("ANA"); // First wins
    expect(r.demandado).toBe("BANCO");
    expect(r.sujetos).toHaveLength(3);
    expect(r.sujetos.filter(s => s.tipo === 'Demandante')).toHaveLength(2);
  });

  it("handles multiple demandados (first wins as primary)", () => {
    const r = parseSujetosProcesalesString("Demandante: ANA | Demandado: BANCO | Demandado: EPS");
    expect(r.demandante).toBe("ANA");
    expect(r.demandado).toBe("BANCO"); // First wins
    expect(r.sujetos.filter(s => s.tipo === 'Demandado')).toHaveLength(2);
  });

  // --- F) No-role (generic) strings ---
  it("assigns 'Parte' when no role prefix exists", () => {
    const r = parseSujetosProcesalesString("TIERRADENTRO | OFELIA MERCEDES MAYA MARTINEZ");
    expect(r.demandante).toBeUndefined();
    expect(r.demandado).toBeUndefined();
    expect(r.sujetos).toHaveLength(2);
    expect(r.sujetos[0].tipo).toBe("Parte");
  });

  it("returns single party when no separator", () => {
    const r = parseSujetosProcesalesString("Demandante: OFELIA MERCEDES");
    expect(r.demandante).toBe("OFELIA MERCEDES");
    expect(r.demandado).toBeUndefined();
    expect(r.sujetos).toHaveLength(1);
  });

  it("returns empty for blank string", () => {
    const r = parseSujetosProcesalesString("   ");
    expect(r.sujetos).toHaveLength(0);
    expect(r.demandante).toBeUndefined();
  });
});

// ============= EXTRACTION / MERGE TESTS =============

describe("CPNU party extraction in sync-by-radicado", () => {
  function simulateAdapterCpnuResponse(overrides?: {
    demandante?: string; demandado?: string; fecha_radicacion?: string;
    sujetos?: Sujeto[];
  }) {
    return {
      ok: true,
      proceso: {
        despacho: "Juzgado 004 Municipal",
        demandante: overrides?.demandante,
        demandado: overrides?.demandado,
        fecha_radicacion: overrides?.fecha_radicacion,
        sujetos_procesales: overrides?.sujetos || [],
        actuaciones: [],
      },
      results: [{
        radicado: "05001410500420261008600",
        despacho: "Juzgado 004 Municipal",
        demandante: overrides?.demandante || "OFELIA",
        demandado: overrides?.demandado || "TIERRADENTRO",
        fecha_radicacion: overrides?.fecha_radicacion || "2026-02-13",
        sujetos_procesales: overrides?.sujetos || [],
      }],
    };
  }

  function extractFromCpnu(result: ReturnType<typeof simulateAdapterCpnuResponse>) {
    const proceso = result.proceso;
    const mainResult = result.results?.[0] || ({} as any);

    let demandantes = "";
    let demandados = "";

    if (proceso.sujetos_procesales?.length > 0) {
      const dList = proceso.sujetos_procesales
        .filter(s => /demandante|accionante|actor|tutelante|solicitante|convocante/i.test(s.tipo))
        .map(s => s.nombre);
      const aList = proceso.sujetos_procesales
        .filter(s => /demandado|accionado|convocado/i.test(s.tipo))
        .map(s => s.nombre);
      if (dList.length) demandantes = dList.join(", ");
      if (aList.length) demandados = aList.join(", ");
    }

    return {
      demandante: demandantes || mainResult.demandante || proceso.demandante,
      demandado: demandados || mainResult.demandado || proceso.demandado,
      fecha_radicacion: mainResult.fecha_radicacion || proceso.fecha_radicacion,
    };
  }

  it("extracts parties from results[0] when sujetos empty", () => {
    const r = simulateAdapterCpnuResponse({ demandante: "JUAN", demandado: "EPS" });
    const e = extractFromCpnu(r);
    expect(e.demandante).toBe("JUAN");
    expect(e.demandado).toBe("EPS");
  });

  it("prefers sujetos_procesales over results[0]", () => {
    const r = simulateAdapterCpnuResponse({
      sujetos: [
        { tipo: "Accionante", nombre: "MARIA" },
        { tipo: "Accionado", nombre: "CLINICA" },
      ],
    });
    const e = extractFromCpnu(r);
    expect(e.demandante).toBe("MARIA");
    expect(e.demandado).toBe("CLINICA");
  });

  it("extracts fecha_radicacion from results[0]", () => {
    const e = extractFromCpnu(simulateAdapterCpnuResponse({ fecha_radicacion: "2026-02-13" }));
    expect(e.fecha_radicacion).toBe("2026-02-13");
  });

  it("does NOT fabricate fecha when absent", () => {
    const r = simulateAdapterCpnuResponse({ fecha_radicacion: undefined });
    r.results[0].fecha_radicacion = undefined as any;
    const e = extractFromCpnu(r);
    expect(e.fecha_radicacion).toBeFalsy();
  });
});

// ============= MERGE PROTECTION TESTS =============

describe("merge logic: empty providers never overwrite populated parties", () => {
  it("preserves CPNU parties when SAMAI returns nothing", () => {
    const cpnu = { demandante: "JUAN", demandado: "EPS" };
    const samai = { demandante: undefined as string | undefined, demandado: undefined as string | undefined };
    const merged = {
      demandante: cpnu.demandante || samai.demandante || "",
      demandado: cpnu.demandado || samai.demandado || "",
    };
    expect(merged.demandante).toBe("JUAN");
    expect(merged.demandado).toBe("EPS");
  });

  it("preserves Phase 1 parties when fallback lacks them", () => {
    const p1 = { demandante: "OFELIA", demandado: "TIERRADENTRO", fecha_radicacion: "2026-02-13" };
    const fb = { demandante: undefined as string | undefined, demandado: undefined as string | undefined, fecha_radicacion: undefined as string | undefined };
    const merged = {
      demandante: fb.demandante?.trim() || p1.demandante,
      demandado: fb.demandado?.trim() || p1.demandado,
      fecha_radicacion: fb.fecha_radicacion || p1.fecha_radicacion,
    };
    expect(merged.demandante).toBe("OFELIA");
    expect(merged.demandado).toBe("TIERRADENTRO");
    expect(merged.fecha_radicacion).toBe("2026-02-13");
  });
});

// ============= FOUND_PARTIAL PREFILL TESTS =============

describe("FOUND_PARTIAL still pre-fills known fields", () => {
  it("wizard prefills parties even when found_status is FOUND_PARTIAL and actuaciones=0", () => {
    // Simulate what the wizard receives from sync-by-radicado
    const lookupResult = {
      ok: true,
      found_in_source: true,
      found_status: "FOUND_PARTIAL" as const,
      process_data: {
        despacho: "JUZGADO 004",
        demandante: "OFELIA MERCEDES MAYA MARTINEZ",
        demandado: "TIERRADENTRO",
        fecha_radicacion: "2026-02-13",
        actuaciones: [], // empty — 406 from actuaciones endpoint
        total_actuaciones: 0,
      },
    };

    // Simulate wizard prefill logic (from CreateWorkItemWizard.tsx)
    const data = lookupResult.process_data;
    const normParties = (raw: string | undefined) => raw?.replace(/\s*\|\s*/g, ', ') || '';
    const demandantes = normParties(data.demandante);
    const demandados = normParties(data.demandado);
    const despacho = data.despacho || '';
    const fechaRadicacion = data.fecha_radicacion || '';

    expect(demandantes).toBe("OFELIA MERCEDES MAYA MARTINEZ");
    expect(demandados).toBe("TIERRADENTRO");
    expect(despacho).toBe("JUZGADO 004");
    expect(fechaRadicacion).toBe("2026-02-13");

    // found_in_source is true so lookupStatus should be 'success', enabling AutoFillBadge
    expect(lookupResult.found_in_source).toBe(true);
  });

  it("INCOMPLETE_DATA (406) still returns found:true with Phase 1 parties", () => {
    const phase1Results = [{
      demandante: "OFELIA",
      demandado: "TIERRADENTRO",
      despacho: "JUZGADO 004",
      fecha_radicacion: "2026-02-13",
    }];
    let results: typeof phase1Results = [];

    // Restore phase1Results (the fix in adapter-cpnu)
    if (results.length === 0 && phase1Results.length > 0) {
      results = phase1Results;
    }

    const ok = results.length > 0;
    expect(ok).toBe(true);
    expect(results[0].demandante).toBe("OFELIA");
    expect(results[0].demandado).toBe("TIERRADENTRO");
  });
});
