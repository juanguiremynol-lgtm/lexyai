/**
 * mappingEngine.ts — Schema-tolerant mapping engine for external provider payloads.
 *
 * Transforms arbitrary provider JSON into canonical ATENIA records (acts/pubs)
 * using a deterministic, allowlisted-transform-only mapping spec.
 * Unknown/unmapped fields are preserved in extras rather than discarded.
 */

// ---- Allowlisted transforms (no arbitrary code execution) ----

type TransformFn = (val: unknown) => unknown;

const TRANSFORMS: Record<string, TransformFn> = {
  STRING: (v) => (v == null ? "" : String(v)),
  TRIM: (v) => (v == null ? "" : String(v).trim()),
  NUMBER: (v) => (v == null ? null : Number(v)),
  BOOLEAN: (v) => !!v,
  DATE_ISO: (v) => {
    if (!v) return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  },
  DATE_CO: (v) => {
    // Colombian date formats: DD/MM/YYYY or DD-MM-YYYY
    if (!v) return null;
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      const d = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    // Fallback to ISO parse
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  },
  DATE_DDMMYYYY_CO: (v) => {
    // Explicit DD/MM/YYYY Colombian format → ISO date string
    if (!v) return null;
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      const d = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    return null; // Strict: only DD/MM/YYYY accepted
  },
  DATETIME_ISO: (v) => {
    if (!v) return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d.toISOString();
  },
  NORMALIZE_TYPE: (v) => {
    if (!v) return "UNKNOWN";
    return String(v).trim().toUpperCase().replace(/\s+/g, "_");
  },
  IDENTITY: (v) => v,
};

// ---- JSON path resolution (simple $.dot.notation + $.array[*]) ----

function resolvePath(obj: unknown, path: string): unknown {
  if (!path || !path.startsWith("$")) return undefined;
  const parts = path.slice(2).split(".").filter(Boolean); // remove "$."
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveArrayPath(obj: unknown, path: string): unknown[] {
  const val = resolvePath(obj, path);
  if (Array.isArray(val)) return val;
  if (val != null) return [val];
  return [];
}

// ---- Types ----

export interface FieldMapping {
  path: string;
  transform: string;
  required?: boolean;
}

export interface ScopeMappingSpec {
  array_path: string;
  fields: Record<string, FieldMapping>;
  extras_mode?: "STORE_UNMAPPED" | "DISCARD";
}

export interface MappingSpec {
  acts?: ScopeMappingSpec;
  pubs?: ScopeMappingSpec;
}

export interface MappingWarning {
  level: "WARN" | "BLOCK";
  field: string;
  message: string;
}

export interface MappedRecord {
  [key: string]: unknown;
}

export interface MappingResult {
  canonicalActs: MappedRecord[];
  canonicalPubs: MappedRecord[];
  extrasByKey: Record<string, Record<string, unknown>>; // keyed by dedupe key
  mappingWarnings: MappingWarning[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// ---- Canonical schema definition ----

const CANONICAL_ACTS_REQUIRED = ["event_date", "description"];
const CANONICAL_ACTS_KNOWN = new Set([
  "event_date", "event_time", "event_type", "description", "event_summary",
  "source_platform", "scrape_date", "hash_fingerprint", "raw_data",
  "provider_event_id", "provider_case_id", "indice",
]);

const CANONICAL_PUBS_REQUIRED = ["pub_date", "description"];
const CANONICAL_PUBS_KNOWN = new Set([
  "pub_date", "description", "event_summary", "source_platform",
  "scrape_date", "hash_fingerprint", "raw_data",
  "provider_event_id", "provider_case_id",
]);

// ---- Core functions ----

/**
 * Validate that a snapshot payload conforms to expected contract.
 */
export function validateSnapshotAgainstContract(
  payload: unknown,
  _schemaVersion: string,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (payload == null) {
    errors.push("Payload is null or undefined");
    return { ok: false, errors, warnings };
  }

  if (typeof payload !== "object") {
    errors.push("Payload is not an object");
    return { ok: false, errors, warnings };
  }

  const p = payload as Record<string, unknown>;

  // Check for acts array
  if (p.actuaciones != null && !Array.isArray(p.actuaciones)) {
    warnings.push("actuaciones field exists but is not an array");
  }

  // Check for pubs array
  if (p.publicaciones != null && !Array.isArray(p.publicaciones)) {
    warnings.push("publicaciones field exists but is not an array");
  }

  if (!p.actuaciones && !p.publicaciones) {
    warnings.push("No actuaciones or publicaciones arrays found; check provider contract");
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Apply a mapping spec to a raw provider payload.
 * Returns canonical records + extras for unmapped fields.
 */
export function applyMappingSpec(
  payload: unknown,
  spec: MappingSpec,
): MappingResult {
  const canonicalActs: MappedRecord[] = [];
  const canonicalPubs: MappedRecord[] = [];
  const extrasByKey: Record<string, Record<string, unknown>> = {};
  const mappingWarnings: MappingWarning[] = [];

  if (spec.acts) {
    const items = resolveArrayPath(payload, spec.acts.array_path);
    if (items.length === 0) {
      mappingWarnings.push({ level: "WARN", field: spec.acts.array_path, message: "Acts array is empty or not found" });
    }
    for (const item of items) {
      const { record, extras, warnings } = mapSingleRecord(
        item,
        spec.acts.fields,
        spec.acts.extras_mode || "STORE_UNMAPPED",
        CANONICAL_ACTS_REQUIRED,
        CANONICAL_ACTS_KNOWN,
      );
      canonicalActs.push(record);
      mappingWarnings.push(...warnings);

      if (Object.keys(extras).length > 0) {
        const key = computeSingleDedupeKey(record, "ACTS");
        extrasByKey[key] = extras;
      }
    }
  }

  if (spec.pubs) {
    const items = resolveArrayPath(payload, spec.pubs.array_path);
    if (items.length === 0) {
      mappingWarnings.push({ level: "WARN", field: spec.pubs.array_path, message: "Pubs array is empty or not found" });
    }
    for (const item of items) {
      const { record, extras, warnings } = mapSingleRecord(
        item,
        spec.pubs.fields,
        spec.pubs.extras_mode || "STORE_UNMAPPED",
        CANONICAL_PUBS_REQUIRED,
        CANONICAL_PUBS_KNOWN,
      );
      canonicalPubs.push(record);
      mappingWarnings.push(...warnings);

      if (Object.keys(extras).length > 0) {
        const key = computeSingleDedupeKey(record, "PUBS");
        extrasByKey[key] = extras;
      }
    }
  }

  return { canonicalActs, canonicalPubs, extrasByKey, mappingWarnings };
}

function mapSingleRecord(
  item: unknown,
  fields: Record<string, FieldMapping>,
  extrasMode: "STORE_UNMAPPED" | "DISCARD",
  requiredFields: string[],
  knownFields: Set<string>,
): { record: MappedRecord; extras: Record<string, unknown>; warnings: MappingWarning[] } {
  const record: MappedRecord = {};
  const warnings: MappingWarning[] = [];
  const mappedSourcePaths = new Set<string>();

  // Apply explicit mappings
  for (const [canonicalField, mapping] of Object.entries(fields)) {
    const rawVal = resolvePath(item, mapping.path);
    const transformFn = TRANSFORMS[mapping.transform] || TRANSFORMS.IDENTITY;
    record[canonicalField] = transformFn(rawVal);
    mappedSourcePaths.add(mapping.path.replace("$.", ""));

    if (mapping.required && (rawVal == null || rawVal === "")) {
      warnings.push({
        level: requiredFields.includes(canonicalField) ? "BLOCK" : "WARN",
        field: canonicalField,
        message: `Required field "${canonicalField}" is missing or empty (source: ${mapping.path})`,
      });
    }
  }

  // Check required canonical fields that weren't mapped
  for (const rf of requiredFields) {
    if (!(rf in record) || record[rf] == null || record[rf] === "") {
      if (!(rf in fields)) {
        warnings.push({
          level: "WARN",
          field: rf,
          message: `Required canonical field "${rf}" has no mapping defined`,
        });
      }
    }
  }

  // Collect extras (unmapped fields from source)
  const extras: Record<string, unknown> = {};
  if (extrasMode === "STORE_UNMAPPED" && item != null && typeof item === "object") {
    for (const [key, val] of Object.entries(item as Record<string, unknown>)) {
      if (!mappedSourcePaths.has(key)) {
        extras[key] = val;
      }
    }
  }

  return { record, extras, warnings };
}

/**
 * Compute stable deduplication keys for canonical records.
 * Uses date + normalized description hash for ACTS, date + summary for PUBS.
 */
export function computeDedupeKeys(
  records: MappedRecord[],
  scope: "ACTS" | "PUBS",
): string[] {
  return records.map((r) => computeSingleDedupeKey(r, scope));
}

function computeSingleDedupeKey(record: MappedRecord, scope: "ACTS" | "PUBS"): string {
  const dateField = scope === "ACTS" ? "event_date" : "pub_date";
  const date = String(record[dateField] || "unknown");
  const desc = String(record.description || "").trim().toLowerCase().slice(0, 200);
  const provId = String(record.provider_event_id || "");
  // Include indice for TEXT payloads where reg/idx disambiguates same-day entries
  const indice = String(record.indice || "");
  // Stable key: scope + date + truncated description hash + provider ID + indice
  // Never relies on "reg" alone — uses description content for robustness
  return `${scope}:${date}:${simpleHash(desc)}:${provId}:${indice}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ---- Identity mapping spec for canonical v1 providers ----

export const IDENTITY_MAPPING_SPEC: MappingSpec = {
  acts: {
    array_path: "$.actuaciones",
    fields: {
      event_date: { path: "$.fecha", transform: "DATE_ISO" },
      event_time: { path: "$.hora", transform: "STRING" },
      event_type: { path: "$.tipo", transform: "NORMALIZE_TYPE" },
      description: { path: "$.descripcion", transform: "TRIM" },
      event_summary: { path: "$.resumen", transform: "TRIM" },
      provider_event_id: { path: "$.id", transform: "STRING" },
      indice: { path: "$.indice", transform: "STRING" },
    },
    extras_mode: "STORE_UNMAPPED",
  },
  pubs: {
    array_path: "$.publicaciones",
    fields: {
      pub_date: { path: "$.fecha", transform: "DATE_ISO" },
      description: { path: "$.descripcion", transform: "TRIM" },
      event_summary: { path: "$.resumen", transform: "TRIM" },
      provider_event_id: { path: "$.id", transform: "STRING" },
    },
    extras_mode: "STORE_UNMAPPED",
  },
};
