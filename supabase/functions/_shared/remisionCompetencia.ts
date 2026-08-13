/**
 * remisionCompetencia.ts — ITERATION 57.
 *
 * The third continuity case, and the only one that breaks identity matching.
 *
 *   SEGUNDA_INSTANCIA        base-21 unchanged, instance digits 00 -> 01.
 *   EJECUTIVO_CONTINUACION   radicado unchanged (art. 306 CGP), same file.
 *   REMISION_COMPETENCIA     the receiving court assigns an ENTIRELY NEW
 *                            radicado: different despacho, different
 *                            especialidad, different consecutivo. No matcher
 *                            will ever connect the two, so the origin goes
 *                            silent forever while the real process advances
 *                            under a number nobody registered.
 *
 * Vertical vs horizontal. Both end the matter at the origin, but they are not
 * the same event and their successors differ in kind:
 *   · REMITIDO_AL_SUPERIOR — vertical, follows a granted appeal / consulta.
 *     The successor keeps the base-21 and changes the instance digits.
 *   · REMITIDO_POR_COMPETENCIA — horizontal, follows a competence ruling
 *     (CGP arts. 17 par., 25, 26, 28 / art. 139). The successor is a brand new
 *     radicado at another despacho.
 *
 * This module is the SINGLE place where remisión vocabulary is read. Nothing
 * downstream re-implements it: the app renders what this classifier persisted.
 */

export type RemisionClass =
  | "NO_REMISION"
  | "REMITIDO_AL_SUPERIOR"
  /**
   * The despacho rejects competence AND sends the file UP so the superior
   * settles a negative conflict (CGP art. 139). The file may come back: the
   * origin is not closed by remisión, it is suspended pending the ruling.
   */
  | "CONFLICTO_COMPETENCIA"
  | "REMITIDO_POR_COMPETENCIA";
/** A competence dispute escalated to the superior — direction up, outcome open. */
const CONFLICTO_PATTERNS: RegExp[] = [
  /\bconflicto (negativo|positivo)? ?de competencia\b/,
  /\bcompetencia negativa\b/,
  /\bdirimir (el )?conflicto\b/,
];


export interface RemisionVerdict {
  klass: RemisionClass;
  /** Spanish, user-facing. */
  reason: string;
  /** The literal fragment that decided it. */
  evidence: string | null;
}

function norm(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Horizontal: a competence ruling sends the file to a court of the same rank. */
const COMPETENCIA_PATTERNS: RegExp[] = [
  /\bno es competente\b/,
  /\bincompetente\b/,
  /\bincompetencia\b/,
  /\bfalta de competencia\b/,
  /\bconflicto (negativo |positivo )?de competencia\b/,
  /\bremit(e|ir|ase|ese|ido|ida)\b[^.]{0,80}\bpara su conocimiento\b/,
  /\bpone en conocimiento\s*-?\s*remite\b/,
  /\bremit(e|ir|ase|ese)\b[^.]{0,60}\bpor (falta de )?competencia\b/,
  /\bcompetencia (territorial|por el factor)\b/,
  /\bacuerdo cs[a-z]*\d/,
];

/** Vertical: the file goes up, and only because a recourse was granted. */
const SUPERIOR_PATTERNS: RegExp[] = [
  /\benv[ií]o a superior\b/,
  /\bremis[ií]on al superior\b/,
  /\bremite al (tribunal|superior)\b/,
  /\bal ta\b/,
  /\bconcede (el )?recurso de apelaci[oó]n\b[^.]{0,60}\bremit/,
  /\bgrado jurisdiccional de consulta\b/,
  /\bremite (el )?expediente al (tribunal|juzgado)? ?superior\b/,
];

/** Generic remisión, direction unknown on its own. */
const REMISION_GENERIC: RegExp[] = [
  /\bremis[ií]on (de )?expediente\b/,
  /\bremite (el )?expediente\b/,
  /\benv[ií]o a otros? despachos?\b/,
  /\benv[ií]a a otros? despachos?\b/,
];

function firstMatch(text: string, patterns: RegExp[]): string | null {
  const t = norm(text);
  for (const p of patterns) {
    const m = p.exec(t);
    if (m) return m[0];
  }
  return null;
}

/**
 * Classify a single piece of act / document text.
 *
 * Competence vocabulary WINS over the generic and over the vertical patterns:
 * an auto that declares incompetence and remits is horizontal even when it uses
 * the words "remite el expediente".
 */
export function classifyRemisionText(text: string | null | undefined): RemisionVerdict {
  if (!text || !norm(text).trim()) {
    return { klass: "NO_REMISION", reason: "Sin texto para clasificar.", evidence: null };
  }

  const comp = firstMatch(text, COMPETENCIA_PATTERNS);
  const conflicto = firstMatch(text, CONFLICTO_PATTERNS);
  if (conflicto) {
    return {
      klass: "CONFLICTO_COMPETENCIA",
      reason:
        "El despacho rechaza la competencia y envía el expediente al superior para que dirima el conflicto. El destino final aún no está decidido: el expediente puede regresar.",
      evidence: conflicto,
    };
  }
  if (comp) {
    return {
      klass: "REMITIDO_POR_COMPETENCIA",
      reason:
        "El auto declara la falta de competencia y ordena remitir el expediente a otro despacho del mismo rango. Es una remisión horizontal: el despacho receptor asigna un radicado enteramente nuevo.",
      evidence: comp,
    };
  }

  const sup = firstMatch(text, SUPERIOR_PATTERNS);
  if (sup) {
    return {
      klass: "REMITIDO_AL_SUPERIOR",
      reason:
        "El expediente sube al superior (apelación concedida o consulta). Es una remisión vertical: el radicado conserva su base y cambia el dígito de instancia.",
      evidence: sup,
    };
  }

  const gen = firstMatch(text, REMISION_GENERIC);
  if (gen) {
    return {
      klass: "REMITIDO_AL_SUPERIOR",
      reason:
        "Vocabulario de remisión sin mención de competencia: se lee como salida del expediente hacia el superior. Si el auto declara incompetencia, la clasificación cambia a remisión por competencia.",
      evidence: gen,
    };
  }

  return { klass: "NO_REMISION", reason: "Sin vocabulario de remisión.", evidence: null };
}

/**
 * Classify over a stream of act descriptions (and, optionally, a document body
 * held IN MEMORY — never persisted).
 */
export function classifyRemisionStream(
  texts: Array<string | null | undefined>,
): RemisionVerdict {
  let fallback: RemisionVerdict | null = null;
  for (const t of texts) {
    const v = classifyRemisionText(t);
    if (v.klass === "REMITIDO_POR_COMPETENCIA" || v.klass === "CONFLICTO_COMPETENCIA") return v;
    if (v.klass === "REMITIDO_AL_SUPERIOR" && !fallback) fallback = v;
  }
  return fallback ?? { klass: "NO_REMISION", reason: "Sin vocabulario de remisión.", evidence: null };
}

// ---------------------------------------------------------------------------
// Destination despacho
// ---------------------------------------------------------------------------

export type DestinoCodeStatus = "RESUELTO" | "NO_RESUELTO";

export interface DestinoDespacho {
  /** Verbatim name as the resolutive part writes it. */
  nombre: string | null;
  /** 12-digit despacho prefix (ciudad + entidad + especialidad + número). */
  codigo: string | null;
  codigo_status: DestinoCodeStatus;
  /** Why the code could not be derived, when it could not. */
  codigo_motivo: string | null;
}

/**
 * Entidad+especialidad (4 digits) by court name. Derived from the prefixes we
 * already hold in `despacho_coverage`, not guessed:
 *   050014189004  Juzgado 004 de Pequeñas Causas de Medellín      -> 4189
 *   050014003011  Juzgado 011 Civil Municipal de Medellín         -> 4003
 *   110013110013  Juzgado 013 de Familia de Bogotá                -> 3110
 */
const ESPECIALIDAD_BY_NAME: Array<{ re: RegExp; code: string; label: string }> = [
  { re: /peque[nñ]as causas/, code: "4189", label: "Pequeñas Causas y Competencia Múltiple" },
  { re: /civil municipal/, code: "4003", label: "Civil Municipal" },
  { re: /civil del circuito|civil circuito/, code: "3103", label: "Civil del Circuito" },
  { re: /familia/, code: "3110", label: "Familia" },
  { re: /laboral del circuito|laboral circuito/, code: "3105", label: "Laboral del Circuito" },
];

/** Cities we can map without guessing. Extended from the DANE table we hold. */
const DANE_BY_CITY: Record<string, string> = {
  medellin: "05001",
  bello: "05088",
  itagui: "05360",
  envigado: "05266",
  rionegro: "05615",
  bogota: "11001",
  "bogota d.c": "11001",
  cali: "76001",
  barranquilla: "08001",
  cartagena: "13001",
  bucaramanga: "68001",
};

const DESTINO_PATTERNS: RegExp[] = [
  /remitir(?:se)?\s+(?:la\s+presente\s+demanda|el\s+expediente|las?\s+diligencias|el\s+proceso)?\s*(?:al|a la|a)\s+(juzgado[^,.;]{3,140}?)\s+para su conocimiento/i,
  /remit(?:e|ase|ese|ir)\s+(?:al|a la|a)\s+(juzgado[^,.;]{3,140}?)(?:\s+para|[,.;])/i,
  /(?:al|a la)\s+(juzgado\s+\d{1,3}[^,.;]{3,140}?)(?:\s+para su conocimiento|[,.;])/i,
];

function cleanName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/["“”]/g, "")
    .trim()
    .replace(/\s+(de|del|para)$/i, "");
}

/**
 * Read the receiving court from the resolutive part.
 *
 * `bodyText` is the document body held IN MEMORY (same mechanism as the SGDE
 * and reparto reads). It is never persisted — only the extracted name and code
 * are stored.
 */
export function extractDestinoDespacho(
  actText: string | null | undefined,
  bodyText?: string | null,
): DestinoDespacho {
  const haystacks = [bodyText, actText].filter((t): t is string => !!t && t.trim() !== "");
  let nombre: string | null = null;
  for (const h of haystacks) {
    for (const p of DESTINO_PATTERNS) {
      const m = p.exec(h);
      if (m?.[1]) {
        nombre = cleanName(m[1]);
        break;
      }
    }
    if (nombre) break;
  }
  if (!nombre) {
    return {
      nombre: null,
      codigo: null,
      codigo_status: "NO_RESUELTO",
      codigo_motivo:
        "La parte resolutiva no nombra un despacho receptor en un patrón reconocible. Requiere lectura manual del auto.",
    };
  }
  return { nombre, ...resolveDespachoCodeFromName(nombre) };
}

/**
 * Derive the 12-digit despacho prefix from the court's name.
 *
 * Honest about its limits: the code is only returned when BOTH the city and the
 * especialidad map to values we already hold. Otherwise the name is stored and
 * the code is marked unresolved — never guessed.
 */
export function resolveDespachoCodeFromName(nombre: string): Omit<DestinoDespacho, "nombre"> {
  const n = norm(nombre);
  const numMatch = /juzgado\s+(?:(\d{1,3})|([a-z]+))\b/.exec(n);
  const numero = numMatch?.[1] ? numMatch[1].padStart(3, "0") : null;
  const esp = ESPECIALIDAD_BY_NAME.find((e) => e.re.test(n));
  const cityKey = Object.keys(DANE_BY_CITY).find((c) => n.includes(c));
  const dane = cityKey ? DANE_BY_CITY[cityKey] : null;

  const missing: string[] = [];
  if (!numero) missing.push("el número del juzgado");
  if (!esp) missing.push("la especialidad");
  if (!dane) missing.push("el municipio");
  if (missing.length > 0) {
    return {
      codigo: null,
      codigo_status: "NO_RESUELTO",
      codigo_motivo: `No se pudo derivar el código: falta ${missing.join(", ")} en el nombre «${nombre}».`,
    };
  }
  return {
    codigo: `${dane}${esp!.code}${numero}`,
    codigo_status: "RESUELTO",
    codigo_motivo: null,
  };
}

// ---------------------------------------------------------------------------
// Succession
// ---------------------------------------------------------------------------

export type SuccessionRelation =
  | "SEGUNDA_INSTANCIA"
  | "REMISION_COMPETENCIA"
  | "EJECUTIVO_CONTINUACION"
  | "CONFLICTO_COMPETENCIA";

export function relationForRemision(klass: RemisionClass): SuccessionRelation | null {
  if (klass === "REMITIDO_POR_COMPETENCIA") return "REMISION_COMPETENCIA";
  if (klass === "CONFLICTO_COMPETENCIA") return "CONFLICTO_COMPETENCIA";
  if (klass === "REMITIDO_AL_SUPERIOR") return "SEGUNDA_INSTANCIA";
  return null;
}

/**
 * Does this act open any term? A competence remission does not: CGP art. 139
 * states that no recourse proceeds against the auto that declares incompetence
 * and orders the remission. The term engine must never invent one from it.
 */
export function remisionOpensTerm(klass: RemisionClass): boolean {
  return false;
}