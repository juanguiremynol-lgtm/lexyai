/**
 * syncTimelineVerdict — pure rules for what a work_item_sync_timeline row may
 * assert. A row is a VERIFIED success only when it names the real source(s)
 * actually attempted and carries no error code. Anything else is persisted
 * with its evidence but never as success/empty.
 */
import { isProviderAttributable } from "./syncVocabulary.ts";

type Status = "success" | "error" | "empty" | "skipped" | "partial" | "pending_upstream" | "rejected" | "deduplicated";

const SUCCESS_CODES = new Set(["SUCCESS", "SUCCESS_WITH_DATA", "SUCCESS_EMPTY", "OK", "NO_DATA"]);

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** Real failure cause from a function response; success result codes are never causes. */
export function responseCause(parsed: Record<string, unknown> | null | undefined): string | null {
  if (!parsed) return null;
  const notSuccess = (v: unknown) => { const s = str(v); return s && !SUCCESS_CODES.has(s.toUpperCase()) ? s : null; };
  const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
  const firstError = errors.length
    ? (typeof errors[0] === "object" && errors[0] !== null ? str((errors[0] as Record<string, unknown>).code) : null)
    : null;
  return str(parsed.error_code) ?? notSuccess(parsed.code) ?? notSuccess(parsed.result_code) ??
    str(parsed.reason) ?? str(parsed.failure_reason) ?? firstError;
}

export interface VerdictInput { status: Status; providers: string[]; error_code: string | null | undefined }
export interface VerdictOutput { status: Status; error_code: string | null; downgraded_from: Status | null }

/** Invariant: success/empty ⇒ fully attributable provider AND null error_code. */
export function enforceVerifiedOutcome(input: VerdictInput): VerdictOutput {
  const attributable = isProviderAttributable(input.providers);
  const code = input.error_code ?? null;
  if (input.status === "success" || input.status === "empty") {
    if (!attributable) return { status: "skipped", error_code: code ?? "PROVIDER_UNRESOLVED", downgraded_from: input.status };
    if (code) return { status: "partial", error_code: code, downgraded_from: input.status };
    return { status: input.status, error_code: null, downgraded_from: null };
  }
  return {
    status: input.status,
    error_code: code ?? (input.providers.includes("unknown") ? "PROVIDER_UNRESOLVED" : null),
    downgraded_from: null,
  };
}

/** Attempt-based attribution: only sources actually contacted are named. */
export function attributeAttemptedProviders(attempts: { publicaciones?: boolean; samai_estados?: boolean }): string | undefined {
  const names = [attempts.publicaciones ? "publicaciones" : null, attempts.samai_estados ? "samai_estados" : null]
    .filter((v): v is string => !!v);
  return names.length ? names.join("+") : undefined;
}
