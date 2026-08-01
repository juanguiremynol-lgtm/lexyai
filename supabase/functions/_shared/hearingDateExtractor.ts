/**
 * Hearing-date extractor for PROVIDER text (actuaciones + work_item_publicaciones).
 *
 * Iteration 7 — the route independent of fijación anchors: it anchors on the
 * hearing date itself, so it is explicitly exempt from the samai_estados
 * fijación guard and runs for ALL sources.
 *
 * Pure module — no I/O. Mirrored in SQL by
 * `public.extract_provider_hearing(text, text, date)`; keep both in sync.
 */

export interface ProviderHearingCandidate {
  /** YYYY-MM-DD (America/Bogota wall clock) */
  hearing_date: string;
  /** HH:MM 24h, or null when the text carries no time */
  hora: string | null;
  /** matched snippet, <= 160 chars */
  fuente_texto: string;
}

const MONTHS: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10,
  NOVIEMBRE: 11, DICIEMBRE: 12,
};

const HEARING_GATE = /AUDIENCIA|DILIGENCIA|EV[- ]?INICIAL/;

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Upper-cased, accent-free, whitespace-collapsed. */
export function normalizeHearingText(s: string | null | undefined): string {
  return stripAccents(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** Today in America/Bogota as YYYY-MM-DD. */
export function bogotaToday(now: Date = new Date()): string {
  return new Date(now.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

function iso(y: number, m: number, d: number): string | null {
  if (!m || m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normTime(raw: string | undefined, meridiem: string | undefined): string | null {
  if (!raw) return null;
  const [hRaw, mRaw] = raw.replace(".", ":").split(":");
  let hh = parseInt(hRaw, 10);
  const mm = parseInt(mRaw, 10);
  if (isNaN(hh) || isNaN(mm) || mm > 59) return null;
  const mer = (meridiem ?? "").replace(/[.\s]/g, "").toUpperCase();
  if (mer === "PM" && hh < 12) hh += 12;
  if (mer === "AM" && hh === 12) hh = 0;
  if (hh > 23) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function snippet(text: string, matched: string): string {
  const idx = Math.max(0, text.indexOf(matched));
  const start = Math.max(0, idx - 30);
  return text.slice(start, start + 160).trim();
}

/**
 * Extract a FUTURE hearing date from provider text.
 *
 * @param title      row title / act_type
 * @param annotation row annotation / description
 * @param today      YYYY-MM-DD reference date (Bogotá); defaults to today
 */
export function extractProviderHearing(
  title: string | null | undefined,
  annotation: string | null | undefined,
  today: string = bogotaToday(),
): ProviderHearingCandidate | null {
  const text = normalizeHearingText(`${title ?? ""} ${annotation ?? ""}`);
  if (!text || !HEARING_GATE.test(text)) return null;

  const currentYear = parseInt(today.slice(0, 4), 10);

  // Pattern 1 — "PARA EL 24 DE AGOSTO DE 2026 A LAS 8:30 AM"
  const p1 = text.match(
    /PARA EL (?:DIA )?(\d{1,2})\s+DE\s+([A-Z]+)\s+DE\s+(\d{4})(?:.{0,40}?(\d{1,2}[:.]\d{2})\s*(A\.?\s?M\.?|P\.?\s?M\.?)?)?/,
  );
  if (p1) {
    const date = iso(parseInt(p1[3], 10), MONTHS[p1[2]], parseInt(p1[1], 10));
    if (date && date >= today) {
      return { hearing_date: date, hora: normTime(p1[4], p1[5]), fuente_texto: snippet(text, p1[0]) };
    }
  }

  // Pattern 2 — "AUDIENCIA ... EL DIA 24 DE AGOSTO [DE 2026]" (year optional)
  const p2 = text.match(
    /AUDIENCIA[^.]{0,80}?EL\s+(?:DIA\s+)?(\d{1,2})\s+DE\s+([A-Z]+)(?:\s+DE\s+(\d{4}))?/,
  );
  if (p2) {
    const m = MONTHS[p2[2]];
    const d = parseInt(p2[1], 10);
    if (m) {
      const years = p2[3] ? [parseInt(p2[3], 10)] : [currentYear, currentYear + 1];
      for (const y of years) {
        const date = iso(y, m, d);
        if (date && date >= today) {
          const t = text.slice(text.indexOf(p2[0])).match(/(\d{1,2}[:.]\d{2})\s*(A\.?\s?M\.?|P\.?\s?M\.?)?/);
          return {
            hearing_date: date,
            hora: t ? normTime(t[1], t[2]) : null,
            fuente_texto: snippet(text, p2[0]),
          };
        }
      }
    }
  }

  // Pattern 3 — DD/MM/YYYY, only inside audiencia context (gate already applied)
  const p3 = text.match(
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:.{0,30}?(\d{1,2}[:.]\d{2})\s*(A\.?\s?M\.?|P\.?\s?M\.?)?)?/,
  );
  if (p3) {
    const date = iso(parseInt(p3[3], 10), parseInt(p3[2], 10), parseInt(p3[1], 10));
    if (date && date >= today) {
      return { hearing_date: date, hora: normTime(p3[4], p3[5]), fuente_texto: snippet(text, p3[0]) };
    }
  }

  return null;
}
