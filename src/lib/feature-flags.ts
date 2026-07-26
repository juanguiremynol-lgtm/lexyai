/**
 * Feature flags — kill switches for capabilities that are built but not
 * authorized for use.
 */

/**
 * Outbound email from the user's own Outlook mailbox (Microsoft Graph
 * `Mail.Send`).
 *
 * ENABLED BY EXPLICIT DECISION with two mandatory controls:
 *   1. Every send passes through an explicit human confirmation modal that
 *      shows recipients, CC, subject, linked work item and attachments.
 *      There is no programmatic/automated send path — no cron, trigger or
 *      business rule may invoke `outlook-send`.
 *   2. Every attempt (success or failure) is recorded in the append-only
 *      `outlook_send_audit_log`.
 * No recipient allow-list: sending covers general case correspondence.
 */
export const OUTLOOK_SEND_ENABLED = true;
