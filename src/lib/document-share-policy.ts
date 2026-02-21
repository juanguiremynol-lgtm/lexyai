/**
 * Document Share Policy — Defines allowed sharing channels per document type.
 * POAs are EMAIL_ONLY (no public links / WhatsApp sharing).
 */

export type ShareChannel = "email" | "link";
export type ShareMode = "EMAIL_ONLY" | "EMAIL_AND_LINK";

export interface DocumentSharePolicy {
  mode: ShareMode;
  allowedChannels: ShareChannel[];
  reason?: string;
}

const POLICY_MAP: Record<string, DocumentSharePolicy> = {
  poder_especial: {
    mode: "EMAIL_ONLY",
    allowedChannels: ["email"],
    reason: "Los poderes especiales requieren trazabilidad completa y solo pueden compartirse por correo electrónico.",
  },
};

const DEFAULT_POLICY: DocumentSharePolicy = {
  mode: "EMAIL_AND_LINK",
  allowedChannels: ["email", "link"],
};

/**
 * Returns the share policy for a given document type.
 */
export function getDocumentSharePolicy(docType: string): DocumentSharePolicy {
  return POLICY_MAP[docType] || DEFAULT_POLICY;
}

/**
 * Whether link copying/sharing is allowed for the given doc type.
 */
export function isLinkSharingAllowed(docType: string): boolean {
  return getDocumentSharePolicy(docType).allowedChannels.includes("link");
}
