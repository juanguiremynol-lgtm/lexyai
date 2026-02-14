/**
 * Safe Event Catalog — Single source of truth
 *
 * Every analytics event MUST be defined here with its name,
 * allowed properties, and optional validators.
 *
 * Properties not listed per-event fall back to DEFAULT_ALLOWED_PROPERTIES.
 * This catalog is the CONTRACT between product code and the analytics wrapper.
 */

// ── Event Names (string literals for type safety) ────────────────────

export const ANALYTICS_EVENTS = {
  // Auth
  AUTH_LOGIN_SUCCESS: "auth_login_success",
  AUTH_LOGIN_FAILURE: "auth_login_failure",
  AUTH_LOGOUT: "auth_logout",
  AUTH_PASSWORD_RESET: "auth_password_reset",

  // Navigation
  PAGE_VIEW: "page_view",

  // Matter lifecycle
  MATTER_CREATED: "matter_created",
  MATTER_ARCHIVED: "matter_archived",
  MATTER_STAGE_CHANGED: "matter_stage_changed",

  // Documents
  DOCUMENT_UPLOADED: "document_uploaded",
  DOCUMENT_DOWNLOADED: "document_downloaded",
  DOCUMENT_DELETED: "document_deleted",

  // Deadlines
  DEADLINE_COMPUTED: "deadline_computed",
  DEADLINE_ACKNOWLEDGED: "deadline_acknowledged",

  // Sync / Monitoring
  SYNC_TRIGGERED: "sync_triggered",
  SYNC_COMPLETED: "sync_completed",

  // Alerts
  ALERT_FIRED: "alert_fired",
  ALERT_DISMISSED: "alert_dismissed",

  // AI Assistant
  ASSISTANT_SESSION_START: "assistant_session_start",
  ASSISTANT_ACTION_EXECUTED: "assistant_action_executed",

  // Settings
  SETTINGS_CHANGED: "settings_changed",

  // Exports
  EXPORT_GENERATED: "export_generated",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

// ── Per-Event Allowed Properties ─────────────────────────────────────
// Properties listed here are IN ADDITION to the global DEFAULT_ALLOWED_PROPERTIES.
// If an event is not listed, only global defaults are allowed.

export const EVENT_PROPERTIES: Record<string, string[]> = {
  [ANALYTICS_EVENTS.MATTER_STAGE_CHANGED]: ["from_stage", "to_stage"],
  [ANALYTICS_EVENTS.DOCUMENT_UPLOADED]: ["file_type_category", "size_bucket"],
  [ANALYTICS_EVENTS.DOCUMENT_DOWNLOADED]: ["file_type_category", "size_bucket"],
  [ANALYTICS_EVENTS.DEADLINE_COMPUTED]: ["days_offset", "matter_type"],
  [ANALYTICS_EVENTS.SYNC_COMPLETED]: ["count", "latency_ms", "source_type"],
  [ANALYTICS_EVENTS.EXPORT_GENERATED]: ["export_type", "count"],
  [ANALYTICS_EVENTS.ALERT_FIRED]: ["rule_type"],
  [ANALYTICS_EVENTS.ASSISTANT_ACTION_EXECUTED]: ["action", "status_code"],
  [ANALYTICS_EVENTS.AUTH_LOGIN_FAILURE]: ["status_code"],
};

// ── Property Validators / Normalizers ────────────────────────────────

/**
 * Normalize file size to privacy-safe buckets.
 * Never send exact byte counts.
 */
export function toSizeBucket(bytes: number): string {
  if (bytes < 100_000) return "<100KB";
  if (bytes < 1_000_000) return "100KB-1MB";
  if (bytes < 10_000_000) return "1MB-10MB";
  if (bytes < 100_000_000) return "10MB-100MB";
  return ">100MB";
}

/**
 * Normalize latency to integer milliseconds (no decimals).
 */
export function toLatencyMs(ms: number): number {
  return Math.round(Math.max(0, ms));
}

/**
 * Normalize file extension to a safe category.
 * Never send the actual filename.
 */
export function toFileTypeCategory(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const categories: Record<string, string> = {
    pdf: "document",
    doc: "document",
    docx: "document",
    xls: "spreadsheet",
    xlsx: "spreadsheet",
    csv: "spreadsheet",
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    webp: "image",
    mp4: "video",
    mov: "video",
    mp3: "audio",
    wav: "audio",
    zip: "archive",
    rar: "archive",
  };
  return categories[ext] ?? "other";
}

/**
 * Strip query params and hash from route for safe page view tracking.
 * Only the path is sent; never query params (may contain search terms, IDs, etc.)
 */
export function toSafeRoute(fullPath: string): string {
  try {
    const url = new URL(fullPath, "https://placeholder.local");
    return url.pathname;
  } catch {
    // Fallback: strip everything after ? or #
    return fullPath.split(/[?#]/)[0];
  }
}
