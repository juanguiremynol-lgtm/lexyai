/**
 * Date Inference Engine
 * 
 * Multi-layer date inference system for legal case updates.
 * Extracts dates from API responses, filenames, annotations, and metadata.
 * 
 * LAYER 1: Explicit API dates (highest confidence)
 * LAYER 2: Parsed from filenames/annotations
 * LAYER 3: API metadata (fetchedAt, scrapedAt)
 * LAYER 4: Fallback to sync date (lowest confidence)
 */

// ============= TYPES =============

export type DateSource = 
  | 'api_explicit'      // Date came directly from API field
  | 'parsed_filename'   // Parsed from filename
  | 'parsed_annotation' // Parsed from annotation/description text
  | 'parsed_title'      // Parsed from title
  | 'api_metadata'      // From fetchedAt or similar API metadata
  | 'inferred_sync'     // Fallback to sync date (low confidence)
  | 'manual';           // Manually set by admin

export type DateConfidence = 'high' | 'medium' | 'low';

export interface DateInferenceResult {
  eventDate: string | null;         // ISO date string (YYYY-MM-DD)
  dateSource: DateSource;           // How we determined it
  dateConfidence: DateConfidence;   // Reliability level
}

export interface IsNewCriteria {
  eventDate: string | null;         // The act_date or fecha_fijacion
  dateConfidence: DateConfidence;   // high/medium/low
  createdAt: string;                // When we synced it (ISO timestamp)
  currentDate: string;              // Today's date in Colombia timezone (YYYY-MM-DD)
}

// ============= SPANISH MONTH NAMES =============

const SPANISH_MONTHS: Record<string, string> = {
  'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
  'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
  'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12',
  // Abbreviated forms
  'ene': '01', 'feb': '02', 'mar': '03', 'abr': '04',
  'may': '05', 'jun': '06', 'jul': '07', 'ago': '08',
  'sep': '09', 'oct': '10', 'nov': '11', 'dic': '12',
};

// ============= DATE PARSING UTILITIES =============

/**
 * Parse a date string to ISO format (YYYY-MM-DD)
 */
export function parseISODate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  
  // If already ISO format, return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }
  
  // Remove time portion if present (e.g., "07/06/2025 6:06:44")
  const dateOnly = dateStr.split(' ')[0];
  
  const patterns = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,  // DD/MM/YYYY (Colombian format)
    /^(\d{2})-(\d{2})-(\d{4})$/,    // DD-MM-YYYY
  ];
  
  for (const pattern of patterns) {
    const match = dateOnly.match(pattern);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
  }
  
  return null;
}

/**
 * Parse date from text content (annotations, descriptions)
 */
export function parseDateFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  
  // Pattern 1: "registrada el DD/MM/YYYY" or "realizada el DD/MM/YYYY"
  const pattern1 = /(?:registrad[ao]|realizad[ao])\s+el\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
  const match1 = text.match(pattern1);
  if (match1) {
    const [, day, month, year] = match1;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Pattern 2: "DD DE MONTH DE YYYY"
  const pattern2 = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i;
  const match2 = text.match(pattern2);
  if (match2) {
    const [, day, monthName, year] = match2;
    const month = SPANISH_MONTHS[monthName.toLowerCase()];
    if (month) {
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }
  
  // Pattern 3: "YYYYMMDD" or "YYYY-MM-DD" anywhere in text
  const pattern3 = /(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/;
  const match3 = text.match(pattern3);
  if (match3) {
    const [, year, month, day] = match3;
    // Validate it's a reasonable date
    const yearNum = parseInt(year);
    if (yearNum >= 2020 && yearNum <= 2030) {
      return `${year}-${month}-${day}`;
    }
  }
  
  // Pattern 4: "DD-MM-YYYY" or "DD/MM/YYYY"
  const pattern4 = /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/;
  const match4 = text.match(pattern4);
  if (match4) {
    const [, day, month, year] = match4;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return null;
}

/**
 * Extract date from filename - handles multiple formats:
 * - "003Estados20260122.pdf" → 2026-01-22 (YYYYMMDD in filename)
 * - "REGISTRO 1 DE JULIO DE 2024.pdf" → 2024-07-01 (Spanish format)
 * - "Estado_2026-01-22.pdf" or "Estado_20260122.pdf"
 */
export function parseDateFromFilename(filename: string | null | undefined): string | null {
  if (!filename) return null;
  
  // Pattern 1: "XXXEstadosYYYYMMDD.pdf" (e.g., "003Estados20260122.pdf")
  const pattern1 = /Estados?(\d{4})(\d{2})(\d{2})/i;
  const match1 = filename.match(pattern1);
  if (match1) {
    const [, year, month, day] = match1;
    const yearNum = parseInt(year);
    if (yearNum >= 2020 && yearNum <= 2030) {
      return `${year}-${month}-${day}`;
    }
  }
  
  // Pattern 2: "YYYYMMDD" anywhere in string
  const pattern2 = /(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/;
  const match2 = filename.match(pattern2);
  if (match2) {
    const [, year, month, day] = match2;
    const yearNum = parseInt(year);
    if (yearNum >= 2020 && yearNum <= 2030) {
      return `${year}-${month}-${day}`;
    }
  }
  
  // Pattern 3: "DD DE MONTH_NAME DE YYYY" (Spanish)
  const pattern3 = /(\d{1,2})\s+(?:DE\s+)?(\w+)\s+(?:DE\s+)?(\d{4})/i;
  const match3 = filename.match(pattern3);
  if (match3) {
    const [, day, monthName, year] = match3;
    const month = SPANISH_MONTHS[monthName.toLowerCase()];
    if (month) {
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }
  
  // Pattern 4: "YYYY-MM-DD" or "YYYY_MM_DD"
  const pattern4 = /(\d{4})[-_](\d{2})[-_](\d{2})/;
  const match4 = filename.match(pattern4);
  if (match4) {
    return `${match4[1]}-${match4[2]}-${match4[3]}`;
  }
  
  // Pattern 5: "DD-MM-YYYY" or "DD_MM_YYYY"
  const pattern5 = /(\d{2})[-_](\d{2})[-_](\d{4})/;
  const match5 = filename.match(pattern5);
  if (match5) {
    return `${match5[3]}-${match5[2]}-${match5[1]}`;
  }
  
  return null;
}

/**
 * Parse date from URL path (sometimes contains dates)
 */
export function parseDateFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  
  // Pattern: /2026/01/22/ or /20260122/
  const pattern = /\/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})\//;
  const match = url.match(pattern);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month}-${day}`;
  }
  
  return null;
}

// ============= ACTUACIONES DATE INFERENCE =============

interface ActuacionData {
  fechaActuacion?: string | null;
  fechaRegistro?: string | null;
  fecha?: string | null;
  actuacion?: string | null;
  anotacion?: string | null;
}

/**
 * Infer date for an actuación using multi-layer approach
 */
export function inferActuacionDate(
  actuacion: ActuacionData,
  apiFetchedAt: string | null
): DateInferenceResult {
  // LAYER 1: Explicit API dates (highest confidence)
  if (actuacion.fechaActuacion) {
    const parsed = parseISODate(actuacion.fechaActuacion);
    if (parsed) {
      return {
        eventDate: parsed,
        dateSource: 'api_explicit',
        dateConfidence: 'high'
      };
    }
  }
  
  if (actuacion.fechaRegistro) {
    const parsed = parseISODate(actuacion.fechaRegistro);
    if (parsed) {
      return {
        eventDate: parsed,
        dateSource: 'api_explicit',
        dateConfidence: 'high'
      };
    }
  }
  
  if (actuacion.fecha) {
    const parsed = parseISODate(actuacion.fecha);
    if (parsed) {
      return {
        eventDate: parsed,
        dateSource: 'api_explicit',
        dateConfidence: 'high'
      };
    }
  }
  
  // LAYER 2: Parse from annotation text
  if (actuacion.anotacion) {
    const annotationDate = parseDateFromText(actuacion.anotacion);
    if (annotationDate) {
      return {
        eventDate: annotationDate,
        dateSource: 'parsed_annotation',
        dateConfidence: 'medium'
      };
    }
  }
  
  // LAYER 3: Parse from actuacion description
  if (actuacion.actuacion) {
    const descriptionDate = parseDateFromText(actuacion.actuacion);
    if (descriptionDate) {
      return {
        eventDate: descriptionDate,
        dateSource: 'parsed_title',
        dateConfidence: 'medium'
      };
    }
  }
  
  // LAYER 4: Use API fetchedAt as proxy (same day assumption)
  if (apiFetchedAt) {
    return {
      eventDate: apiFetchedAt.split('T')[0],
      dateSource: 'api_metadata',
      dateConfidence: 'low'
    };
  }
  
  // LAYER 5: Fallback to current date (lowest confidence)
  return {
    eventDate: new Date().toISOString().split('T')[0],
    dateSource: 'inferred_sync',
    dateConfidence: 'low'
  };
}

// ============= PUBLICACIONES DATE INFERENCE =============

interface PublicacionData {
  fecha_publicacion?: string | null;
  fecha_fijacion?: string | null;
  titulo?: string | null;
  title?: string | null;
  pdf_url?: string | null;
  url?: string | null;
}

/**
 * Infer date for a publicación using multi-layer approach
 */
export function inferPublicacionDate(
  publicacion: PublicacionData,
  apiFetchedAt: string | null
): DateInferenceResult {
  // LAYER 1: Explicit API date
  if (publicacion.fecha_publicacion) {
    const parsed = parseISODate(publicacion.fecha_publicacion);
    if (parsed) {
      return {
        eventDate: parsed,
        dateSource: 'api_explicit',
        dateConfidence: 'high'
      };
    }
  }
  
  if (publicacion.fecha_fijacion) {
    const parsed = parseISODate(publicacion.fecha_fijacion);
    if (parsed) {
      return {
        eventDate: parsed,
        dateSource: 'api_explicit',
        dateConfidence: 'high'
      };
    }
  }
  
  // LAYER 2: Parse from filename/title
  const titulo = publicacion.titulo || publicacion.title || '';
  const filenameDate = parseDateFromFilename(titulo);
  if (filenameDate) {
    return {
      eventDate: filenameDate,
      dateSource: 'parsed_filename',
      dateConfidence: 'high'  // Filename dates are usually reliable
    };
  }
  
  // LAYER 3: Parse from URL (sometimes contains date)
  const pdfUrl = publicacion.pdf_url || publicacion.url || '';
  const urlDate = parseDateFromUrl(pdfUrl);
  if (urlDate) {
    return {
      eventDate: urlDate,
      dateSource: 'parsed_filename',
      dateConfidence: 'medium'
    };
  }
  
  // LAYER 4: Use API fetchedAt
  if (apiFetchedAt) {
    return {
      eventDate: apiFetchedAt.split('T')[0],
      dateSource: 'api_metadata',
      dateConfidence: 'medium'  // For publicaciones, fetchedAt is often close to publication
    };
  }
  
  // LAYER 5: Fallback - NULL is acceptable for publicaciones
  return {
    eventDate: null,
    dateSource: 'inferred_sync',
    dateConfidence: 'low'
  };
}

// ============= "IS NEW" DETERMINATION LOGIC =============

/**
 * Subtract days from a date string
 */
export function subtractDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

/**
 * Get current date in Colombia timezone (YYYY-MM-DD)
 */
export function getColombiaDate(): string {
  const now = new Date();
  const colombiaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  return colombiaTime.toISOString().split('T')[0];
}

/**
 * Determine if an actuación should be considered "new"
 * 
 * This is the critical logic for "Actuaciones de Hoy":
 * - HIGH confidence: Trust the event date completely
 * - MEDIUM confidence: Trust event date
 * - LOW confidence: Be conservative - require both recent event date AND recent sync
 */
export function isActuacionNew(
  criteria: IsNewCriteria, 
  lookbackDays: number = 3
): boolean {
  const { eventDate, dateConfidence, createdAt, currentDate } = criteria;
  
  const cutoffDate = subtractDays(currentDate, lookbackDays);
  
  // HIGH confidence: Trust the event date completely
  if (dateConfidence === 'high' && eventDate) {
    return eventDate >= cutoffDate;
  }
  
  // MEDIUM confidence: Trust event date
  if (dateConfidence === 'medium' && eventDate) {
    return eventDate >= cutoffDate;
  }
  
  // LOW confidence: Be conservative
  if (dateConfidence === 'low') {
    // Only show if BOTH event date (if exists) and sync date are recent
    if (eventDate && eventDate >= cutoffDate) {
      // And it was synced recently (within 24 hours) - likely genuinely new
      const syncCutoff = subtractDays(currentDate, 1);
      const createdDate = createdAt.split('T')[0];
      return createdDate >= syncCutoff;
    }
    // No event date + low confidence = don't show as "new"
    return false;
  }
  
  // Default: use event date if available, otherwise don't show as new
  return eventDate ? eventDate >= cutoffDate : false;
}

/**
 * Determine if a publicación should be considered "new"
 * 
 * Similar logic but publicaciones are usually more time-sensitive:
 * - If we have a fecha_fijacion, trust it
 * - If not, be more lenient for publicaciones synced recently
 */
export function isPublicacionNew(
  criteria: IsNewCriteria, 
  lookbackDays: number = 3
): boolean {
  const { eventDate, dateConfidence, createdAt, currentDate } = criteria;
  
  const cutoffDate = subtractDays(currentDate, lookbackDays);
  
  // For publicaciones, if we have a fecha_fijacion, trust it
  if (eventDate) {
    return eventDate >= cutoffDate;
  }
  
  // No fecha_fijacion: be more lenient for publicaciones
  // If synced in last 24 hours and no fecha_fijacion, assume it might be new
  if (dateConfidence === 'low') {
    const syncCutoff = subtractDays(currentDate, 1);
    const createdDate = createdAt.split('T')[0];
    return createdDate >= syncCutoff;
  }
  
  return false;
}

// ============= UI DISPLAY HELPERS =============

export interface ConfidenceDisplayInfo {
  label: string;
  tooltip: string;
  className: string;
  showWarning: boolean;
}

/**
 * Get display information for date confidence level
 */
export function getConfidenceDisplayInfo(
  dateConfidence: DateConfidence,
  dateSource: DateSource
): ConfidenceDisplayInfo {
  const sourceLabels: Record<DateSource, string> = {
    'api_explicit': 'Fuente oficial',
    'parsed_filename': 'Extraído del archivo',
    'parsed_annotation': 'Extraído de la anotación',
    'parsed_title': 'Extraído del título',
    'api_metadata': 'Fecha de consulta API',
    'inferred_sync': 'Fecha de sincronización',
    'manual': 'Establecida manualmente',
  };
  
  switch (dateConfidence) {
    case 'high':
      return {
        label: 'Fecha confirmada',
        tooltip: `Fecha confirmada por la fuente oficial. ${sourceLabels[dateSource]}`,
        className: '',
        showWarning: false,
      };
    case 'medium':
      return {
        label: 'Fecha extraída',
        tooltip: `Fecha extraída del documento (verificar si es necesario). ${sourceLabels[dateSource]}`,
        className: 'text-yellow-600',
        showWarning: false,
      };
    case 'low':
      return {
        label: 'Fecha aproximada',
        tooltip: `Fecha aproximada (basada en sincronización). ${sourceLabels[dateSource]}`,
        className: 'text-orange-500 italic',
        showWarning: true,
      };
    default:
      return {
        label: 'Fecha',
        tooltip: sourceLabels[dateSource] || 'Origen desconocido',
        className: '',
        showWarning: false,
      };
  }
}
