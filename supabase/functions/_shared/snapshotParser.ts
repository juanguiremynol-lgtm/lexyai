/**
 * snapshotParser.ts — Schema-tolerant parser for TEXT and JSON provider snapshots.
 *
 * Normalizes raw provider responses into a structured snapshot object
 * that can be fed into mappingEngine. Handles:
 *   - JSON payloads (direct parse)
 *   - TEXT payloads (Colombian judicial format with Spanish labels + emoji markers)
 *
 * Never throws; returns warnings for partial parses.
 */

export interface ParsedSnapshot {
  ok: boolean;
  format: "JSON" | "TEXT" | "UNKNOWN";
  snapshot: StructuredSnapshot | null;
  warnings: string[];
}

export interface StructuredSnapshot {
  radicado?: string;
  total_actuaciones?: number;
  actuaciones: ParsedActuacion[];
  publicaciones?: unknown[];
}

export interface ParsedActuacion {
  idx: number;
  reg?: string;
  radicacion?: string;
  fecha?: string;
  actuacion?: string;
  documento?: {
    disponible: boolean;
    url?: string;
    hash?: string;
  };
  [key: string]: unknown;
}

/**
 * Parse a raw provider response body into a structured snapshot.
 *
 * @param connectorCapabilities - The connector's capabilities object (may contain snapshot_format)
 * @param rawBody - The raw response body as a string
 * @param contentType - Optional HTTP Content-Type header value
 */
export function parseSnapshot(
  connectorCapabilities: Record<string, unknown> | unknown[] | null | undefined,
  rawBody: string,
  contentType?: string,
): ParsedSnapshot {
  const warnings: string[] = [];

  // Extract snapshot_format from capabilities
  const caps = Array.isArray(connectorCapabilities)
    ? {} // old-style array capabilities, no snapshot_format
    : (connectorCapabilities as Record<string, unknown>) || {};
  const declaredFormat = String(caps.snapshot_format || "").toUpperCase();

  // 1. Try JSON parse first (unless explicitly TEXT)
  if (declaredFormat !== "TEXT") {
    try {
      const parsed = JSON.parse(rawBody);
      if (typeof parsed === "object" && parsed !== null) {
        // Convert JSON to structured snapshot
        const snapshot = normalizeJsonSnapshot(parsed, warnings);
        return { ok: true, format: "JSON", snapshot, warnings };
      }
    } catch {
      // Not valid JSON
      if (declaredFormat === "JSON") {
        warnings.push("Declared format is JSON but body failed JSON.parse");
      }
    }
  }

  // 2. Try TEXT parser
  if (declaredFormat === "TEXT" || contentType?.includes("text/") || !isLikelyJson(rawBody)) {
    const snapshot = parseTextSnapshot(rawBody, warnings);
    if (snapshot && snapshot.actuaciones.length > 0) {
      return { ok: true, format: "TEXT", snapshot, warnings };
    }
    if (snapshot && snapshot.radicado) {
      warnings.push("TEXT parsed but zero actuaciones found");
      return { ok: true, format: "TEXT", snapshot, warnings };
    }
  }

  // 3. Last resort: try JSON parse even if not declared
  if (declaredFormat !== "TEXT") {
    try {
      const parsed = JSON.parse(rawBody);
      const snapshot = normalizeJsonSnapshot(parsed, warnings);
      return { ok: true, format: "JSON", snapshot, warnings };
    } catch {
      // Truly unparseable
    }
  }

  warnings.push("Could not parse snapshot as JSON or TEXT");
  return { ok: false, format: "UNKNOWN", snapshot: null, warnings };
}

function isLikelyJson(s: string): boolean {
  const trimmed = s.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * Normalize an already-parsed JSON object into our StructuredSnapshot.
 */
function normalizeJsonSnapshot(
  obj: Record<string, unknown>,
  warnings: string[],
): StructuredSnapshot {
  const snapshot: StructuredSnapshot = {
    actuaciones: [],
  };

  if (obj.radicado) snapshot.radicado = String(obj.radicado);
  if (obj.total_actuaciones != null) snapshot.total_actuaciones = Number(obj.total_actuaciones);

  // Map actuaciones array
  const acts = obj.actuaciones;
  if (Array.isArray(acts)) {
    snapshot.actuaciones = acts.map((a: unknown, i: number) => {
      if (typeof a !== "object" || a === null) {
        warnings.push(`actuaciones[${i}] is not an object`);
        return { idx: i + 1 } as ParsedActuacion;
      }
      const act = a as Record<string, unknown>;
      const parsed: ParsedActuacion = { idx: i + 1 };

      // Map common fields
      if (act.fecha) parsed.fecha = String(act.fecha);
      if (act.descripcion) parsed.actuacion = String(act.descripcion);
      if (act.actuacion) parsed.actuacion = String(act.actuacion);
      if (act.reg) parsed.reg = String(act.reg);
      if (act.radicacion) parsed.radicacion = String(act.radicacion);
      if (act.indice) parsed.idx = Number(act.indice) || i + 1;

      // Document info
      if (act.documento || act.url || act.document_url) {
        const doc = (act.documento as Record<string, unknown>) || {};
        parsed.documento = {
          disponible: !!(doc.disponible || doc.available || act.url || act.document_url),
          url: String(doc.url || act.url || act.document_url || ""),
          hash: doc.hash ? String(doc.hash) : (act.hash ? String(act.hash) : undefined),
        };
      }

      // Preserve all original fields for extras
      for (const [k, v] of Object.entries(act)) {
        if (!(k in parsed)) {
          parsed[k] = v;
        }
      }

      return parsed;
    });
  }

  // Publicaciones passthrough
  if (Array.isArray(obj.publicaciones)) {
    snapshot.publicaciones = obj.publicaciones;
  }

  return snapshot;
}

/**
 * Parse a TEXT snapshot in Colombian judicial format.
 *
 * Expected format (with or without emoji):
 *   Radicado: 05001233300020240115300
 *   Total actuaciones: 14
 *
 *   Actuación 1:
 *   Reg: 1
 *   Radicación: 05001-23-33-000-2024-01153-00
 *   Fecha: 30/01/2026
 *   Actuación: Auto que ordena poner en conocimiento
 *   ✅ DOCUMENTO DISPONIBLE
 *   URL: https://...
 *   Hash: abc123...
 */
function parseTextSnapshot(
  text: string,
  warnings: string[],
): StructuredSnapshot | null {
  const lines = text.split("\n").map((l) => l.trim());
  const snapshot: StructuredSnapshot = { actuaciones: [] };

  // Extract radicado
  const radicadoLine = lines.find((l) => /^radicado\s*[:=]/i.test(stripEmoji(l)));
  if (radicadoLine) {
    const val = extractValue(radicadoLine);
    if (val) snapshot.radicado = val.replace(/\D/g, "") || val;
  }

  // Extract total_actuaciones
  const totalLine = lines.find((l) => /total\s+actuacion/i.test(stripEmoji(l)));
  if (totalLine) {
    const val = extractValue(totalLine);
    const num = parseInt(val, 10);
    if (!isNaN(num)) snapshot.total_actuaciones = num;
  }

  // Parse actuación blocks
  let currentAct: ParsedActuacion | null = null;
  let actIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cleanLine = stripEmoji(line);

    // Detect actuación block start: "Actuación N:" or "Actuacion N:"
    const actMatch = cleanLine.match(/^actuaci[oó]n\s+(\d+)\s*[:]/i);
    if (actMatch) {
      if (currentAct) {
        snapshot.actuaciones.push(currentAct);
      }
      actIdx++;
      currentAct = { idx: parseInt(actMatch[1], 10) || actIdx };
      continue;
    }

    if (!currentAct) continue;

    // Parse fields within an actuación block
    if (/^reg\s*[:=]/i.test(cleanLine)) {
      currentAct.reg = extractValue(line);
    } else if (/^radicaci[oó]n\s*[:=]/i.test(cleanLine)) {
      currentAct.radicacion = extractValue(line);
    } else if (/^fecha\s*[:=]/i.test(cleanLine)) {
      currentAct.fecha = extractValue(line);
    } else if (/^actuaci[oó]n\s*[:=]/i.test(cleanLine) && !actMatch) {
      // "Actuación: <description>" (not "Actuación N:")
      currentAct.actuacion = extractValue(line);
    } else if (/documento\s+disponible/i.test(cleanLine)) {
      if (!currentAct.documento) {
        currentAct.documento = { disponible: true };
      } else {
        currentAct.documento.disponible = true;
      }
    } else if (/documento\s+no\s+disponible/i.test(cleanLine)) {
      if (!currentAct.documento) {
        currentAct.documento = { disponible: false };
      } else {
        currentAct.documento.disponible = false;
      }
    } else if (/^url\s*[:=]/i.test(cleanLine)) {
      if (!currentAct.documento) currentAct.documento = { disponible: true };
      currentAct.documento.url = extractValue(line);
    } else if (/^hash\s*[:=]/i.test(cleanLine)) {
      if (!currentAct.documento) currentAct.documento = { disponible: false };
      // Hash may contain spaces; capture entire remainder
      currentAct.documento.hash = extractValue(line);
    }
  }

  // Push last actuación
  if (currentAct) {
    snapshot.actuaciones.push(currentAct);
  }

  // Validate
  if (snapshot.actuaciones.length === 0 && !snapshot.radicado) {
    warnings.push("No actuaciones or radicado found in TEXT snapshot");
    return null;
  }

  if (
    snapshot.total_actuaciones != null &&
    snapshot.total_actuaciones !== snapshot.actuaciones.length
  ) {
    warnings.push(
      `total_actuaciones declared ${snapshot.total_actuaciones} but parsed ${snapshot.actuaciones.length}`,
    );
  }

  // Validate individual actuaciones
  for (const act of snapshot.actuaciones) {
    if (!act.fecha) {
      warnings.push(`Actuación ${act.idx}: missing fecha`);
    }
    if (!act.actuacion) {
      warnings.push(`Actuación ${act.idx}: missing actuación description`);
    }
  }

  return snapshot;
}

/**
 * Strip emoji and special unicode from a line for pattern matching.
 */
function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/[\u{200D}]/gu, "")
    .replace(/[✅❌📄🔗⚖️📋]/g, "")
    .trim();
}

/**
 * Extract the value after a "Label: value" pattern.
 */
function extractValue(line: string): string {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return line.trim();
  return line.slice(colonIdx + 1).trim();
}
