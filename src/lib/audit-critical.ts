/**
 * Audit Critical Actions Utility
 * 
 * Defines which audit actions are considered critical and require
 * admin notifications or special handling.
 */

import type { AuditAction } from "./audit-log";

/**
 * Set of critical audit actions that trigger admin notifications
 */
export const CRITICAL_AUDIT_ACTIONS = new Set<string>([
  // DB Trigger Events (most critical)
  "DB_MEMBERSHIP_DELETED",
  "DB_MEMBERSHIP_UPDATED",
  "DB_MEMBERSHIP_INSERTED",
  "DB_SUBSCRIPTION_UPDATED",
  "DB_EMAIL_STATUS_CHANGED",
  
  // Membership Actions
  "MEMBERSHIP_REMOVED",
  "MEMBERSHIP_ROLE_CHANGED",
  "OWNERSHIP_TRANSFERRED",
  
  // Subscription Actions
  "SUBSCRIPTION_SUSPENDED",
  "SUBSCRIPTION_EXPIRED",
  
  // Security Actions
  "SECURITY_SETTINGS_UPDATED",
  
  // Data Lifecycle Actions
  "RECYCLE_BIN_PURGED",
  "DATA_PURGED",
  "DEMO_DATA_RESET",
  
  // Email Actions (bulk operations)
  "EMAIL_BULK_RETRY",
  "EMAIL_CANCELLED",
]);

/**
 * Actions that should be retained longer (double the normal retention)
 */
export const EXTENDED_RETENTION_ACTIONS = new Set<string>([
  "DB_MEMBERSHIP_DELETED",
  "OWNERSHIP_TRANSFERRED",
  "SUBSCRIPTION_SUSPENDED",
  "SUBSCRIPTION_EXPIRED",
  "RECYCLE_BIN_PURGED",
  "DATA_PURGED",
  "SECURITY_SETTINGS_UPDATED",
]);

/**
 * Severity levels for audit actions
 */
export type AuditSeverity = "CRITICAL" | "HIGH" | "NORMAL";

/**
 * Get the severity level for an audit action
 */
export function getAuditSeverity(action: string): AuditSeverity {
  // Critical severity
  if ([
    "DB_MEMBERSHIP_DELETED",
    "OWNERSHIP_TRANSFERRED",
    "SUBSCRIPTION_SUSPENDED",
    "SUBSCRIPTION_EXPIRED",
    "RECYCLE_BIN_PURGED",
    "DATA_PURGED",
    "SECURITY_SETTINGS_UPDATED",
    "WORK_ITEM_HARD_DELETED",
    "CLIENT_HARD_DELETED",
  ].includes(action)) {
    return "CRITICAL";
  }
  
  // High severity
  if ([
    "DB_MEMBERSHIP_UPDATED",
    "DB_SUBSCRIPTION_UPDATED",
    "MEMBERSHIP_ROLE_CHANGED",
    "MEMBERSHIP_REMOVED",
    "EMAIL_BULK_RETRY",
    "EMAIL_CANCELLED",
    "DEMO_DATA_RESET",
    "WORK_ITEM_SOFT_DELETED",
    "CLIENT_SOFT_DELETED",
  ].includes(action)) {
    return "HIGH";
  }
  
  // Normal severity (default)
  return "NORMAL";
}

/**
 * Check if an action is critical
 */
export function isCriticalAction(action: string): boolean {
  return CRITICAL_AUDIT_ACTIONS.has(action);
}

/**
 * Check if an action requires extended retention
 */
export function requiresExtendedRetention(action: string): boolean {
  return EXTENDED_RETENTION_ACTIONS.has(action);
}

/**
 * Severity badge colors for UI
 */
export const SEVERITY_COLORS: Record<AuditSeverity, { bg: string; text: string; border: string }> = {
  CRITICAL: {
    bg: "bg-red-100 dark:bg-red-950",
    text: "text-red-700 dark:text-red-300",
    border: "border-red-200 dark:border-red-800",
  },
  HIGH: {
    bg: "bg-amber-100 dark:bg-amber-950",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-800",
  },
  NORMAL: {
    bg: "bg-slate-100 dark:bg-slate-900",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-200 dark:border-slate-800",
  },
};

/**
 * Labels for severity levels in Spanish
 */
export const SEVERITY_LABELS: Record<AuditSeverity, string> = {
  CRITICAL: "Crítico",
  HIGH: "Alto",
  NORMAL: "Normal",
};
