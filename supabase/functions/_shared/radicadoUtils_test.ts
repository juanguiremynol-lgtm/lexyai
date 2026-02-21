/**
 * radicadoUtils_test.ts — Tests for the canonical shared utilities.
 */
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeRadicado,
  isValidRadicado,
  isValidTutelaCode,
  formatRadicadoDisplay,
  validateRadicado,
  parseColombianDate,
  normalizeDate,
  enrichFromRadicadoDane,
  extractDateFromTitle,
  pollDelay,
  joinUrl,
  ensureAbsoluteUrl,
  redactPII,
  maskRadicado,
  truncate,
  calculateNextBusinessDay,
} from "./radicadoUtils.ts";

// ═══════════════════════════════════════════
// normalizeRadicado
// ═══════════════════════════════════════════

Deno.test("normalizeRadicado removes non-digits from standard radicado", () => {
  assertEquals(normalizeRadicado("05-001-40-03-015-2024-01930-00"), "05001400301520240193000");
  assertEquals(normalizeRadicado("  05001400301520240193000  "), "05001400301520240193000");
});

Deno.test("normalizeRadicado preserves tutela code T prefix", () => {
  assertEquals(normalizeRadicado("T1234567"), "T1234567");
  assertEquals(normalizeRadicado("t1234567"), "T1234567");
});

Deno.test("normalizeRadicado handles empty input", () => {
  assertEquals(normalizeRadicado(""), "");
  assertEquals(normalizeRadicado("   "), "");
});

// ═══════════════════════════════════════════
// isValidRadicado
// ═══════════════════════════════════════════

Deno.test("isValidRadicado returns true for 23-digit radicado", () => {
  assertEquals(isValidRadicado("05001400301520240193000"), true);
});

Deno.test("isValidRadicado returns false for wrong length", () => {
  assertEquals(isValidRadicado("12345"), false);
  assertEquals(isValidRadicado(""), false);
});

// ═══════════════════════════════════════════
// isValidTutelaCode
// ═══════════════════════════════════════════

Deno.test("isValidTutelaCode", () => {
  assertEquals(isValidTutelaCode("T1234567"), true);
  assertEquals(isValidTutelaCode("T123456789"), true);
  assertEquals(isValidTutelaCode("T12345"), false); // too short
  assertEquals(isValidTutelaCode("12345"), false);  // no T prefix
});

// ═══════════════════════════════════════════
// formatRadicadoDisplay
// ═══════════════════════════════════════════

Deno.test("formatRadicadoDisplay formats 23-digit radicado", () => {
  assertEquals(
    formatRadicadoDisplay("05001400301520240193000"),
    "05-001-40-03-015-2024-01930-00",
  );
});

Deno.test("formatRadicadoDisplay returns non-23 digit input unchanged", () => {
  assertEquals(formatRadicadoDisplay("12345"), "12345");
});

// ═══════════════════════════════════════════
// validateRadicado
// ═══════════════════════════════════════════

Deno.test("validateRadicado accepts valid 23-digit radicado", () => {
  const result = validateRadicado("05001400301520240193000");
  assertEquals(result.valid, true);
  assertEquals(result.normalized, "05001400301520240193000");
});

Deno.test("validateRadicado rejects wrong length", () => {
  const result = validateRadicado("12345");
  assertEquals(result.valid, false);
  assertEquals(result.errorCode, "INVALID_LENGTH");
});

Deno.test("validateRadicado accepts tutela code for TUTELA workflow", () => {
  const result = validateRadicado("T1234567", "TUTELA");
  assertEquals(result.valid, true);
});

Deno.test("validateRadicado rejects CGP radicado not ending in 00 or 01", () => {
  const result = validateRadicado("05001400301520240193002", "CGP");
  assertEquals(result.valid, false);
  assertEquals(result.errorCode, "INVALID_ENDING");
});

// ═══════════════════════════════════════════
// parseColombianDate
// ═══════════════════════════════════════════

Deno.test("parseColombianDate parses DD/MM/YYYY", () => {
  assertEquals(parseColombianDate("15/01/2025"), "2025-01-15");
});

Deno.test("parseColombianDate parses DD-MM-YYYY", () => {
  assertEquals(parseColombianDate("15-01-2025"), "2025-01-15");
});

Deno.test("parseColombianDate returns ISO as-is", () => {
  assertEquals(parseColombianDate("2025-01-15"), "2025-01-15");
  assertEquals(parseColombianDate("2025-01-15T12:00:00Z"), "2025-01-15");
});

Deno.test("parseColombianDate strips time portion", () => {
  assertEquals(parseColombianDate("07/06/2025 6:06:44"), "2025-06-07");
});

Deno.test("parseColombianDate returns null for null/empty", () => {
  assertEquals(parseColombianDate(null), null);
  assertEquals(parseColombianDate(""), null);
  assertEquals(parseColombianDate(undefined), null);
});

// ═══════════════════════════════════════════
// normalizeDate
// ═══════════════════════════════════════════

Deno.test("normalizeDate handles various formats", () => {
  assertEquals(normalizeDate("2025-01-15T12:00:00Z"), "2025-01-15");
  assertEquals(normalizeDate("15/01/2025"), "2025-01-15");
  assertEquals(normalizeDate(null), "");
  assertEquals(normalizeDate("null"), "");
});

// ═══════════════════════════════════════════
// enrichFromRadicadoDane
// ═══════════════════════════════════════════

Deno.test("enrichFromRadicadoDane extracts Medellín from DANE code", () => {
  const result = enrichFromRadicadoDane("05001400301520240193000");
  assertEquals(result.city, "Medellín");
  assertEquals(result.department, "Antioquia");
});

Deno.test("enrichFromRadicadoDane extracts Bogotá", () => {
  const result = enrichFromRadicadoDane("11001400301520240193000");
  assertEquals(result.city, "Bogotá D.C.");
  assertEquals(result.department, "Bogotá D.C.");
});

Deno.test("enrichFromRadicadoDane returns null for short radicado", () => {
  const result = enrichFromRadicadoDane("12345");
  assertEquals(result.city, null);
});

// ═══════════════════════════════════════════
// extractDateFromTitle
// ═══════════════════════════════════════════

Deno.test("extractDateFromTitle from filename with YYYYMMDD", () => {
  assertEquals(extractDateFromTitle("003Estados20260122.pdf"), "2026-01-22");
});

Deno.test("extractDateFromTitle from Spanish text", () => {
  assertEquals(extractDateFromTitle("REGISTRO 1 DE JULIO DE 2024.pdf"), "2024-07-01");
});

Deno.test("extractDateFromTitle returns undefined for no date", () => {
  assertEquals(extractDateFromTitle("nodatehere"), undefined);
});

// ═══════════════════════════════════════════
// pollDelay
// ═══════════════════════════════════════════

Deno.test("pollDelay uses exponential backoff", () => {
  const d1 = pollDelay(1);
  const d2 = pollDelay(2);
  assertEquals(d1, 3000);
  assertEquals(d2 > d1, true);
});

// ═══════════════════════════════════════════
// URL helpers
// ═══════════════════════════════════════════

Deno.test("joinUrl joins base + prefix + path", () => {
  assertEquals(joinUrl("https://api.example.com", "/v1", "/health"), "https://api.example.com/v1/health");
  assertEquals(joinUrl("https://api.example.com/", "", "/health"), "https://api.example.com/health");
});

Deno.test("ensureAbsoluteUrl handles relative and absolute", () => {
  assertEquals(ensureAbsoluteUrl("https://full.url/path", "https://base"), "https://full.url/path");
  assertEquals(ensureAbsoluteUrl("/relative/path", "https://base.com"), "https://base.com/relative/path");
});

// ═══════════════════════════════════════════
// PII & string helpers
// ═══════════════════════════════════════════

Deno.test("redactPII masks cedula numbers", () => {
  const result = redactPII("C.C. 1234567890 demandante");
  assertEquals(result.includes("1234567890"), false);
});

Deno.test("maskRadicado shows first/last 4 chars", () => {
  assertEquals(maskRadicado("05001400301520240193000"), "0500***************3000");
});

Deno.test("truncate limits string length", () => {
  assertEquals(truncate("hello world", 5), "hello");
  assertEquals(truncate("hi", 5), "hi");
});

// ═══════════════════════════════════════════
// calculateNextBusinessDay
// ═══════════════════════════════════════════

Deno.test("calculateNextBusinessDay skips weekend", () => {
  // 2025-01-17 is Friday → next business day is Monday 2025-01-20
  assertEquals(calculateNextBusinessDay("2025-01-17"), "2025-01-20");
  // 2025-01-13 is Monday → next business day is Tuesday 2025-01-14
  assertEquals(calculateNextBusinessDay("2025-01-13"), "2025-01-14");
});
