/**
 * radicadoUtils.ts — Canonical radicado normalization, validation, and DANE enrichment.
 *
 * SINGLE SOURCE OF TRUTH for radicado-related utilities.
 * All edge functions must import from here instead of maintaining local copies.
 *
 * Previously duplicated in:
 *   - sync-by-work-item/index.ts
 *   - sync-by-radicado/index.ts
 *   - sync-publicaciones-by-work-item/index.ts
 *   - demo-radicado-lookup/index.ts
 */

// ═══════════════════════════════════════════
// RADICADO NORMALIZATION
// ═══════════════════════════════════════════

/**
 * Normalize radicado input:
 * - Trims whitespace
 * - If starts with 'T' (tutela code), keeps the 'T' prefix and removes spaces
 * - Otherwise removes all non-digits (spaces, hyphens, etc.)
 */
export function normalizeRadicado(radicado: string): string {
  if (!radicado) return '';
  const trimmed = radicado.trim();

  // Tutela codes start with T followed by digits (e.g., T1234567)
  if (/^[Tt]\d/.test(trimmed)) {
    return trimmed.toUpperCase().replace(/\s+/g, '');
  }

  // Standard radicado: remove all non-digits
  return trimmed.replace(/\D/g, '');
}

/**
 * Check if a normalized radicado is a valid 23-digit identifier.
 */
export function isValidRadicado(radicado: string): boolean {
  const normalized = normalizeRadicado(radicado);
  return normalized.length === 23;
}

/**
 * Check if a string is a valid tutela code (T followed by 6-10 digits).
 */
export function isValidTutelaCode(code: string): boolean {
  return /^T\d{6,10}$/i.test(code);
}

/**
 * Format a 23-digit radicado for display:
 * 05-001-40-03-015-2024-01930-00
 */
export function formatRadicadoDisplay(rad: string): string {
  if (rad.length !== 23) return rad;
  return `${rad.slice(0, 2)}-${rad.slice(2, 5)}-${rad.slice(5, 7)}-${rad.slice(7, 9)}-${rad.slice(9, 12)}-${rad.slice(12, 16)}-${rad.slice(16, 21)}-${rad.slice(21, 23)}`;
}

/**
 * Validate and normalize radicado input with workflow-specific rules.
 */
export function validateRadicado(
  radicado: string,
  workflowType?: string,
): {
  valid: boolean;
  normalized: string;
  error?: string;
  errorCode?: string;
} {
  if (!radicado || typeof radicado !== 'string') {
    return {
      valid: false,
      normalized: '',
      error: 'Radicado es requerido',
      errorCode: 'EMPTY_RADICADO',
    };
  }

  const normalized = normalizeRadicado(radicado);

  if (normalized.length === 0) {
    return {
      valid: false,
      normalized: '',
      error: 'El radicado no contiene dígitos válidos',
      errorCode: 'INVALID_CHARS',
    };
  }

  // Tutela codes have a different format (T followed by digits)
  if (workflowType === 'TUTELA' && /^T\d+$/.test(normalized)) {
    return { valid: true, normalized };
  }

  if (normalized.length !== 23) {
    return {
      valid: false,
      normalized,
      error: `El radicado debe tener exactamente 23 dígitos (tiene ${normalized.length})`,
      errorCode: 'INVALID_LENGTH',
    };
  }

  if (workflowType === 'CGP') {
    const ending = normalized.slice(-2);
    if (ending !== '00' && ending !== '01') {
      return {
        valid: false,
        normalized,
        error: `El radicado CGP debe terminar en 00 o 01 (termina en ${ending})`,
        errorCode: 'INVALID_ENDING',
      };
    }
  }

  return { valid: true, normalized };
}

// ═══════════════════════════════════════════
// DESPACHO NORMALIZATION
// ═══════════════════════════════════════════

/**
 * Normalize a despacho (court) name for robust matching:
 * - Uppercase
 * - Remove diacritics (á→a, ñ→n, etc.)
 * - Collapse whitespace
 * - Normalize numeric court index: "010" ↔ "10" equivalence
 * - Remove prepositions "DE ", "DEL "
 */
export function normalizeDespacho(despacho: string): string {
  if (!despacho) return '';
  let s = despacho.trim().toUpperCase();
  // Remove diacritics
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  // Normalize numeric court index: "JUZGADO 010" → "JUZGADO 10"
  s = s.replace(/\bJUZGADO\s+0*(\d+)\b/g, 'JUZGADO $1');
  // Remove prepositions for matching
  s = s.replace(/\bDE\s+/g, '').replace(/\bDEL\s+/g, '');
  return s;
}

/**
 * Check if two despacho strings match after normalization.
 */
export function matchDespacho(a: string, b: string): boolean {
  return normalizeDespacho(a) === normalizeDespacho(b);
}

// ═══════════════════════════════════════════
// DATE PARSING
// ═══════════════════════════════════════════

/**
 * Parse Colombian date strings to ISO format (YYYY-MM-DD).
 * Handles:
 *   - DD/MM/YYYY (Colombian format)
 *   - DD-MM-YYYY
 *   - YYYY-MM-DD (already ISO, returned as-is)
 *   - D/M/YYYY (single digit day/month)
 *   - "DD/MM/YYYY HH:MM:SS" (with time portion stripped)
 */
export function parseColombianDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;

  // If already ISO format, return date portion
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }

  // Remove time portion if present (e.g., "07/06/2025 6:06:44" → "07/06/2025")
  const dateOnly = dateStr.split(' ')[0];

  const patterns = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,     // DD/MM/YYYY
    /^(\d{2})-(\d{2})-(\d{4})$/,       // DD-MM-YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // D/M/YYYY or DD/M/YYYY
  ];

  for (const pattern of patterns) {
    const match = dateOnly.match(pattern);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      return `${match[3]}-${month}-${day}`;
    }
  }

  return null;
}

/**
 * Normalize a date from various provider formats to ISO YYYY-MM-DD.
 * More permissive than parseColombianDate — also handles ISO datetime strings.
 */
export function normalizeDate(raw: string | undefined | null): string {
  if (!raw || raw === "null" || raw === "undefined") return "";
  const str = String(raw).trim();
  if (!str) return "";

  // ISO datetime (e.g., "2024-07-01T12:00:00Z")
  const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // Colombian format DD/MM/YYYY or DD-MM-YYYY
  const parsed = parseColombianDate(str);
  if (parsed) return parsed;

  return "";
}

// ═══════════════════════════════════════════
// DANE / DIVIPOLA ENRICHMENT
// ═══════════════════════════════════════════

/**
 * Top Colombian municipalities by DANE code (dept 2 digits + municipality 3 digits).
 * Used to derive city/department from radicado when provider doesn't return them.
 */
export const DANE_CITIES: Record<string, { city: string; department: string }> = {
  "05001": { city: "Medellín", department: "Antioquia" },
  "05002": { city: "Abejorral", department: "Antioquia" },
  "05045": { city: "Apartadó", department: "Antioquia" },
  "05088": { city: "Bello", department: "Antioquia" },
  "05148": { city: "Carmen de Viboral", department: "Antioquia" },
  "05154": { city: "Caucasia", department: "Antioquia" },
  "05172": { city: "Chigorodó", department: "Antioquia" },
  "05212": { city: "Copacabana", department: "Antioquia" },
  "05237": { city: "Don Matías", department: "Antioquia" },
  "05250": { city: "El Bagre", department: "Antioquia" },
  "05266": { city: "Envigado", department: "Antioquia" },
  "05308": { city: "Girardota", department: "Antioquia" },
  "05360": { city: "Itagüí", department: "Antioquia" },
  "05380": { city: "La Estrella", department: "Antioquia" },
  "05440": { city: "Marinilla", department: "Antioquia" },
  "05615": { city: "Rionegro", department: "Antioquia" },
  "05631": { city: "Sabaneta", department: "Antioquia" },
  "05736": { city: "Segovia", department: "Antioquia" },
  "05756": { city: "Sonsón", department: "Antioquia" },
  "05790": { city: "Tarazá", department: "Antioquia" },
  "05837": { city: "Turbo", department: "Antioquia" },
  "05842": { city: "Uramita", department: "Antioquia" },
  "08001": { city: "Barranquilla", department: "Atlántico" },
  "08433": { city: "Malambo", department: "Atlántico" },
  "08638": { city: "Sabanalarga", department: "Atlántico" },
  "08758": { city: "Soledad", department: "Atlántico" },
  "11001": { city: "Bogotá D.C.", department: "Bogotá D.C." },
  "13001": { city: "Cartagena", department: "Bolívar" },
  "13430": { city: "Magangué", department: "Bolívar" },
  "15001": { city: "Tunja", department: "Boyacá" },
  "15238": { city: "Duitama", department: "Boyacá" },
  "15759": { city: "Sogamoso", department: "Boyacá" },
  "17001": { city: "Manizales", department: "Caldas" },
  "18001": { city: "Florencia", department: "Caquetá" },
  "19001": { city: "Popayán", department: "Cauca" },
  "20001": { city: "Valledupar", department: "Cesar" },
  "23001": { city: "Montería", department: "Córdoba" },
  "25001": { city: "Agua de Dios", department: "Cundinamarca" },
  "25175": { city: "Chía", department: "Cundinamarca" },
  "25269": { city: "Facatativá", department: "Cundinamarca" },
  "25286": { city: "Funza", department: "Cundinamarca" },
  "25290": { city: "Fusagasugá", department: "Cundinamarca" },
  "25307": { city: "Girardot", department: "Cundinamarca" },
  "25430": { city: "Madrid", department: "Cundinamarca" },
  "25473": { city: "Mosquera", department: "Cundinamarca" },
  "25754": { city: "Soacha", department: "Cundinamarca" },
  "25899": { city: "Zipaquirá", department: "Cundinamarca" },
  "27001": { city: "Quibdó", department: "Chocó" },
  "41001": { city: "Neiva", department: "Huila" },
  "44001": { city: "Riohacha", department: "La Guajira" },
  "47001": { city: "Santa Marta", department: "Magdalena" },
  "50001": { city: "Villavicencio", department: "Meta" },
  "52001": { city: "Pasto", department: "Nariño" },
  "52835": { city: "Tumaco", department: "Nariño" },
  "54001": { city: "Cúcuta", department: "Norte de Santander" },
  "54874": { city: "Villa del Rosario", department: "Norte de Santander" },
  "63001": { city: "Armenia", department: "Quindío" },
  "66001": { city: "Pereira", department: "Risaralda" },
  "66170": { city: "Dosquebradas", department: "Risaralda" },
  "68001": { city: "Bucaramanga", department: "Santander" },
  "68081": { city: "Barrancabermeja", department: "Santander" },
  "68276": { city: "Floridablanca", department: "Santander" },
  "68307": { city: "Girón", department: "Santander" },
  "68547": { city: "Piedecuesta", department: "Santander" },
  "70001": { city: "Sincelejo", department: "Sucre" },
  "73001": { city: "Ibagué", department: "Tolima" },
  "76001": { city: "Cali", department: "Valle del Cauca" },
  "76109": { city: "Buenaventura", department: "Valle del Cauca" },
  "76111": { city: "Guadalajara de Buga", department: "Valle del Cauca" },
  "76147": { city: "Cartago", department: "Valle del Cauca" },
  "76364": { city: "Jamundí", department: "Valle del Cauca" },
  "76520": { city: "Palmira", department: "Valle del Cauca" },
  "76834": { city: "Tuluá", department: "Valle del Cauca" },
  "76892": { city: "Yumbo", department: "Valle del Cauca" },
  "81001": { city: "Arauca", department: "Arauca" },
  "85001": { city: "Yopal", department: "Casanare" },
  "86001": { city: "Mocoa", department: "Putumayo" },
  "88001": { city: "San Andrés", department: "San Andrés y Providencia" },
  "91001": { city: "Leticia", department: "Amazonas" },
  "94001": { city: "Inírida", department: "Guainía" },
  "95001": { city: "San José del Guaviare", department: "Guaviare" },
  "97001": { city: "Mitú", department: "Vaupés" },
  "99001": { city: "Puerto Carreño", department: "Vichada" },
};

/** Department names by 2-digit code (fallback when specific municipality isn't in DANE_CITIES) */
export const DEPT_NAMES: Record<string, string> = {
  "05": "Antioquia", "08": "Atlántico", "11": "Bogotá D.C.", "13": "Bolívar",
  "15": "Boyacá", "17": "Caldas", "18": "Caquetá", "19": "Cauca",
  "20": "Cesar", "23": "Córdoba", "25": "Cundinamarca", "27": "Chocó",
  "41": "Huila", "44": "La Guajira", "47": "Magdalena", "50": "Meta",
  "52": "Nariño", "54": "Norte de Santander", "63": "Quindío", "66": "Risaralda",
  "68": "Santander", "70": "Sucre", "73": "Tolima", "76": "Valle del Cauca",
  "81": "Arauca", "85": "Casanare", "86": "Putumayo", "88": "San Andrés y Providencia",
  "91": "Amazonas", "94": "Guainía", "95": "Guaviare", "97": "Vaupés", "99": "Vichada",
};

/** Specialty codes (ESP 2 digits) to human-readable jurisdiction */
export const ESP_NAMES: Record<string, string> = {
  "10": "Penal Circuito", "11": "Civil Circuito", "12": "Penal Municipal",
  "13": "Laboral Circuito", "14": "Promiscuo Municipal", "15": "Familia",
  "18": "Ejecución Penas", "20": "Tribunal Civil", "21": "Tribunal Laboral",
  "22": "Tribunal Penal", "23": "Civil", "31": "Civil",
  "33": "Administrativo", "34": "Administrativo Tribunal",
  "40": "Civil Municipal", "41": "Laboral Municipal",
  "42": "Penal Adolescentes", "44": "Familia",
  "50": "Promiscuo", "53": "Penal Municipal",
  "89": "Promiscuo",
};

/** Jurisdiction map for radicado specialty codes (demo-compatible) */
export const JURISDICCION_MAP: Record<string, string> = {
  ...ESP_NAMES,
};

/**
 * Derive city and department from a 23-digit radicado's DANE code.
 */
export function enrichFromRadicadoDane(radicado: string): {
  city: string | null;
  department: string | null;
  specialty: string | null;
} {
  if (!radicado || radicado.length !== 23) return { city: null, department: null, specialty: null };

  const dane5 = radicado.slice(0, 5);
  const deptCode = radicado.slice(0, 2);
  const espCode = radicado.slice(7, 9);

  const lookup = DANE_CITIES[dane5];
  const city = lookup?.city || null;
  const department = lookup?.department || DEPT_NAMES[deptCode] || null;
  const specialty = ESP_NAMES[espCode] || null;

  return { city, department, specialty };
}

// ═══════════════════════════════════════════
// SPANISH DATE EXTRACTION FROM TITLES
// ═══════════════════════════════════════════

const SPANISH_MONTHS: Record<string, string> = {
  'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
  'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
  'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12',
};

/**
 * Extract date from publication title — handles multiple formats:
 * - "003Estados20260122.pdf" → 2026-01-22 (YYYYMMDD in filename)
 * - "REGISTRO 1 DE JULIO DE 2024.pdf" → 2024-07-01 (Spanish format)
 * - "22/01/2026" → 2026-01-22 (DD/MM/YYYY)
 */
export function extractDateFromTitle(title: string): string | undefined {
  if (!title) return undefined;

  // Pattern 1: "XXXEstadosYYYYMMDD.pdf"
  const yyyymmddMatch = title.match(/(\d{4})(\d{2})(\d{2})\.pdf/i);
  if (yyyymmddMatch) {
    const year = parseInt(yyyymmddMatch[1]);
    const month = parseInt(yyyymmddMatch[2]);
    const day = parseInt(yyyymmddMatch[3]);
    if (year >= 2020 && year <= 2030 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${yyyymmddMatch[1]}-${yyyymmddMatch[2]}-${yyyymmddMatch[3]}`;
    }
  }

  // Pattern 2: "YYYYMMDD" anywhere
  const yyyymmddAnywhere = title.match(/(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (yyyymmddAnywhere) {
    return `${yyyymmddAnywhere[1]}-${yyyymmddAnywhere[2]}-${yyyymmddAnywhere[3]}`;
  }

  // Pattern 3: "DD DE MONTH_NAME DE YYYY" (Spanish)
  const spanishMatch = title.match(/(\d{1,2})\s+(?:DE\s+)?(\w+)\s+(?:DE\s+)?(\d{4})/i);
  if (spanishMatch) {
    const day = spanishMatch[1].padStart(2, '0');
    const monthName = spanishMatch[2].toUpperCase();
    const year = spanishMatch[3];
    const month = SPANISH_MONTHS[monthName];
    if (month) return `${year}-${month}-${day}`;
  }

  // Pattern 4: "DD/MM/YYYY" or "DD-MM-YYYY"
  const slashMatch = title.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  }

  return undefined;
}

// ═══════════════════════════════════════════
// POLLING HELPERS
// ═══════════════════════════════════════════

export interface PollConfig {
  maxAttempts: number;
  initialIntervalMs: number;
  maxIntervalMs: number;
  backoffBase: number;
}

export const DEFAULT_POLL_CONFIG: PollConfig = {
  maxAttempts: 10,
  initialIntervalMs: 3000,
  maxIntervalMs: 15000,
  backoffBase: 1.6,
};

/**
 * Calculate delay for a given poll attempt using exponential backoff.
 */
export function pollDelay(attempt: number, config: PollConfig = DEFAULT_POLL_CONFIG): number {
  return Math.min(
    config.initialIntervalMs * Math.pow(config.backoffBase, attempt - 1),
    config.maxIntervalMs,
  );
}

/**
 * Generic poll function for async scraping jobs.
 * Polls a URL until the job completes, fails, or times out.
 */
export async function pollForResult(
  pollUrl: string,
  headers: Record<string, string>,
  providerName: string,
  config: PollConfig = DEFAULT_POLL_CONFIG,
): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  status?: string;
  error?: string;
  lastResponse?: Record<string, unknown>;
}> {
  let lastResultData: Record<string, unknown> | null = null;

  console.log(`[${providerName}] Starting polling: ${pollUrl}`);

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const delayMs = pollDelay(attempt, config);
    console.log(`[${providerName}] Waiting ${Math.round(delayMs)}ms before poll ${attempt}/${config.maxAttempts}`);
    await new Promise(r => setTimeout(r, delayMs));

    try {
      const response = await fetch(pollUrl, { method: 'GET', headers });

      if (!response.ok) {
        console.log(`[${providerName}] Poll ${attempt} HTTP ${response.status}, continuing...`);
        continue;
      }

      const data = await response.json();
      lastResultData = data;
      const status = String(data.status || '').toLowerCase();

      console.log(`[${providerName}] Poll ${attempt}: status="${status}"`);

      if (['queued', 'processing', 'running', 'pending', 'started'].includes(status)) {
        continue;
      }

      if (['done', 'completed', 'success', 'finished'].includes(status)) {
        console.log(`[${providerName}] Job completed successfully!`);
        return { ok: true, data, status };
      }

      if (['failed', 'error', 'cancelled'].includes(status)) {
        const errorMsg = data.error || data.message || 'Unknown error';
        console.log(`[${providerName}] Job failed: ${errorMsg}`);
        return { ok: false, error: `Job failed: ${errorMsg}`, status, lastResponse: data };
      }
    } catch (pollError) {
      console.warn(`[${providerName}] Poll ${attempt} error:`, pollError);
    }
  }

  console.log(`[${providerName}] Polling TIMEOUT after ${config.maxAttempts} attempts`);
  return {
    ok: false,
    error: `Polling timeout after ${config.maxAttempts} attempts`,
    lastResponse: lastResultData || undefined,
  };
}

// ═══════════════════════════════════════════
// URL HELPERS
// ═══════════════════════════════════════════

/**
 * Safe URL join: base (no trailing slash) + prefix + path.
 * Result has exactly one slash between segments.
 */
export function joinUrl(baseUrl: string, prefix: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  let cleanPrefix = (prefix || '').trim();
  if (cleanPrefix === '/') cleanPrefix = '';
  if (cleanPrefix && !cleanPrefix.startsWith('/')) {
    cleanPrefix = '/' + cleanPrefix;
  }
  cleanPrefix = cleanPrefix.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPrefix}${cleanPath}`;
}

/**
 * Ensure a URL is absolute. If relative, prepend baseUrl.
 */
export function ensureAbsoluteUrl(url: string, baseUrl: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${baseUrl.replace(/\/+$/, '')}${url}`;
  return `${baseUrl.replace(/\/+$/, '')}/${url}`;
}

/**
 * Detect if response body looks like HTML "Cannot GET" (Express 404).
 */
export function isHtmlCannotGet(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes('cannot get') ||
    lower.includes('<!doctype html') ||
    lower.includes('<html') ||
    lower.includes('not found</pre>')
  );
}

// ═══════════════════════════════════════════
// PII REDACTION (for demo/public-facing use)
// ═══════════════════════════════════════════

/**
 * Redact PII (cedula numbers, NIT) from text.
 */
export function redactPII(text: string): string {
  return text
    .replace(/C\.?\s*C\.?\s*N[oº°]?\s*[\.\s]?\d[\d\.\s]+/gi, "[ID REDACTADO]")
    .replace(/NIT[\s.:]*\d[\d\.\-]+/gi, "[ID REDACTADO]")
    .replace(/\b\d{7,10}\b/g, (m) => (m.length >= 7 ? "[ID REDACTADO]" : m));
}

/**
 * Mask a radicado for logging (show first 4 and last 4 chars).
 */
export function maskRadicado(rad: string): string {
  if (rad.length < 8) return "***";
  return rad.slice(0, 4) + "*".repeat(rad.length - 8) + rad.slice(-4);
}

/**
 * Truncate a string to maxLen characters.
 */
export function truncate(str: string, maxLen: number): string {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

// ═══════════════════════════════════════════
// API KEY RESOLUTION
// ═══════════════════════════════════════════

export interface ApiKeyInfo {
  source: string;
  value: string | null;
  fingerprint: string | null;
}

/**
 * SHA-256 fingerprint of a key (first 8 hex chars).
 */
export async function hashFingerprint(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 8);
}

/** Provider-specific env var key names */
const PROVIDER_KEY_MAP: Record<string, string> = {
  cpnu: 'CPNU_X_API_KEY',
  samai: 'SAMAI_X_API_KEY',
  tutelas: 'TUTELAS_X_API_KEY',
  publicaciones: 'PUBLICACIONES_X_API_KEY',
  samai_estados: 'SAMAI_ESTADOS_API_KEY',
};

/**
 * Resolve the API key for a provider.
 * Tries provider-specific key first, then shared EXTERNAL_X_API_KEY.
 */
export async function getApiKeyForProvider(provider: string): Promise<ApiKeyInfo> {
  const providerKeyName = PROVIDER_KEY_MAP[provider.toLowerCase()];
  if (providerKeyName) {
    const providerKey = Deno.env.get(providerKeyName);
    if (providerKey && providerKey.length > 0) {
      return {
        source: providerKeyName,
        value: providerKey,
        fingerprint: await hashFingerprint(providerKey),
      };
    }
  }

  const sharedKey = Deno.env.get('EXTERNAL_X_API_KEY');
  if (sharedKey && sharedKey.length > 0) {
    return {
      source: 'EXTERNAL_X_API_KEY',
      value: sharedKey,
      fingerprint: await hashFingerprint(sharedKey),
    };
  }

  return { source: 'MISSING', value: null, fingerprint: null };
}

/**
 * Resolve an API key from a list of env var names (tries in order).
 * Used by demo and other contexts where the provider key resolution is simpler.
 */
export function resolveApiKeyFromEnvList(envKeys: string[]): string | null {
  for (const key of envKeys) {
    const val = Deno.env.get(key);
    if (val) return val;
  }
  return null;
}

// ═══════════════════════════════════════════
// NEXT BUSINESS DAY (Colombian legal)
// ═══════════════════════════════════════════

/**
 * Calculate the next business day after a given date.
 * In Colombian legal terms, términos begin the day AFTER fecha_desfijacion.
 * Skips weekends (Saturday = 6, Sunday = 0).
 */
export function calculateNextBusinessDay(dateStr: string | undefined | null): string | null {
  const parsed = parseColombianDate(dateStr);
  if (!parsed) return null;

  const d = new Date(parsed + 'T12:00:00Z');
  d.setDate(d.getDate() + 1);

  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }

  return d.toISOString().split('T')[0];
}
