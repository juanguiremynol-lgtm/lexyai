/**
 * recursoStreams.ts — ITERATION 59.
 *
 * ONE WORK ITEM, TWO PROVIDER STREAMS.
 *
 * CPNU indexes by the 23-digit radicación. The last two digits are the
 * CONSECUTIVO DEL RECURSO ("00" the original file, "01" the first recurso,
 * "02" the second …). The 21-digit base is the PROCESS and never changes —
 * exactly the identity model ratified in iteration 4.2.
 *
 * Consequence: a granted appeal opens a NEW upstream key under the SAME
 * process. We subscribe to both keys, and both streams land in the SAME work
 * item, each fact tagged with the radicación it came from and its instancia.
 * We never create a second work item: that would split one process in two,
 * duplicate client and party role, fragment the term engine and break counts.
 *
 * The 21-digit base decomposition lives in `emailMatcher.ts` (iteration 4.2)
 * and is imported here — identity is computed in exactly one place.
 */

import { decomposeStoredRadicado } from "./emailMatcher.ts";

export type InstanciaGrado = "PRIMERA" | "SEGUNDA";

/**
 * ITER60 — GCP's probe is now ADAPTIVE and walks consecutivos up to "09"
 * (legacy "03" instances exist in the wild). We mirror that cap exactly so a
 * subscription key we ask for is always a key the provider can resolve.
 */
export const PROBED_RECURSO_SUFFIXES = [
  "00", "01", "02", "03", "04", "05", "06", "07", "08", "09",
] as const;

/** 21-digit process identity, or null when the input is not a radicado. */
export function radicadoBase21(raw: string | null | undefined): string | null {
  return decomposeStoredRadicado(raw)?.base ?? null;
}

/** Consecutivo del recurso ("00" | "01" | …), or null when not expressed. */
export function recursoConsecutivo(raw: string | null | undefined): string | null {
  return decomposeStoredRadicado(raw)?.instance ?? null;
}

/** "00"/absent → PRIMERA; anything else → SEGUNDA (recurso ante el superior). */
export function instanciaGradoForConsecutivo(
  consecutivo: string | null | undefined,
): InstanciaGrado {
  return !consecutivo || consecutivo === "00" ? "PRIMERA" : "SEGUNDA";
}

export function instanciaGradoForRadicado(raw: string | null | undefined): InstanciaGrado {
  return instanciaGradoForConsecutivo(recursoConsecutivo(raw));
}

/** Two radicaciones belong to the same process when their base-21 matches. */
export function sameProcess(a: string | null | undefined, b: string | null | undefined): boolean {
  const ba = radicadoBase21(a);
  const bb = radicadoBase21(b);
  return !!ba && ba === bb;
}

/** The 23-digit keys we ask the provider to subscribe for one process. */
export function recursoSubscriptionKeys(radicado: string | null | undefined): string[] {
  const base = radicadoBase21(radicado);
  if (!base) return [];
  return PROBED_RECURSO_SUFFIXES.map((s) => `${base}${s}`);
}

// ───────────────────────── provider linkage contract ─────────────────────────

/**
 * ITEM 3 — the field shape we ask GCP to emit, per stream AND per act, so the
 * merge is explicit and never inferred:
 *
 *   {
 *     "radicacion":          "05001400302820260052101",  // 23-digit upstream key
 *     "radicacion_base":     "050014003028202600521",    // 21-digit process identity
 *     "consecutivo_recurso": "01",
 *     "instancia":           "SEGUNDA",                  // PRIMERA | SEGUNDA
 *     "despacho":            "Juzgado 009 Civil del Circuito de Medellín",
 *     "id_proceso":          "3284580221",
 *     "radicacion_origen":   "05001400302820260052100"   // key the recurso descends from
 *   }
 *
 * `radicacion_base` is REQUIRED: it is the merge key. When it is present and
 * contradicts the 23-digit key we reject the linkage instead of guessing.
 */
export interface ProviderRadicadoLinkage {
  radicacion: string | null;
  base21: string | null;
  consecutivo: string | null;
  instancia: InstanciaGrado;
  despacho: string | null;
  id_proceso: string | null;
  radicacion_origen: string | null;
  /** true when provider-declared base and the 23-digit key disagree. */
  conflict: boolean;
}

// ITER60 — GCP now emits four EXPLICIT fields on every act:
//   radicado_23, radicado_base_21, instancia (the 2-digit consecutivo), despacho.
// `radicado_base_21` is a generated column upstream, so it is the field we
// trust first; nothing here slices a substring when it is present.
const RADICACION_FIELDS = [
  "radicado_23", "radicacion_23",
  "radicacion", "radicado", "numero_radicacion", "llaveProceso", "llave_proceso",
];
const BASE_FIELDS = [
  "radicado_base_21", "radicacion_base_21",
  "radicacion_base", "radicacionBase", "base21", "radicado_base",
];
// ITER60 — `instancia` upstream is the CONSECUTIVO ("00"/"01"/"02"), NOT a
// procedural grade. Before this contract it was an alias of `tipo_categoria`
// ("judicial"), which is why it is read last and only when it is 1–2 digits.
const CONSECUTIVO_FIELDS = ["consecutivo_recurso", "consecutivoRecurso", "consecutivo", "instancia"];
const INSTANCIA_FIELDS = ["instancia", "instancia_grado", "instanciaGrado"];
const DESPACHO_FIELDS = ["despacho", "nombre_despacho", "despacho_nombre"];
const ID_PROCESO_FIELDS = ["id_proceso", "idProceso"];
const ORIGEN_FIELDS = ["radicacion_origen", "radicacionOrigen", "origen_radicacion"];

function pick(raw: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    const v = raw[f];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function digits(s: string | null): string | null {
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d || null;
}

function normalizeInstancia(raw: string | null): InstanciaGrado | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  // "01"/"02" are NEVER read as a grade: upstream uses them as consecutivos,
  // where "01" means SEGUNDA instancia — the exact inversion we must not make.
  if (s.startsWith("PRIMERA") || s === "1" || s === "UNICA" || s === "ÚNICA") return "PRIMERA";
  if (s.startsWith("SEGUNDA") || s === "2") return "SEGUNDA";
  return null;
}

/**
 * Resolve the linkage of one provider payload (stream envelope or act unit).
 * Falls back to decomposition of the 23-digit key when GCP has not yet shipped
 * the explicit fields, so we work with both contract versions.
 */
export function resolveProviderLinkage(
  raw: Record<string, unknown> | null | undefined,
  fallbackRadicado?: string | null,
): ProviderRadicadoLinkage {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const radicacion = digits(pick(src, RADICACION_FIELDS)) ?? digits(fallbackRadicado ?? null);
  const declaredBase = digits(pick(src, BASE_FIELDS));
  const derivedBase = radicadoBase21(radicacion);
  const conflict = !!declaredBase && !!derivedBase && declaredBase !== derivedBase;
  const base21 = conflict ? null : (declaredBase ?? derivedBase);

  const declaredConsec = pick(src, CONSECUTIVO_FIELDS);
  const consecutivo = declaredConsec && /^\d{1,2}$/.test(declaredConsec)
    ? declaredConsec.padStart(2, "0")
    : recursoConsecutivo(radicacion);

  // The consecutivo is authoritative for the grade; a textual `instancia`
  // ("Segunda") is only consulted when no consecutivo could be resolved.
  const instancia = consecutivo !== null
    ? instanciaGradoForConsecutivo(consecutivo)
    : (normalizeInstancia(pick(src, INSTANCIA_FIELDS)) ?? "PRIMERA");

  return {
    radicacion,
    base21,
    consecutivo,
    instancia,
    despacho: pick(src, DESPACHO_FIELDS),
    id_proceso: pick(src, ID_PROCESO_FIELDS),
    radicacion_origen: digits(pick(src, ORIGEN_FIELDS)),
    conflict,
  };
}
