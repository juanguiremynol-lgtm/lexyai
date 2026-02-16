/**
 * Spreadsheet Formula Injection Sanitizer
 *
 * Prevents CSV/XLSX formula injection by prefixing dangerous cell values
 * with an apostrophe. Applies to strings starting with: = + - @
 *
 * Reference: OWASP CSV Injection
 * https://owasp.org/www-community/attacks/CSV_Injection
 */

const FORMULA_PREFIXES = ["=", "+", "-", "@"];

/**
 * Sanitize a single value for safe spreadsheet export.
 * Only string values are sanitized; numbers, booleans, null/undefined pass through.
 */
export function sanitizeCellValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trimStart();
  if (trimmed.length > 0 && FORMULA_PREFIXES.includes(trimmed[0])) {
    return "'" + value;
  }
  return value;
}

/**
 * Sanitize all string values in a flat record for spreadsheet export.
 */
export function sanitizeRowForExport<T extends Record<string, unknown>>(row: T): T {
  const sanitized = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(row)) {
    sanitized[key] = sanitizeCellValue(value);
  }
  return sanitized as T;
}

/**
 * Sanitize an array of rows for spreadsheet export.
 */
export function sanitizeRowsForExport<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map(sanitizeRowForExport);
}
