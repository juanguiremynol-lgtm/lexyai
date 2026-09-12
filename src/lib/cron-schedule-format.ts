/**
 * cron-schedule-format — renders a pg_cron expression for humans.
 *
 * LS2 / summary-column rule: the cadence shown in the UI is DERIVED from
 * `cron.job.schedule` (read through `public.cron_job_health()`), never from a
 * hand-kept copy. Bogotá is UTC-5 with no DST, so the conversion is a constant
 * shift and needs no timezone library.
 */

const COT_OFFSET_HOURS = 5;

export interface DescribedSchedule {
  /** Original UTC cron expression, verbatim. */
  utc: string;
  /** Human text in Bogotá time. */
  cot: string;
  /** True when the job runs at one fixed time of day (timeline-eligible). */
  daily: boolean;
  /** Sortable "HH:MM" in COT for daily jobs, else "". */
  cotSortKey: string;
}

function toCot(hour: number, minute: number): string {
  const h = ((hour - COT_OFFSET_HOURS) % 24 + 24) % 24;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function describeSchedule(schedule: string | null | undefined): DescribedSchedule {
  const utc = (schedule ?? "").trim();
  const parts = utc.split(/\s+/);
  if (parts.length !== 5) {
    return { utc, cot: utc || "—", daily: false, cotSortKey: "" };
  }
  const [min, hour] = parts;

  const everyMin = /^\*\/(\d+)$/.exec(min);
  if (hour === "*" && everyMin) {
    return { utc, cot: `Cada ${everyMin[1]} min`, daily: false, cotSortKey: "" };
  }

  const everyHour = /^\*\/(\d+)$/.exec(hour);
  if (everyHour) {
    return { utc, cot: `Cada ${everyHour[1]} horas`, daily: false, cotSortKey: "" };
  }

  if (hour === "*" && /^\d+$/.test(min)) {
    return { utc, cot: `Cada hora (min ${min.padStart(2, "0")})`, daily: false, cotSortKey: "" };
  }

  const range = /^(\d+)-(\d+)$/.exec(hour);
  if (range && /^\d+$/.test(min)) {
    const from = toCot(Number(range[1]), Number(min));
    const to = toCot(Number(range[2]), Number(min));
    return { utc, cot: `Cada hora, ${from}–${to} COT`, daily: false, cotSortKey: "" };
  }

  if (/^\d+$/.test(hour) && /^\d+$/.test(min)) {
    const t = toCot(Number(hour), Number(min));
    return { utc, cot: `${t} COT`, daily: true, cotSortKey: t };
  }

  return { utc, cot: utc, daily: false, cotSortKey: "" };
}
