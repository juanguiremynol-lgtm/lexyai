/**
 * partyNormalization.ts — Canonical party parsing and normalization layer.
 *
 * Single source of truth for extracting parties from CPNU, SAMAI, and other
 * Colombian judicial provider responses. Used by:
 *   - adapter-cpnu (wizard + sync)
 *   - sync-by-radicado (wizard lookup orchestrator)
 *   - sync-by-work-item (cron/daily sync)
 *
 * Canonical roles:
 *   DEMANDANTE ≈ Accionante ≈ Actor ≈ Tutelante ≈ Solicitante ≈ Convocante
 *   DEMANDADO  ≈ Accionado  ≈ Convocado ≈ Procesado
 *
 * Outputs both:
 *   - Primary fields: demandante, demandado (first match per canonical role)
 *   - Full party list: partes[] with { canonicalRole, rawRole, name }
 */

// ─────────────── Types ───────────────

export interface ParsedParty {
  /** Canonical role: 'DEMANDANTE' or 'DEMANDADO' or 'PARTE' */
  canonicalRole: 'DEMANDANTE' | 'DEMANDADO' | 'PARTE';
  /** Original role label as-is from the provider */
  rawRole: string;
  /** Party name, trimmed and trailing-punctuation-stripped */
  name: string;
}

export interface PartyParseResult {
  /** First demandante/accionante/etc. found */
  demandante?: string;
  /** First demandado/accionado/etc. found */
  demandado?: string;
  /** Full party list with canonical roles */
  partes: ParsedParty[];
}

// ─────────────── Constants ───────────────

/** Regex for role-prefixed entries like "Demandante: NOMBRE" */
const ROLE_RE =
  /^(Demandante|Demandado|Accionante|Accionado|Actor|Tutelante|Solicitante|Convocado|Convocante|Procesado|Ofendido)\s*:\s*(.+)$/i;

/** Role labels that map to canonical DEMANDANTE */
const DEMANDANTE_RE = /demandante|accionante|actor|tutelante|solicitante|convocante|ofendido/i;

/** Role labels that map to canonical DEMANDADO */
const DEMANDADO_RE = /demandado|accionado|convocado|procesado/i;

// ─────────────── Core Functions ───────────────

/**
 * Canonicalize a role label into DEMANDANTE, DEMANDADO, or PARTE.
 */
export function canonicalizeRole(rawRole: string): 'DEMANDANTE' | 'DEMANDADO' | 'PARTE' {
  if (DEMANDANTE_RE.test(rawRole)) return 'DEMANDANTE';
  if (DEMANDADO_RE.test(rawRole)) return 'DEMANDADO';
  return 'PARTE';
}

/**
 * Clean a party name: trim whitespace, strip trailing periods.
 */
function cleanName(name: string): string {
  return name.trim().replace(/\.+$/, '').trim();
}

/**
 * Parse a sujetosProcesales string (pipe/semicolon/slash/newline/double-space separated).
 *
 * Handles:
 *   - "Demandante: NOMBRE | Demandado: NOMBRE"
 *   - "Accionante: NOMBRE; Accionado: NOMBRE"
 *   - "NOMBRE1 | NOMBRE2" (no role prefix → PARTE)
 *   - Multiple parties per role
 *   - Case-insensitive role labels
 *   - Trailing punctuation stripping
 */
export function parseSujetosProcesalesString(rawStr: string): PartyParseResult {
  const trimmed = rawStr.trim();
  if (!trimmed) return { partes: [] };

  // Split by known delimiters, or fall back to double-spaces
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
      const canonicalRole = canonicalizeRole(rawRole);
      partes.push({ canonicalRole, rawRole, name });
      if (canonicalRole === 'DEMANDANTE' && !demandante) demandante = name;
      if (canonicalRole === 'DEMANDADO' && !demandado) demandado = name;
    } else {
      partes.push({ canonicalRole: 'PARTE', rawRole: 'Parte', name: raw });
    }
  }

  return { demandante, demandado, partes };
}

/**
 * Parse a structured sujetos array (from CPNU detail endpoint or SAMAI).
 *
 * Expects objects with { tipoParte|tipo, nombre } fields.
 */
export function parseSujetosArray(
  sujetos: Array<{ tipoParte?: string; tipo?: string; nombre?: string }>
): PartyParseResult {
  const partes: ParsedParty[] = [];
  let demandante: string | undefined;
  let demandado: string | undefined;

  for (const s of sujetos) {
    const rawRole = (s.tipoParte || s.tipo || 'Parte').trim();
    const name = cleanName(s.nombre || '');
    if (!name) continue;

    const canonicalRole = canonicalizeRole(rawRole);
    partes.push({ canonicalRole, rawRole, name });
    if (canonicalRole === 'DEMANDANTE' && !demandante) demandante = name;
    if (canonicalRole === 'DEMANDADO' && !demandado) demandado = name;
  }

  return { demandante, demandado, partes };
}

/**
 * Parse CPNU sujetosProcesales in any format (string or array).
 *
 * This is the primary entry point for adapter-cpnu.
 */
export function parseCpnuSujetos(
  sujetosProcesales: unknown
): PartyParseResult {
  if (Array.isArray(sujetosProcesales)) {
    return parseSujetosArray(sujetosProcesales);
  }
  if (typeof sujetosProcesales === 'string' && sujetosProcesales.trim()) {
    return parseSujetosProcesalesString(sujetosProcesales);
  }
  return { partes: [] };
}

// ─────────────── Merge Utilities ───────────────

/**
 * Merge party data: never let empty values overwrite non-empty ones.
 *
 * Usage in sync orchestrators:
 *   const merged = mergeParties(cpnuParties, samaiParties);
 *   // merged.demandante is from whichever had a value (first wins)
 */
export function mergeParties(
  primary: PartyParseResult,
  secondary: PartyParseResult
): PartyParseResult {
  const demandante = primary.demandante || secondary.demandante;
  const demandado = primary.demandado || secondary.demandado;

  // Merge partes lists, dedup by canonical role + normalized name
  const seen = new Set<string>();
  const merged: ParsedParty[] = [];

  for (const p of [...primary.partes, ...secondary.partes]) {
    const key = `${p.canonicalRole}|${p.name.toUpperCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(p);
    }
  }

  return { demandante, demandado, partes: merged };
}

/**
 * Convert a PartyParseResult to the legacy sujetos format used by adapter-cpnu responses.
 */
export function toSujetosArray(result: PartyParseResult): Array<{ tipo: string; nombre: string }> {
  return result.partes.map(p => ({ tipo: p.rawRole, nombre: p.name }));
}

/**
 * Extract parties from a provider result's sujetos_procesales + fallback fields.
 *
 * This is the canonical extraction used by sync-by-radicado when processing
 * CPNU results. It handles both structured arrays and the string format.
 */
export function extractPartiesFromProviderResult(result: {
  sujetos_procesales?: Array<{ tipo: string; nombre: string }>;
  demandante?: string;
  demandado?: string;
}): { demandantes: string; demandados: string } {
  let demandantes = '';
  let demandados = '';

  if (result.sujetos_procesales?.length) {
    const parsed = parseSujetosArray(
      result.sujetos_procesales.map(s => ({ tipo: s.tipo, nombre: s.nombre }))
    );

    const dList = parsed.partes
      .filter(p => p.canonicalRole === 'DEMANDANTE')
      .map(p => p.name);
    const aList = parsed.partes
      .filter(p => p.canonicalRole === 'DEMANDADO')
      .map(p => p.name);

    if (dList.length) demandantes = dList.join(', ');
    if (aList.length) demandados = aList.join(', ');
  }

  // Fallback to top-level fields
  if (!demandantes && result.demandante) demandantes = result.demandante;
  if (!demandados && result.demandado) demandados = result.demandado;

  return { demandantes, demandados };
}
