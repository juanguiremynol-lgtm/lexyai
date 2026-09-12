/**
 * declaredOutcomes — LT2. The outcome values that DECIDE.
 *
 * Ninety-seven distinct result strings are produced by the code; most are
 * written once and read by a human, and those stay undeclared — they are
 * documentation. These are the ones a branch, a retry rule, an alert or a
 * membership test compares, which makes them a vocabulary.
 *
 * Mirrored in `sync_vocabulary` (domain `outcome`) with the SAME CASE.
 * `src/test/lt3-declared-outcomes.test.ts` fails the build when the code
 * decides on a value that is absent here.
 */
export const DECLARED_OUTCOMES = [
  "AUTH_FAILED",
  "CONNECTED",
  "CPNU_SYNC_FAILED",
  "DB_CONSTRAINT",
  "DB_WRITE_FAILED",
  "FAILED",
  "FORBIDDEN",
  "INVALID_JSON_RESPONSE",
  "MAPPING_SPEC_MISSING",
  "MISSING_PLATFORM_INSTANCE",
  "NOT_FOUND",
  "PARSER_ERROR",
  "PENDING_UPSTREAM",
  "PROVIDER_404",
  "PROVIDER_EMPTY_RESULT",
  "PROVIDER_ERROR",
  "PROVIDER_NO_DOCUMENT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TIMEOUT",
  "PUB_RETRY",
  "RATE_LIMITED",
  "READ_FAILURE",
  "RECORD_NOT_FOUND",
  "SCRAPING_STUCK",
  "SCRAPING_TIMEOUT",
  "SKIPPED",
  "SOURCE_RETENTION_EXPIRED",
  "SUCCESS_EMPTY",
  "SUCCESS_WITH_DATA",
  "SYNC_FAILED",
  "TIMEOUT",
  "TRANSFER_FAILED",
  "UNAUTHORIZED",
  "UPSTREAM_AUTH",
  "UPSTREAM_ROUTE_MISSING",
  "WARN",
] as const;
