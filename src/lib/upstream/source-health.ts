/**
 * source-health.ts — ITER46. App-side mirror of the derivation used by
 * `ingest-source-health`. `/salud/source-health` does not exist upstream (404
 * on the route), so per-source health is derived from `/radicados`. Each source
 * is judged only on the matters enrolled in it, and NOT_FOUND / SUCCESS_EMPTY
 * are determinations, not failures.
 */
const SUCCESSFUL = new Set(["SUCCESS", "SUCCESS_EMPTY", "NOT_FOUND", "OK"]);

/** LIVE STATE WINS — exported so the parity test can assert the rule directly. */
export function normalizeStreak(status: string, reconstructed: number): number {
  return SUCCESSFUL.has((status ?? "").toUpperCase()) ? 0 : Math.max(reconstructed ?? 0, 0);
}

export interface DerivedSourceHealth {
  source: string;
  branch: string;
  status: string;
  last_success_at: string | null;
  consecutive_errors: number;
  consecutive_empty_runs: number;
  parsed_rows: number;
  last_error_message: string | null;
}

const SOURCES = [
  { key: "cpnu", flag: "en_cpnu", state: "cpnu_estado", rows: "cpnu_total_actuaciones", at: "cpnu_last_run_at" },
  { key: "publicaciones", flag: "en_pp", state: "pp_estado", rows: "pp_total_actuaciones", at: "pp_last_run_at" },
  { key: "samai", flag: "en_samai", state: "samai_estado", rows: "samai_total_actuaciones", at: "samai_last_run_at" },
  { key: "samai_estados", flag: "en_samai_estados", state: "samai_estados_estado", rows: "samai_estados_total", at: "samai_estados_last_run_at" },
] as const;

/**
 * A source is only judged on the radicados actually ENROLLED in it. Judging
 * SAMAI on CGP matters would report a permanent outage that does not exist.
 */
export function deriveSourceHealth(
  inventory: Array<Record<string, unknown>>,
): DerivedSourceHealth[] {
  const out: DerivedSourceHealth[] = [];

  for (const src of SOURCES) {
    const enrolled = inventory.filter((r) => r[src.flag] === true);
    if (enrolled.length === 0) continue;

    const states = enrolled.map((r) => String(r[src.state] ?? "").toUpperCase());
    const ok = states.filter((s) => SUCCESSFUL.has(s)).length;
    const unread = states.filter((s) => !s || s === "NULL").length;
    const errored = states.length - ok - unread;

    const times = enrolled
      .map((r) => (typeof r[src.at] === "string" ? Date.parse(r[src.at] as string) : NaN))
      .filter((n) => Number.isFinite(n)) as number[];
    const lastSuccessAt = times.length ? new Date(Math.max(...times)).toISOString() : null;

    // Never read at all is not the same as failing; both are "no lectura".
    const status = errored > 0 ? "DEGRADED" : ok > 0 ? "SUCCESS" : "SIN_LECTURA";

    out.push({
      source: src.key,
      branch: "ALL",
      status,
      last_success_at: lastSuccessAt,
      consecutive_errors: normalizeStreak(status, errored),
      consecutive_empty_runs: unread,
      parsed_rows: enrolled.reduce(
        (n, r) => n + (typeof r[src.rows] === "number" ? (r[src.rows] as number) : 0), 0),
      last_error_message:
        status === "SUCCESS"
          ? null
          : `${errored} con error y ${unread} sin lectura de ${enrolled.length} radicados inscritos en la fuente.`,
    });
  }

  return out;
}

