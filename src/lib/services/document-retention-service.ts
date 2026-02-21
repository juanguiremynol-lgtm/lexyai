/**
 * Document Retention Enforcement Service
 *
 * Checks whether a document (or its parent work item) can be deleted
 * based on retention policies. Finalized documents within retention
 * period block deletion unless force-override is provided by org admin.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface RetentionCheckResult {
  canDelete: boolean;
  blockedDocuments?: Array<{
    id: string;
    title: string;
    retention_expires_at: string;
    retention_years: number;
  }>;
  reason?: string;
}

/**
 * Checks if a work item has any finalized documents still within their
 * retention period. If so, soft-delete should be blocked.
 */
export async function checkWorkItemRetention(
  supabase: SupabaseClient,
  workItemId: string,
): Promise<RetentionCheckResult> {
  const { data: docs, error } = await supabase
    .from("generated_documents")
    .select("id, title, retention_expires_at, retention_years, status, deleted_at")
    .eq("work_item_id", workItemId)
    .is("deleted_at", null)
    .not("finalized_at", "is", null);

  if (error) {
    console.error("[retention-check] Error:", error.message);
    return { canDelete: true }; // fail-open to avoid blocking operations on DB errors
  }

  if (!docs || docs.length === 0) return { canDelete: true };

  const now = new Date();
  const blocked = docs.filter(
    (d) => d.retention_expires_at && new Date(d.retention_expires_at) > now
  );

  if (blocked.length === 0) return { canDelete: true };

  return {
    canDelete: false,
    blockedDocuments: blocked.map((d) => ({
      id: d.id,
      title: d.title,
      retention_expires_at: d.retention_expires_at!,
      retention_years: d.retention_years ?? 10,
    })),
    reason: `${blocked.length} documento(s) finalizado(s) aún dentro del periodo de retención legal. El más lejano vence el ${new Date(
      Math.max(...blocked.map((d) => new Date(d.retention_expires_at!).getTime()))
    ).toLocaleDateString("es-CO")}.`,
  };
}

/**
 * Checks if a specific document can be deleted.
 */
export async function checkDocumentRetention(
  supabase: SupabaseClient,
  documentId: string,
): Promise<RetentionCheckResult> {
  const { data: doc, error } = await supabase
    .from("generated_documents")
    .select("id, title, retention_expires_at, retention_years, finalized_at, deleted_at")
    .eq("id", documentId)
    .single();

  if (error || !doc) return { canDelete: true };
  if (doc.deleted_at) return { canDelete: false, reason: "Este documento ya fue eliminado." };
  if (!doc.finalized_at) return { canDelete: true }; // drafts can always be deleted

  if (doc.retention_expires_at && new Date(doc.retention_expires_at) > new Date()) {
    return {
      canDelete: false,
      blockedDocuments: [{
        id: doc.id,
        title: doc.title,
        retention_expires_at: doc.retention_expires_at,
        retention_years: doc.retention_years ?? 10,
      }],
      reason: `Este documento está dentro del periodo de retención legal (${doc.retention_years ?? 10} años). Vence el ${new Date(doc.retention_expires_at).toLocaleDateString("es-CO")}.`,
    };
  }

  return { canDelete: true };
}
