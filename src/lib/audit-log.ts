/**
 * Audit Log Service
 * 
 * Provides centralized, non-blocking audit logging for all system events.
 * Logs are immutable and org-scoped for compliance and debugging.
 */

import { supabase } from "@/integrations/supabase/client";

export type AuditAction =
  // Work Item Actions
  | "WORK_ITEM_CREATED"
  | "WORK_ITEM_UPDATED"
  | "WORK_ITEM_STAGE_CHANGED"
  | "WORK_ITEM_CLIENT_LINKED"
  | "WORK_ITEM_SOFT_DELETED"
  | "WORK_ITEM_RESTORED"
  | "WORK_ITEM_HARD_DELETED"
  // Client Actions
  | "CLIENT_CREATED"
  | "CLIENT_UPDATED"
  | "CLIENT_SOFT_DELETED"
  | "CLIENT_RESTORED"
  | "CLIENT_HARD_DELETED"
  // Hearing Actions
  | "HEARING_CREATED"
  | "HEARING_UPDATED"
  | "HEARING_DELETED"
  // Alert Actions
  | "ALERT_CREATED"
  | "ALERT_ACKNOWLEDGED"
  | "ALERT_RESOLVED"
  // Task Actions
  | "TASK_CREATED"
  | "TASK_COMPLETED"
  | "TASK_DELETED"
  // Membership Actions
  | "MEMBERSHIP_ROLE_CHANGED"
  | "MEMBERSHIP_REMOVED"
  // Invite Actions
  | "INVITE_SENT"
  | "INVITE_RESENT"
  | "INVITE_REVOKED"
  | "INVITE_ACCEPTED"
  | "INVITE_EXPIRED"
  // Email Actions
  | "EMAIL_QUEUED"
  | "EMAIL_SENT"
  | "EMAIL_FAILED"
  | "EMAIL_SUPPRESSED"
  // Subscription Actions
  | "TRIAL_STARTED"
  | "TRIAL_EXTENDED"
  | "SUBSCRIPTION_ACTIVATED"
  | "SUBSCRIPTION_SUSPENDED"
  | "SUBSCRIPTION_EXPIRED"
  // Import Actions
  | "IMPORT_STARTED"
  | "IMPORT_COMPLETED"
  | "IMPORT_FAILED"
  // Generic
  | "GENERIC_ACTION";

export type EntityType =
  | "work_item"
  | "client"
  | "alert"
  | "task"
  | "hearing"
  | "process_event"
  | "membership"
  | "invite"
  | "email_outbox"
  | "subscription"
  | "import"
  | "organization";

export interface AuditLogParams {
  organizationId: string;
  action: AuditAction;
  entityType: EntityType;
  entityId?: string;
  metadata?: Record<string, unknown>;
  actorUserId?: string;
  actorType?: "USER" | "SYSTEM";
}

/**
 * Logs an audit event to the database.
 * 
 * This function is designed to be non-blocking and fail-safe:
 * - Errors are logged to console but do not throw
 * - The main user action should never fail due to audit logging
 * 
 * @param params - The audit log parameters
 * @returns Promise<boolean> - true if logged successfully, false otherwise
 */
export async function logAudit(params: AuditLogParams): Promise<boolean> {
  const {
    organizationId,
    action,
    entityType,
    entityId,
    metadata = {},
    actorUserId,
    actorType = "USER",
  } = params;

  try {
    // Get current user if not provided
    let userId = actorUserId;
    if (!userId && actorType === "USER") {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id;
    }

    const { error } = await supabase.from("audit_logs").insert({
      organization_id: organizationId,
      actor_user_id: userId || null,
      actor_type: actorType,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
      },
    });

    if (error) {
      console.warn("[AuditLog] Failed to log audit event:", error.message, {
        action,
        entityType,
        entityId,
      });
      return false;
    }

    return true;
  } catch (err) {
    // Never throw - audit logging should be non-blocking
    console.warn("[AuditLog] Exception while logging audit event:", err, {
      action,
      entityType,
      entityId,
    });
    return false;
  }
}

/**
 * Convenience function to log work item stage changes
 */
export async function logStageChange(
  organizationId: string,
  workItemId: string,
  fromStage: string,
  toStage: string,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  return logAudit({
    organizationId,
    action: "WORK_ITEM_STAGE_CHANGED",
    entityType: "work_item",
    entityId: workItemId,
    metadata: {
      from_stage: fromStage,
      to_stage: toStage,
      ...metadata,
    },
  });
}

/**
 * Convenience function to log soft delete actions
 */
export async function logSoftDelete(
  organizationId: string,
  entityType: EntityType,
  entityId: string,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  const actionMap: Record<string, AuditAction> = {
    work_item: "WORK_ITEM_SOFT_DELETED",
    client: "CLIENT_SOFT_DELETED",
  };
  
  return logAudit({
    organizationId,
    action: actionMap[entityType] || "GENERIC_ACTION",
    entityType,
    entityId,
    metadata: {
      action_type: "soft_delete",
      ...metadata,
    },
  });
}

/**
 * Convenience function to log restore actions
 */
export async function logRestore(
  organizationId: string,
  entityType: EntityType,
  entityId: string,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  const actionMap: Record<string, AuditAction> = {
    work_item: "WORK_ITEM_RESTORED",
    client: "CLIENT_RESTORED",
  };
  
  return logAudit({
    organizationId,
    action: actionMap[entityType] || "GENERIC_ACTION",
    entityType,
    entityId,
    metadata: {
      action_type: "restore",
      ...metadata,
    },
  });
}

/**
 * Convenience function to log hard delete actions
 */
export async function logHardDelete(
  organizationId: string,
  entityType: EntityType,
  entityId: string,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  const actionMap: Record<string, AuditAction> = {
    work_item: "WORK_ITEM_HARD_DELETED",
    client: "CLIENT_HARD_DELETED",
  };
  
  return logAudit({
    organizationId,
    action: actionMap[entityType] || "GENERIC_ACTION",
    entityType,
    entityId,
    metadata: {
      action_type: "hard_delete",
      ...metadata,
    },
  });
}

/**
 * Convenience function to log email events
 */
export async function logEmailEvent(
  organizationId: string,
  emailId: string,
  action: "EMAIL_QUEUED" | "EMAIL_SENT" | "EMAIL_FAILED" | "EMAIL_SUPPRESSED",
  metadata?: Record<string, unknown>
): Promise<boolean> {
  return logAudit({
    organizationId,
    action,
    entityType: "email_outbox",
    entityId: emailId,
    actorType: "SYSTEM",
    metadata,
  });
}

/**
 * Convenience function to log invite events
 */
export async function logInviteEvent(
  organizationId: string,
  inviteId: string,
  action: "INVITE_SENT" | "INVITE_RESENT" | "INVITE_REVOKED" | "INVITE_ACCEPTED" | "INVITE_EXPIRED",
  metadata?: Record<string, unknown>
): Promise<boolean> {
  return logAudit({
    organizationId,
    action,
    entityType: "invite",
    entityId: inviteId,
    metadata,
  });
}
