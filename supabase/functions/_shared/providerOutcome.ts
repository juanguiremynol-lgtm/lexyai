export type PersistedProviderOutcome =
  | "RUN_SUCCESS_WITH_DATA"
  | "RUN_SUCCESS_EMPTY"
  | "RUN_SUCCESS_NOT_FOUND"
  | "RUN_FAILED"
  | "SOURCE_STALE"
  | "PENDING_UPSTREAM"
  | "SCRAPING_INITIATED"
  | "PROCESO_PRIVADO";

export function persistedProviderOutcome(input: {
  status?: string | null;
  resultCode?: string | null;
  errorCode?: string | null;
  insertedCount?: number | null;
}): PersistedProviderOutcome {
  const signal = String(input.resultCode ?? input.errorCode ?? "").toUpperCase();
  if (signal === "PENDING_UPSTREAM" || signal === "NO_DATA") return "PENDING_UPSTREAM";
  if (signal === "SCRAPING_INITIATED") return "SCRAPING_INITIATED";
  if (signal === "PROCESO_PRIVADO") return "PROCESO_PRIVADO";
  if (["NOT_FOUND", "PROVIDER_NOT_FOUND", "RADICADO_NOT_FOUND"].includes(signal)) return "RUN_SUCCESS_NOT_FOUND";
  const status = String(input.status ?? "").toLowerCase();
  if (["error", "failed", "timeout", "unavailable"].includes(status)) return "RUN_FAILED";
  if ((input.insertedCount ?? 0) > 0 || signal === "SUCCESS_WITH_DATA") return "RUN_SUCCESS_WITH_DATA";
  if (["empty", "success"].includes(status) || signal === "SUCCESS_EMPTY") return "RUN_SUCCESS_EMPTY";
  return "RUN_FAILED";
}