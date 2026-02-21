/**
 * Document Share Policy — Defines allowed sharing channels per document type.
 * POA supports both EMAIL and LINK (signing link for WhatsApp/messenger sharing).
 */

export type ShareChannel = "email" | "link";
export type ShareMode = "EMAIL_ONLY" | "EMAIL_AND_LINK";
export type DeliveryMethod = "EMAIL" | "LINK";

export interface DocumentSharePolicy {
  mode: ShareMode;
  allowedChannels: ShareChannel[];
  reason?: string;
}

const POLICY_MAP: Record<string, DocumentSharePolicy> = {
  // POA supports both email and link initiation
  poder_especial: {
    mode: "EMAIL_AND_LINK",
    allowedChannels: ["email", "link"],
    reason: "Los poderes especiales pueden compartirse por correo o enlace de firma. La trazabilidad se garantiza en ambos canales.",
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
