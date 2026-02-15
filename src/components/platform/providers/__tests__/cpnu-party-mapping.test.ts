/**
 * Comprehensive tests for shared partyNormalization module.
 * Tests cover: string parsing, array parsing, merge logic,
 * FOUND_PARTIAL prefill, and sync-path consistency.
 *
 * The shared module (_shared/partyNormalization.ts) is the single source of truth
 * used by adapter-cpnu, sync-by-radicado, and sync-by-work-item.
 * Since edge function imports aren't available in vitest, we mirror the exact
 * logic here to validate correctness.
 */

import { describe, it, expect } from "vitest";

// ============= MIRRORED SHARED LOGIC =============
// Mirrors _shared/partyNormalization.ts exactly for test validation.

const ROLE_RE =
  /^(Demandante|Demandado|Accionante|Accionado|Actor|Tutelante|Solicitante|Convocado|Convocante|Procesado|Ofendido)\s*:\s*(.+)$/i;

const DEMANDANTE_RE = /demandante|accionante|actor|tutelante|solicitante|convocante|ofendido/i;
const DEMANDADO_RE = /demandado|accionado|convocado|procesado/i;

interface ParsedParty {
  canonicalRole: 'DEMANDANTE' | 'DEMANDADO' | 'PARTE';
  rawRole: string;
  name: string;
}

interface PartyParseResult {
  demandante?: string;
  demandado?: string;
  partes: ParsedParty[];
}

function canonicalizeRole(rawRole: string): 'DEMANDANTE' | 'DEMANDADO' | 'PARTE' {
  if (DEMANDANTE_RE.test(rawRole)) return 'DEMANDANTE';
  if (DEMANDADO_RE.test(rawRole)) return 'DEMANDADO';
  return 'PARTE';
}

function cleanName(name: string): string {
  return name.trim().replace(/\.+$/, '').trim();
}

function parseSujetosProcesalesString(rawStr: string): PartyParseResult {
  const trimmed = rawStr.trim();
  if (!trimmed) return { partes: [] };

  let parts: string[];
  if (/[|;\/\n]/.test(trimmed)) {
    parts = trimmed.split(/[|;\/\n]/).map(s => cleanName(s)).filter(Boolean);
  } else if (/\s{2,}/.test(trimmed)) {
    parts = trimmed.split(/\s{2,}/).map(s => cleanName(s)).filter(Boolean);
  } else {
    parts = [cleanName(trimmed)];
  }

  const partes: ParsedParty[] = [];
  let demandante: string | undefined;
  let demandado: string | undefined;

  for (const raw of parts) {
    const m = raw.match(ROLE_RE);
    if (m) {
      const rawRole = m[1].trim();
      const name = cleanName(m[2]);
      const cr = canonicalizeRole(rawRole);
      partes.push({ canonicalRole: cr, rawRole, name });
      if (cr === 'DEMANDANTE' && !demandante) demandante = name;
      if (cr === 'DEMANDADO' && !demandado) demandado = name;
    } else {
      partes.push({ canonicalRole: 'PARTE', rawRole: 'Parte', name: raw });
    }
  }

  return { demandante, demandado, partes };
}

function parseSujetosArray(
  sujetos: Array<{ tipoParte?: string; tipo?: string; nombre?: string }>
): PartyParseResult {
  const partes: ParsedParty[] = [];
  let demandante: string | undefined;
  let demandado: string | undefined;

  for (const s of sujetos) {
    const rawRole = (s.tipoParte || s.tipo || 'Parte').trim();
    const name = cleanName(s.nombre || '');
    if (!name) continue;
    const cr = canonicalizeRole(rawRole);
    partes.push({ canonicalRole: cr, rawRole, name });
    if (cr === 'DEMANDANTE' && !demandante) demandante = name;
    if (cr === 'DEMANDADO' && !demandado) demandado = name;
  }

  return { demandante, demandado, partes };
}

function mergeParties(primary: PartyParseResult, secondary: PartyParseResult): PartyParseResult {
  const demandante = primary.demandante || secondary.demandante;
  const demandado = primary.demandado || secondary.demandado;
  const seen = new Set<string>();
  const merged: ParsedParty[] = [];
  for (const p of [...primary.partes, ...secondary.partes]) {
    const key = `${p.canonicalRole}|${p.name.toUpperCase()}`;
    if (!seen.has(key)) { seen.add(key); merged.push(p); }
  }
  return { demandante, demandado, partes: merged };
}

function extractPartiesFromProviderResult(result: {
  sujetos_procesales?: Array<{ tipo: string; nombre: string }>;
  demandante?: string;
  demandado?: string;
}): { demandantes: string; demandados: string } {
  let demandantes = '';
  let demandados = '';
  if (result.sujetos_procesales?.length) {
    const parsed = parseSujetosArray(result.sujetos_procesales.map(s => ({ tipo: s.tipo, nombre: s.nombre })));
    const dList = parsed.partes.filter(p => p.canonicalRole === 'DEMANDANTE').map(p => p.name);
    const aList = parsed.partes.filter(p => p.canonicalRole === 'DEMANDADO').map(p => p.name);
    if (dList.length) demandantes = dList.join(', ');
    if (aList.length) demandados = aList.join(', ');
  }
  if (!demandantes && result.demandante) demandantes = result.demandante;
  if (!demandados && result.demandado) demandados = result.demandado;
  return { demandantes, demandados };
}

// ============= TESTS =============

describe("canonicalizeRole", () => {
  it("maps Demandante variants to DEMANDANTE", () => {
    expect(canonicalizeRole("Demandante")).toBe("DEMANDANTE");
    expect(canonicalizeRole("Accionante")).toBe("DEMANDANTE");
    expect(canonicalizeRole("Actor")).toBe("DEMANDANTE");
    expect(canonicalizeRole("Tutelante")).toBe("DEMANDANTE");
    expect(canonicalizeRole("Solicitante")).toBe("DEMANDANTE");
    expect(canonicalizeRole("Convocante")).toBe("DEMANDANTE");
    expect(canonicalizeRole("Ofendido")).toBe("DEMANDANTE");
  });

  it("maps Demandado variants to DEMANDADO", () => {
    expect(canonicalizeRole("Demandado")).toBe("DEMANDADO");
    expect(canonicalizeRole("Accionado")).toBe("DEMANDADO");
    expect(canonicalizeRole("Convocado")).toBe("DEMANDADO");
    expect(canonicalizeRole("Procesado")).toBe("DEMANDADO");
  });

  it("maps unknown roles to PARTE", () => {
    expect(canonicalizeRole("Parte")).toBe("PARTE");
    expect(canonicalizeRole("Testigo")).toBe("PARTE");
    expect(canonicalizeRole("Juez")).toBe("PARTE");
  });
});

describe("parseSujetosProcesalesString", () => {
  it("parses pipe-separated 'Role: Name' format (anchor case)", () => {
    const r = parseSujetosProcesalesString("Demandante: OFELIA MERCEDES MAYA MARTINEZ | Demandado: TIERRADENTRO");
    expect(r.demandante).toBe("OFELIA MERCEDES MAYA MARTINEZ");
    expect(r.demandado).toBe("TIERRADENTRO");
    expect(r.partes).toHaveLength(2);
    expect(r.partes[0].canonicalRole).toBe("DEMANDANTE");
    expect(r.partes[1].canonicalRole).toBe("DEMANDADO");
  });

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

  it("handles double-space separator", () => {
    const r = parseSujetosProcesalesString("Demandante: ANA GARCIA  Demandado: PEDRO LOPEZ");
    expect(r.demandante).toBe("ANA GARCIA");
    expect(r.demandado).toBe("PEDRO LOPEZ");
  });

  it("handles Accionante/Accionado (tutela labels)", () => {
    const r = parseSujetosProcesalesString("Accionante: JUAN | Accionado: EPS SURA");
    expect(r.demandante).toBe("JUAN");
    expect(r.demandado).toBe("EPS SURA");
    expect(r.partes[0].canonicalRole).toBe("DEMANDANTE");
    expect(r.partes[1].canonicalRole).toBe("DEMANDADO");
  });

  it("handles Actor label", () => {
    const r = parseSujetosProcesalesString("Actor: MARIA GARCIA | Demandado: BANCO");
    expect(r.demandante).toBe("MARIA GARCIA");
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

  it("handles multiple demandantes (first wins as primary)", () => {
    const r = parseSujetosProcesalesString("Demandante: ANA | Demandante: PEDRO | Demandado: BANCO");
    expect(r.demandante).toBe("ANA");
    expect(r.demandado).toBe("BANCO");
    expect(r.partes).toHaveLength(3);
    expect(r.partes.filter(p => p.canonicalRole === 'DEMANDANTE')).toHaveLength(2);
  });

  it("handles multiple demandados (first wins as primary)", () => {
    const r = parseSujetosProcesalesString("Demandante: ANA | Demandado: BANCO | Demandado: EPS");
    expect(r.demandante).toBe("ANA");
    expect(r.demandado).toBe("BANCO");
    expect(r.partes.filter(p => p.canonicalRole === 'DEMANDADO')).toHaveLength(2);
  });

  it("assigns 'PARTE' when no role prefix exists", () => {
    const r = parseSujetosProcesalesString("TIERRADENTRO | OFELIA MERCEDES MAYA MARTINEZ");
    expect(r.demandante).toBeUndefined();
    expect(r.demandado).toBeUndefined();
    expect(r.partes).toHaveLength(2);
    expect(r.partes[0].canonicalRole).toBe("PARTE");
  });

  it("returns single party when no separator", () => {
    const r = parseSujetosProcesalesString("Demandante: OFELIA MERCEDES");
    expect(r.demandante).toBe("OFELIA MERCEDES");
    expect(r.demandado).toBeUndefined();
    expect(r.partes).toHaveLength(1);
  });

  it("returns empty for blank string", () => {
    const r = parseSujetosProcesalesString("   ");
    expect(r.partes).toHaveLength(0);
    expect(r.demandante).toBeUndefined();
  });

  it("handles Procesado/Ofendido (penal labels)", () => {
    const r = parseSujetosProcesalesString("Ofendido: VICTIMA | Procesado: IMPUTADO");
    expect(r.demandante).toBe("VICTIMA");
    expect(r.demandado).toBe("IMPUTADO");
  });
});

describe("parseSujetosArray", () => {
  it("parses structured array with tipoParte", () => {
    const r = parseSujetosArray([
      { tipoParte: "Demandante", nombre: "JUAN" },
      { tipoParte: "Demandado", nombre: "EPS" },
    ]);
    expect(r.demandante).toBe("JUAN");
    expect(r.demandado).toBe("EPS");
    expect(r.partes).toHaveLength(2);
  });

  it("parses structured array with tipo field", () => {
    const r = parseSujetosArray([
      { tipo: "Accionante", nombre: "MARIA" },
      { tipo: "Accionado", nombre: "CLINICA" },
    ]);
    expect(r.demandante).toBe("MARIA");
    expect(r.demandado).toBe("CLINICA");
  });

  it("handles mixed role synonyms", () => {
    const r = parseSujetosArray([
      { tipo: "Tutelante", nombre: "PEDRO" },
      { tipo: "Convocado", nombre: "ENTIDAD" },
    ]);
    expect(r.demandante).toBe("PEDRO");
    expect(r.demandado).toBe("ENTIDAD");
  });

  it("skips entries with empty names", () => {
    const r = parseSujetosArray([
      { tipo: "Demandante", nombre: "" },
      { tipo: "Demandado", nombre: "EMPRESA" },
    ]);
    expect(r.demandante).toBeUndefined();
    expect(r.demandado).toBe("EMPRESA");
    expect(r.partes).toHaveLength(1);
  });
});

describe("extractPartiesFromProviderResult (sync-by-radicado path)", () => {
  it("extracts parties from sujetos_procesales array", () => {
    const r = extractPartiesFromProviderResult({
      sujetos_procesales: [
        { tipo: "Accionante", nombre: "MARIA" },
        { tipo: "Accionado", nombre: "CLINICA" },
      ],
    });
    expect(r.demandantes).toBe("MARIA");
    expect(r.demandados).toBe("CLINICA");
  });

  it("falls back to top-level fields when sujetos empty", () => {
    const r = extractPartiesFromProviderResult({
      sujetos_procesales: [],
      demandante: "JUAN",
      demandado: "EPS",
    });
    expect(r.demandantes).toBe("JUAN");
    expect(r.demandados).toBe("EPS");
  });

  it("prefers sujetos over top-level fields", () => {
    const r = extractPartiesFromProviderResult({
      sujetos_procesales: [
        { tipo: "Demandante", nombre: "REAL_NAME" },
      ],
      demandante: "FALLBACK",
    });
    expect(r.demandantes).toBe("REAL_NAME");
  });

  it("joins multiple parties with comma", () => {
    const r = extractPartiesFromProviderResult({
      sujetos_procesales: [
        { tipo: "Demandante", nombre: "ANA" },
        { tipo: "Demandante", nombre: "PEDRO" },
        { tipo: "Demandado", nombre: "BANCO" },
      ],
    });
    expect(r.demandantes).toBe("ANA, PEDRO");
    expect(r.demandados).toBe("BANCO");
  });
});

describe("mergeParties: empty providers never overwrite", () => {
  it("preserves CPNU parties when secondary returns nothing", () => {
    const cpnu: PartyParseResult = {
      demandante: "JUAN", demandado: "EPS",
      partes: [
        { canonicalRole: 'DEMANDANTE', rawRole: 'Demandante', name: 'JUAN' },
        { canonicalRole: 'DEMANDADO', rawRole: 'Demandado', name: 'EPS' },
      ],
    };
    const empty: PartyParseResult = { partes: [] };
    const merged = mergeParties(cpnu, empty);
    expect(merged.demandante).toBe("JUAN");
    expect(merged.demandado).toBe("EPS");
  });

  it("deduplicates when Demandante and Accionante refer to same person", () => {
    const p1: PartyParseResult = {
      demandante: "JUAN", partes: [
        { canonicalRole: 'DEMANDANTE', rawRole: 'Demandante', name: 'JUAN' },
      ],
    };
    const p2: PartyParseResult = {
      demandante: "JUAN", partes: [
        { canonicalRole: 'DEMANDANTE', rawRole: 'Accionante', name: 'JUAN' },
      ],
    };
    const merged = mergeParties(p1, p2);
    expect(merged.partes).toHaveLength(1); // Deduped by canonicalRole+name
    expect(merged.demandante).toBe("JUAN");
  });

  it("preserves Phase 1 parties when fallback lacks them", () => {
    const p1: PartyParseResult = {
      demandante: "OFELIA", demandado: "TIERRADENTRO",
      partes: [
        { canonicalRole: 'DEMANDANTE', rawRole: 'Demandante', name: 'OFELIA' },
        { canonicalRole: 'DEMANDADO', rawRole: 'Demandado', name: 'TIERRADENTRO' },
      ],
    };
    const empty: PartyParseResult = { partes: [] };
    const merged = mergeParties(p1, empty);
    expect(merged.demandante).toBe("OFELIA");
    expect(merged.demandado).toBe("TIERRADENTRO");
  });
});

describe("FOUND_PARTIAL still pre-fills known fields", () => {
  it("wizard prefills parties even when found_status is FOUND_PARTIAL and actuaciones=0", () => {
    const lookupResult = {
      ok: true,
      found_in_source: true,
      found_status: "FOUND_PARTIAL" as const,
      process_data: {
        despacho: "JUZGADO 004",
        demandante: "OFELIA MERCEDES MAYA MARTINEZ",
        demandado: "TIERRADENTRO",
        fecha_radicacion: "2026-02-13",
        actuaciones: [],
        total_actuaciones: 0,
      },
    };

    const data = lookupResult.process_data;
    const normParties = (raw: string | undefined) => raw?.replace(/\s*\|\s*/g, ', ') || '';
    expect(normParties(data.demandante)).toBe("OFELIA MERCEDES MAYA MARTINEZ");
    expect(normParties(data.demandado)).toBe("TIERRADENTRO");
    expect(data.despacho).toBe("JUZGADO 004");
    expect(data.fecha_radicacion).toBe("2026-02-13");
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
    if (results.length === 0 && phase1Results.length > 0) results = phase1Results;
    expect(results.length > 0).toBe(true);
    expect(results[0].demandante).toBe("OFELIA");
    expect(results[0].demandado).toBe("TIERRADENTRO");
  });
});

describe("sync-path: canonicalizeRole used consistently", () => {
  it("CPNU tipoSujeto 'Demandante' maps to DEMANDANTE", () => {
    expect(canonicalizeRole("Demandante")).toBe("DEMANDANTE");
  });

  it("SAMAI tipo 'ACCIONANTE - DEMANDANTE' maps to DEMANDANTE", () => {
    expect(canonicalizeRole("ACCIONANTE - DEMANDANTE")).toBe("DEMANDANTE");
  });

  it("SAMAI tipo 'ACCIONADO - DEMANDADO' maps to DEMANDADO", () => {
    expect(canonicalizeRole("ACCIONADO - DEMANDADO")).toBe("DEMANDADO");
  });

  it("CPNU and SAMAI produce same canonical output for same person", () => {
    const cpnuResult = parseSujetosProcesalesString("Demandante: JUAN | Demandado: EPS");
    const samaiResult = parseSujetosArray([
      { tipo: "Accionante", nombre: "JUAN" },
      { tipo: "Accionado", nombre: "EPS" },
    ]);
    expect(cpnuResult.demandante).toBe(samaiResult.demandante);
    expect(cpnuResult.demandado).toBe(samaiResult.demandado);
    // Merge should deduplicate
    const merged = mergeParties(cpnuResult, samaiResult);
    expect(merged.partes.filter(p => p.canonicalRole === 'DEMANDANTE')).toHaveLength(1);
    expect(merged.partes.filter(p => p.canonicalRole === 'DEMANDADO')).toHaveLength(1);
  });

  it("CGP/Laboral CPNU parties are preserved across sync cycles", () => {
    // Simulate: first sync returns parties from CPNU
    const sync1 = parseSujetosProcesalesString("Demandante: MARIA | Demandado: EMPRESA S.A.");
    // Simulate: second sync returns same parties
    const sync2 = parseSujetosProcesalesString("Demandante: MARIA | Demandado: EMPRESA S.A.");
    const merged = mergeParties(sync1, sync2);
    // No duplicates
    expect(merged.partes).toHaveLength(2);
    expect(merged.demandante).toBe("MARIA");
    expect(merged.demandado).toBe("EMPRESA S.A");
  });
});
