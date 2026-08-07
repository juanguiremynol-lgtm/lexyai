/**
 * claseProcesoContract.ts — ITERATION 29.
 *
 * SINGLE SOURCE OF TRUTH for the GCP `claseProveedor` contract.
 *
 * Doctrine: the class of a process is a PROVIDER FACT. It is copied verbatim
 * or it is absent — it is never synthesised, inferred from the despacho name,
 * nor derived from the local `clasificacionLocal` block (whose `categoria`
 * values `judicial` / `otro` are a transport classification, NOT a clase de
 * proceso; those were the residue purged in this iteration).
 */

export interface ClaseProcesoProcedencia {
  endpoint?: string | null;
  id_proceso?: number | string | null;
  campos?: Record<string, string> | null;
  error?: string | null;
  cod_despacho_completo?: string | null;
  provider_observed_at?: string | null;
  provider_fecha_consulta?: string | null;
  provider_ultima_actualizacion?: string | null;
  [k: string]: unknown;
}

export interface ClaseProcesoContract {
  /** Provider-stated availability. False whenever the block is absent. */
  disponible: boolean;
  /** Provider-stated reason. Never invented beyond the two sentinels below. */
  motivo_ausencia: string | null;
  clase_proceso: string | null;
  subclase_proceso: string | null;
  tipo_proceso: string | null;
  naturaleza_proceso: string | null;
  ponente: string | null;
  recurso: string | null;
  clase_proceso_raw: string | null;
  subclase_proceso_raw: string | null;
  tipo_proceso_raw: string | null;
  clases_en_otros_procesos: unknown | null;
  procedencia: ClaseProcesoProcedencia | null;
  /** The verbatim block as received, for persistence in work_items.clase_proveedor. */
  raw: Record<string, unknown> | null;
}

/** Contract block missing entirely (degraded provider response). */
export const MOTIVO_BLOQUE_AUSENTE = 'CONTRACT_BLOCK_ABSENT';
/** Block present but the provider could not reach /Proceso/Detalle. */
export const MOTIVO_NO_DISPONIBLE = 'PROVIDER_UNAVAILABLE';

export const CLASE_PROCESO_UNAVAILABLE: ClaseProcesoContract = {
  disponible: false,
  motivo_ausencia: MOTIVO_BLOQUE_AUSENTE,
  clase_proceso: null,
  subclase_proceso: null,
  tipo_proceso: null,
  naturaleza_proceso: null,
  ponente: null,
  recurso: null,
  clase_proceso_raw: null,
  subclase_proceso_raw: null,
  tipo_proceso_raw: null,
  clases_en_otros_procesos: null,
  procedencia: null,
  raw: null,
};

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Parse the provider's `claseProveedor` block verbatim.
 * Returns an explicit "unavailable" contract when the block is absent —
 * absence is a fact we record, never a value we guess.
 */
export function parseClaseProveedor(payload: unknown): ClaseProcesoContract {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ...CLASE_PROCESO_UNAVAILABLE };
  }
  const b = payload as Record<string, unknown>;
  const disponible = b.disponible === true;
  const procedencia = (b.procedencia && typeof b.procedencia === 'object' && !Array.isArray(b.procedencia))
    ? (b.procedencia as ClaseProcesoProcedencia)
    : null;

  return {
    disponible,
    motivo_ausencia: disponible ? null : (str(b.motivo_ausencia) ?? MOTIVO_NO_DISPONIBLE),
    clase_proceso: str(b.clase_proceso),
    subclase_proceso: str(b.subclase_proceso),
    tipo_proceso: str(b.tipo_proceso),
    naturaleza_proceso: str(b.naturaleza_proceso),
    ponente: str(b.ponente),
    recurso: str(b.recurso),
    clase_proceso_raw: str(b.clase_proceso_raw),
    subclase_proceso_raw: str(b.subclase_proceso_raw),
    tipo_proceso_raw: str(b.tipo_proceso_raw),
    clases_en_otros_procesos: b.clases_en_otros_procesos ?? null,
    procedencia,
    raw: b,
  };
}

/**
 * Locate the contract block anywhere the provider may place it, in the order
 * the contract documents: root → ficha → first proceso.
 */
export function extractClaseProveedor(response: unknown): ClaseProcesoContract {
  if (!response || typeof response !== 'object') return { ...CLASE_PROCESO_UNAVAILABLE };
  const r = response as Record<string, unknown>;
  const nested = (r.data && typeof r.data === 'object' ? r.data as Record<string, unknown> : null);
  const ficha = ((nested?.ficha ?? r.ficha) as Record<string, unknown> | undefined) ?? undefined;
  const procesos = ((nested?.procesos ?? r.procesos) as Record<string, unknown>[] | undefined) ?? undefined;

  const candidates: unknown[] = [
    nested?.claseProveedor,
    r.claseProveedor,
    ficha?.claseProveedor,
    procesos?.[0]?.claseProveedor,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'object') return parseClaseProveedor(c);
  }
  return { ...CLASE_PROCESO_UNAVAILABLE };
}

/** True when the juridical class identity changed between two observations. */
/**
 * ITER42 — accept either a raw provider block or an already-parsed contract
 * (adapters forward the parsed shape). Re-parsing a parsed contract would nest
 * `raw` inside itself; this keeps the verbatim block verbatim.
 */
export function coerceClaseContract(value: unknown): ClaseProcesoContract {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if ('raw' in v && 'disponible' in v && 'motivo_ausencia' in v) {
      return value as ClaseProcesoContract;
    }
  }
  return parseClaseProveedor(value);
}

export function claseProcesoChanged(
  prev: { clase_proceso?: string | null; subclase_proceso?: string | null },
  next: ClaseProcesoContract,
): boolean {
  if (!next.disponible) return false; // absence never erases a known class
  const norm = (v?: string | null) => (v ?? '').trim().toLowerCase();
  return norm(prev.clase_proceso) !== norm(next.clase_proceso)
    || norm(prev.subclase_proceso) !== norm(next.subclase_proceso);
}
