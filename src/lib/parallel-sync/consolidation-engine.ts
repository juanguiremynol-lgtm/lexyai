/**
 * Consolidation Engine for Multi-Source Parallel Sync
 * 
 * Intelligently merges actuaciones from multiple judicial API sources,
 * deduplicating and selecting the best version of each record.
 */

// ============= TYPES =============

export interface RawActuacion {
  fecha?: string;
  actuacion?: string;
  anotacion?: string;
  fecha_inicia_termino?: string;
  fecha_finaliza_termino?: string;
  fecha_registro?: string;
  estado?: string;
  anexos?: number;
  indice?: string;
  nombre_despacho?: string;
  documentos?: Array<{ nombre: string; url: string }>;
}

export interface ProviderResult {
  provider: string;
  status: 'success' | 'error' | 'empty' | 'timeout' | 'not_found';
  actuaciones: RawActuacion[];
  latencyMs: number;
  error?: string;
  httpStatus?: number;
}

export interface NormalizedActuacion {
  // Identity fields (for matching)
  normalized_date: string | null;
  normalized_type: string;
  normalized_description: string;

  // Original data
  original: {
    provider: string;
    raw_data: RawActuacion;
    act_date: string | null;
    description: string;
    annotation: string | null;
  };

  // Computed
  similarity_key: string;
  completeness_score: number;
}

export interface ConsolidatedActuacion {
  // Best version of each field
  act_date: string | null;
  description: string;
  annotation: string | null;
  act_date_raw: string | null;

  // Multi-source tracking
  sources: string[];
  primary_source: string;

  // Metadata
  date_source: 'api_explicit' | 'parsed_annotation' | 'parsed_title' | 'api_metadata' | 'inferred_sync';
  date_confidence: 'high' | 'medium' | 'low';
  completeness_score: number;

  // Raw data from each source (for debugging)
  source_data: Record<string, RawActuacion>;

  // For fingerprinting
  indice: string | null;
}

export interface ConsolidationResult {
  consolidated: ConsolidatedActuacion[];
  stats: {
    totalFromSources: number;
    afterDedup: number;
    duplicatesRemoved: number;
    multiSourceCount: number; // How many have 2+ sources
  };
}

// ============= NORMALIZATION =============

/**
 * Map actuación type variations to standard types
 */
const ACTUACION_TYPE_MAP: Record<string, string[]> = {
  auto_admite: ['auto admite', 'admite demanda', 'auto admisorio'],
  auto_inadmite: ['auto inadmite', 'inadmite demanda'],
  auto_requiere: ['auto requiere', 'requiere', 'requerimiento'],
  sentencia: ['sentencia', 'fallo'],
  fijacion_estado: ['fijacion estado', 'fijación estado', 'estado'],
  recepcion_memorial: ['recepcion memorial', 'recepción memorial', 'memorial'],
  audiencia: ['audiencia', 'diligencia'],
  notificacion: ['notificacion', 'notificación', 'notifica'],
  medida_cautelar: ['medida cautelar', 'cautelar'],
  radicacion: ['radicacion', 'radicación', 'reparto'],
  traslado: ['traslado', 'corre traslado'],
  ejecutoria: ['ejecutoria', 'en firme', 'ejecutoriada'],
};

function normalizeActuacionType(description: string): string {
  if (!description) return 'unknown';

  const lower = description.toLowerCase();

  for (const [standard, variations] of Object.entries(ACTUACION_TYPE_MAP)) {
    if (variations.some(v => lower.includes(v))) {
      return standard;
    }
  }

  return 'other';
}

/**
 * Parse Colombian date format to ISO
 */
function parseAndFormatDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;

  // If already ISO format, return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const patterns = [
    /^(\d{2})\/(\d{2})\/(\d{4})/,
    /^(\d{2})-(\d{2})-(\d{4})/,
  ];

  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month}-${day}`;
    }
  }

  return null;
}

/**
 * Normalize a single actuación for deduplication
 */
export function normalizeActuacion(
  act: RawActuacion,
  provider: string
): NormalizedActuacion {
  const date = act.fecha || '';
  const description = act.actuacion || '';
  const annotation = act.anotacion || '';

  // Normalize the date
  const normalizedDate = parseAndFormatDate(date);

  // Normalize the type
  const normalizedType = normalizeActuacionType(description);

  // Create clean description for matching
  const cleanDescription = description
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/\s+/g, ' ')
    .trim();

  // Create similarity key for dedup
  const descPrefix = cleanDescription.replace(/[^a-z0-9]/g, '').slice(0, 20);
  const similarityKey = `${normalizedDate || 'nodate'}|${normalizedType}|${descPrefix}`;

  // Calculate completeness score
  let completeness = 0;
  if (date) completeness += 30;
  if (description) completeness += 20;
  if (annotation && annotation.length > 10) completeness += 20;
  if (act.fecha_inicia_termino) completeness += 10;
  if (act.fecha_finaliza_termino) completeness += 10;
  if (act.documentos && act.documentos.length > 0) completeness += 10;

  return {
    normalized_date: normalizedDate,
    normalized_type: normalizedType,
    normalized_description: cleanDescription,
    original: {
      provider,
      raw_data: act,
      act_date: normalizedDate,
      description,
      annotation: annotation || null,
    },
    similarity_key: similarityKey,
    completeness_score: completeness,
  };
}

// ============= CONSOLIDATION =============

/**
 * Consolidate actuaciones from multiple sources
 * 
 * Process:
 * 1. Normalize all actuaciones
 * 2. Group by similarity key
 * 3. For each group, pick the best version and track all sources
 */
export function consolidateActuaciones(
  results: ProviderResult[]
): ConsolidationResult {
  // Step 1: Normalize all actuaciones from all sources
  const normalized: NormalizedActuacion[] = [];

  for (const result of results) {
    if (result.status === 'success' || result.status === 'empty') {
      for (const act of result.actuaciones) {
        normalized.push(normalizeActuacion(act, result.provider));
      }
    }
  }

  const totalFromSources = normalized.length;
  console.log(`[consolidate] Total actuaciones from all sources: ${totalFromSources}`);

  // Step 2: Group by similarity key
  const groups = new Map<string, NormalizedActuacion[]>();

  for (const act of normalized) {
    const existing = groups.get(act.similarity_key) || [];
    existing.push(act);
    groups.set(act.similarity_key, existing);
  }

  console.log(`[consolidate] Unique actuaciones after grouping: ${groups.size}`);

  // Step 3: For each group, pick the best version and merge metadata
  const consolidated: ConsolidatedActuacion[] = [];
  let multiSourceCount = 0;

  for (const [_key, group] of groups) {
    // Sort by completeness score (highest first)
    group.sort((a, b) => b.completeness_score - a.completeness_score);

    const best = group[0];
    const allSources = [...new Set(group.map(g => g.original.provider))];

    if (allSources.length > 1) {
      multiSourceCount++;
    }

    // Merge annotations: take the longest/most detailed one
    let mergedAnnotation = best.original.annotation;
    for (const alt of group.slice(1)) {
      if (
        alt.original.annotation &&
        alt.original.annotation.length > (mergedAnnotation?.length || 0)
      ) {
        mergedAnnotation = alt.original.annotation;
      }
    }

    // Determine date confidence based on source agreement
    let dateConfidence: 'high' | 'medium' | 'low' = 'low';
    let dateSource: ConsolidatedActuacion['date_source'] = 'inferred_sync';

    const datesFromSources = group
      .map(g => g.normalized_date)
      .filter((d): d is string => d !== null);

    if (datesFromSources.length > 0) {
      const allSameDate = datesFromSources.every(d => d === datesFromSources[0]);
      if (allSameDate && allSources.length >= 2) {
        dateConfidence = 'high'; // Multiple sources agree!
        dateSource = 'api_explicit';
      } else if (allSameDate) {
        dateConfidence = 'medium';
        dateSource = 'api_explicit';
      } else {
        dateConfidence = 'medium'; // Sources disagree, using best one
        dateSource = 'api_explicit';
        console.log(
          `[consolidate] Date disagreement: ${datesFromSources.join(', ')}`
        );
      }
    }

    // Collect raw data from all sources
    const sourceData: Record<string, RawActuacion> = {};
    for (const g of group) {
      sourceData[g.original.provider] = g.original.raw_data;
    }

    consolidated.push({
      act_date: best.normalized_date,
      description: best.original.description,
      annotation: mergedAnnotation,
      act_date_raw: best.original.raw_data.fecha || null,

      sources: allSources,
      primary_source: best.original.provider,

      date_source: dateSource,
      date_confidence: dateConfidence,
      completeness_score: best.completeness_score,

      source_data: sourceData,
      indice: best.original.raw_data.indice || null,
    });
  }

  console.log(`[consolidate] Final consolidated count: ${consolidated.length}`);
  console.log(`[consolidate] Multi-source confirmed: ${multiSourceCount}`);

  return {
    consolidated,
    stats: {
      totalFromSources,
      afterDedup: consolidated.length,
      duplicatesRemoved: totalFromSources - consolidated.length,
      multiSourceCount,
    },
  };
}

/**
 * Generate a source-independent fingerprint for deduplication
 */
export function generateMultiSourceFingerprint(
  workItemId: string,
  date: string | null,
  type: string,
  description: string,
  indice: string | null
): string {
  // Include indice to prevent collisions for same-day actuaciones
  const indexPart = indice ? `|${indice}` : '';
  const input = `${workItemId}|${date || 'nodate'}|${type}|${description
    .slice(0, 50)
    .toLowerCase()}${indexPart}`;

  // Simple hash
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  return `ms_${workItemId.slice(0, 8)}_${Math.abs(hash)
    .toString(16)
    .padStart(8, '0')}`;
}
