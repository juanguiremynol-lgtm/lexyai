/**
 * Feature flags — kill switches for capabilities that are built but not
 * authorized for use.
 */

/**
 * Outbound email from the user's own Outlook mailbox (Microsoft Graph
 * `Mail.Send`).
 *
 * DISABLED BY DECISION: the ratified design principle for the Outlook
 * integration is read-only ("Mail.Read, jamás Mail.Send"). The code stays in
 * the repository but every entry point — UI and backend — is blocked until the
 * capability is explicitly approved with its own controls (per-send manual
 * confirmation, recipient allow-list of verified judicial domains, immutable
 * audit log).
 */
export const OUTLOOK_SEND_ENABLED = false;
