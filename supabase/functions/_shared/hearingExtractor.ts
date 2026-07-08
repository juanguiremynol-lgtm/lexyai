/**
 * Hearing Extractor — pure module.
 *
 * Parses Spanish hearing scheduling text out of actuación type + description/annotation
 * (CGP + CPACA + Laboral formats) and returns a normalized hearing candidate.
 *
 * NEVER performs I/O. Timezone: America/Bogotá is applied by the caller via
 * `buildBogotaTimestamptz` when persisting to DB.
 */

export interface HearingCandidate {
  starts_at_iso: string; // UTC ISO string built from Bogotá local wall-clock
  local_date: string; // YYYY-MM-DD (Bogotá)
  local_time: string; // HH:MM (Bogotá, 24h)
  time_inferred: boolean;
  action: "schedule" | "suspend" | "reschedule";
  title: string; // Concise hearing title, e.g. "Audiencia Pruebas y Alegatos"
  raw_matched: string;
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

// Trigger keywords — matched case/accent-insensitively against actType+description
const SCHEDULE_KEYWORDS = [
  "fija fecha de audiencia",
  "fija fecha audiencia",
  "auto fija fecha audiencia",
  "señala fecha de audiencia",
  "senala fecha de audiencia",
  "cita a audiencia",
  "programa audiencia",
  "audiencia programada",
  "audiencia pruebas y alegatos",
  "audiencia inicial",
  "audiencia de trámite",
  "audiencia de tramite",
  "audiencia concentrada",
  "audiencia de instrucción",
  "audiencia de instruccion",
  "audiencia de juzgamiento",
];
const RESCHEDULE_KEYWORDS = ["reprograma", "reprogramación", "reprogramacion", "nueva fecha"];
const SUSPEND_KEYWORDS = ["suspende la audiencia", "aplaza la audiencia", "aplaza audiencia", "suspende audiencia"];

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(s: string | null | undefined): string {
  return stripAccents((s ?? "").toLowerCase()).replace(/\s+/g, " ").trim();
}

/**
 * Returns a UTC ISO string representing the given Bogotá wall-clock date/time.
 * Bogotá is fixed UTC-5 (no DST).
 */
export function buildBogotaTimestamptz(y: number, m: number, d: number, hh: number, mm: number): string {
  // Bogotá local -> UTC by adding 5h
  const utcMs = Date.UTC(y, m - 1, d, hh + 5, mm, 0);
  return new Date(utcMs).toISOString();
}

function parseTime(text: string): { hh: number; mm: number; inferred: boolean } {
  const t = normalize(text);
  // Patterns: "a las 9:00 a.m.", "09:00 am", "a las 2:30 p.m.", "hora: 09:00"
  const m = t.match(/(?:a\s+las|hora\s*:?|a\s+la)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/);
  const m2 = m ?? t.match(/(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/);
  if (!m2) return { hh: 8, mm: 0, inferred: true };
  let hh = parseInt(m2[1], 10);
  const mm = m2[2] ? parseInt(m2[2], 10) : 0;
  const meridiem = (m2[3] || "").replace(/[\.\s]/g, "");
  if (meridiem === "pm" && hh < 12) hh += 12;
  if (meridiem === "am" && hh === 12) hh = 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return { hh: 8, mm: 0, inferred: true };
  return { hh, mm, inferred: false };
}

function parseDate(text: string): { y: number; m: number; d: number } | null {
  const t = normalize(text);
  // "para el 08 de julio del 2026" | "para el dia 8 de julio de 2026"
  const r =
    t.match(/(?:para\s+el(?:\s+dia)?|el\s+dia)\s+(\d{1,2})\s+de\s+([a-z]+)\s+(?:de|del)\s+(\d{4})/) ??
    t.match(/(\d{1,2})\s+de\s+([a-z]+)\s+(?:de|del)\s+(\d{4})/);
  if (!r) return null;
  const d = parseInt(r[1], 10);
  const m = MONTHS[r[2]];
  const y = parseInt(r[3], 10);
  if (!m || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return { y, m, d };
}

function conciseTitle(actType: string | null, description: string | null): string {
  const raw = (actType && actType.trim().length > 0 ? actType : (description ?? "")).split(" - ")[0];
  return raw.trim().replace(/\s+/g, " ").slice(0, 200) || "Audiencia";
}

/**
 * Detect suspension / aplazamiento acts. Returns true if the text implies a
 * scheduled hearing must be marked suspended (and NO new date is present).
 */
export function isSuspensionAct(actType: string | null, description: string | null): boolean {
  const combined = normalize(`${actType ?? ""} ${description ?? ""}`);
  const hasSuspend = SUSPEND_KEYWORDS.some((k) => combined.includes(k));
  if (!hasSuspend) return false;
  // If a new date is also present, treat as reschedule instead
  return parseDate(combined) === null;
}

/**
 * Main entry point.
 *
 * @returns a HearingCandidate when the act schedules or reschedules a hearing,
 *          or `null` when no hearing signal is found.
 */
export function extractHearingFromAct(input: {
  act_type: string | null;
  description: string | null;
}): HearingCandidate | null {
  const combined = normalize(`${input.act_type ?? ""} ${input.description ?? ""}`);
  if (!combined) return null;

  const isReschedule = RESCHEDULE_KEYWORDS.some((k) => combined.includes(k));
  const isSchedule = SCHEDULE_KEYWORDS.some((k) => combined.includes(k));
  if (!isSchedule && !isReschedule) return null;

  const date = parseDate(combined);
  if (!date) return null; // Cannot extract a hearing without a date

  const time = parseTime(combined);
  const iso = buildBogotaTimestamptz(date.y, date.m, date.d, time.hh, time.mm);
  const local_date = `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  const local_time = `${String(time.hh).padStart(2, "0")}:${String(time.mm).padStart(2, "0")}`;

  return {
    starts_at_iso: iso,
    local_date,
    local_time,
    time_inferred: time.inferred,
    action: isReschedule ? "reschedule" : "schedule",
    title: conciseTitle(input.act_type, input.description),
    raw_matched: combined.slice(0, 240),
  };
}

/**
 * Convenience: returns a stable dedupe key for a candidate on a work item.
 */
export function hearingDedupeKey(workItemId: string, cand: HearingCandidate): string {
  return `${workItemId}|${cand.starts_at_iso}`;
}
