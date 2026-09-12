/**
 * outcome-literals — LT3. The instrument that catches an UNDECLARED value.
 *
 * A list-auditor compares a declared list against its uses and can only find an
 * INCOMPLETE declaration. It cannot find a value that was never declared at
 * all — which is how `SOURCE_RETENTION_EXPIRED` reached production as a
 * terminal outcome no vocabulary knew about.
 *
 * The shape that catches it is the inverse: start from the code, not from the
 * declaration. Collect every literal the code ASSIGNS to an outcome column
 * (`error_code`, `result_code`, `last_error`), keep only those the code also
 * BRANCHES on — a value only written and read by a human is documentation, a
 * value compared in a branch is a vocabulary — and diff that set against
 * `sync_vocabulary`, case-sensitively.
 */

/** Columns whose values are outcomes, not free text. */
export const OUTCOME_FIELDS = ["error_code", "result_code", "last_error"] as const;

const OUTCOME_FIELD_RE = new RegExp(
  `(?:${OUTCOME_FIELDS.join("|")})\\s*(?::|=|==|===|!==)\\s*['"\`]([A-Z][A-Z0-9_]{2,})['"\`]`,
  "g",
);

/** Same field, value supplied through a ternary / `??` chain on the same line. */
const OUTCOME_LINE_RE = new RegExp(`(?:${OUTCOME_FIELDS.join("|")})\\s*[:=]`);
const UPPER_LITERAL_RE = /['"`]([A-Z][A-Z0-9_]{2,})['"`]/g;

/** A literal the code decides on: comparison, switch case, or membership test. */
const COMPARISON_RES = [
  /[=!]==?\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]/g,
  /['"`]([A-Z][A-Z0-9_]{2,})['"`]\s*[=!]==?/g,
  /case\s+['"`]([A-Z][A-Z0-9_]{2,})['"`]/g,
  /includes\(\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]/g,
  /\bIN\s*\(\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]/gi,
];

/** Literals that are not outcomes even though they are shaped like one. */
const NOT_OUTCOMES = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD",
  "UTC", "JSON", "HTML", "TEXT", "NULL", "TRUE", "FALSE",
  "ACTUACIONES", "ESTADOS", "SUCCESS", "ERROR",
]);

function collect(re: RegExp, source: string, into: Set<string>) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) into.add(m[1]);
}

export interface OutcomeScan {
  /** Literals assigned to an outcome column anywhere in the scanned sources. */
  assigned: Set<string>;
  /** Literals the code branches on. */
  compared: Set<string>;
  /** Assigned AND compared — these decide, and must be declared. */
  deciding: string[];
}

export function scanOutcomeLiterals(sources: string[]): OutcomeScan {
  const assigned = new Set<string>();
  const compared = new Set<string>();

  for (const src of sources) {
    collect(OUTCOME_FIELD_RE, src, assigned);
    for (const line of src.split("\n")) {
      if (OUTCOME_LINE_RE.test(line)) collect(UPPER_LITERAL_RE, line, assigned);
    }
    for (const re of COMPARISON_RES) collect(re, src, compared);
  }

  const deciding = [...assigned]
    .filter((v) => !NOT_OUTCOMES.has(v) && compared.has(v))
    .sort();

  return { assigned, compared, deciding };
}

/** Case-sensitive diff. `pending_upstream` does NOT declare `PENDING_UPSTREAM`. */
export function undeclaredOutcomes(deciding: string[], declared: string[]): string[] {
  const set = new Set(declared);
  return deciding.filter((v) => !set.has(v)).sort();
}
