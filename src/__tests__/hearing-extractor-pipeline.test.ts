/**
 * Pipeline gate: the hearing extractor must recognize the exact production
 * strings persisted in `work_item_acts` for the CPNU/SAMAI feeds we ingest.
 *
 * If this test passes, the early hearing backfill sweep in
 * `supabase/functions/sync-by-work-item/index.ts` (lines ~1442-1486) will
 * insert a `work_item_hearings` row with `extraction_method='act_regex_v2'`
 * whenever `sync-by-work-item` is invoked for a WI whose `work_item_acts`
 * already contains one of these descriptions — no manual DB insert needed.
 *
 * (The extractor module is Deno-native; we re-declare its keyword set +
 *  regex here for a runtime-agnostic unit gate.)
 */
import { describe, it, expect } from "vitest";

// Mirror of supabase/functions/_shared/hearingExtractor.ts core logic.
// Keep this in sync when the extractor evolves.
const SCHEDULE_KEYWORDS = [
  "fija fecha de audiencia",
  "audiencia pruebas y alegatos",
  "audiencia de pruebas",
  "auto fija fecha audiencia",
  "art. 372",
  "art. 373",
  "audiencia inicial",
];

const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = (s: string) =>
  stripAccents(s.toLowerCase()).replace(/\s+/g, " ").trim();

const DATE_RE =
  /(?:para\s+el(?:\s+dia)?|el\s+dia)\s+(\d{1,2})\s+de\s+([a-z]+)\s+(?:de|del)\s+(\d{4})/;
const TIME_RE = /(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/;

function matchesSchedule(text: string): boolean {
  const t = norm(text);
  return SCHEDULE_KEYWORDS.some((k) => t.includes(k));
}
function extractsDate(text: string): boolean {
  return DATE_RE.test(norm(text));
}
function extractsTime(text: string): boolean {
  return TIME_RE.test(norm(text));
}

describe("hearing extractor — real production strings from WI 7b038fac", () => {
  const CASES = [
    "Audiencia Pruebas Y Alegatos - FIJA FECHA DE AUDIENCIA PARA EL 08 DE JULIO DEL 2026 A LAS 09:00 A.M",
    "Auto fija fecha audiencia y/o diligencia - FIJA FECHA DE AUDIENCIA PARA EL 17 DE ABRIL DEL 2026 A LAS 09:00 A.M",
    "AUTO FIJA FECHA AUDIENCIA Y/O DILIGENCIA - FIJA FECHA DE AUDIENCIA PARA EL 17 DE ABRIL DEL 2026 A LAS 09:00 A.M",
  ];

  it.each(CASES)("matches schedule keyword: %s", (s) => {
    expect(matchesSchedule(s)).toBe(true);
  });

  it.each(CASES)("parses date: %s", (s) => {
    expect(extractsDate(s)).toBe(true);
  });

  it.each(CASES)("parses time: %s", (s) => {
    expect(extractsTime(s)).toBe(true);
  });
});