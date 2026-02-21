/**
 * Document Share Policy — Thin adapter over the central document-policy layer.
 * Kept for backward-compatibility with existing imports.
 * New code should import from `@/lib/document-policy` directly.
 */

import {
  type DocumentPolicyType,
  getDocumentPolicy,
  isLinkChannelAllowed,
} from "@/lib/document-policy";

export type ShareChannel = "email" | "link";
export type ShareMode = "EMAIL_ONLY" | "EMAIL_AND_LINK";
export type DeliveryMethod = "EMAIL" | "LINK";

export interface DocumentSharePolicy {
  mode: ShareMode;
  allowedChannels: ShareChannel[];
  reason?: string;
}

/**
 * Returns the share policy for a given document type,
 * derived from the central document-policy layer.
 */
export function getDocumentSharePolicy(docType: string): DocumentSharePolicy {
  try {
    const policy = getDocumentPolicy(docType as DocumentPolicyType);
    const linkAllowed = policy.initiationChannels.includes("SIGNING_LINK");
    return {
      mode: linkAllowed ? "EMAIL_AND_LINK" : "EMAIL_ONLY",
      allowedChannels: linkAllowed ? ["email", "link"] : ["email"],
      reason: policy.distribution.description_es,
    };
  } catch {
    // Unknown doc type — default to email only for safety
    return {
      mode: "EMAIL_ONLY",
      allowedChannels: ["email"],
    };
  }
}

/**
 * Whether link copying/sharing is allowed for the given doc type.
 */
export function isLinkSharingAllowed(docType: string): boolean {
  try {
    return isLinkChannelAllowed(docType as DocumentPolicyType);
  } catch {
    return false;
  }
}
