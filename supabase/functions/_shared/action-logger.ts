/**
 * action-logger.ts — Durable audit trail for all Atenia AI autonomous actions
 *
 * Every autonomous action MUST call logAction(). No exceptions.
 * Secrets are redacted from input_snapshot before persistence.
 */

export interface ActionLogEntry {
  action_type: string;
  actor?: string; // AI_AUTOPILOT | AI_WATCHDOG | ADMIN | SYSTEM
  actor_user_id?: string;
  scope?: string; // PLATFORM | ORG
  organization_id?: string;
  work_item_id?: string;
  provider?: string;
  workflow_type?: string;
  input_snapshot?: Record<string, unknown>;
  reasoning: string; // Spanish, human-readable
  reason_code?: string;
  status?: string; // PLANNED | EXECUTED | SKIPPED | FAILED | APPROVED | EXPIRED
  action_result?: string;
  action_taken?: string;
  autonomy_tier?: string;
  reversible?: boolean;
  is_reversible?: boolean;
  expires_at?: string;
  evidence?: Record<string, unknown>;
  target_entity_type?: string;
  target_entity_id?: string;
}

const SENSITIVE_KEYS = [
  "key",
  "secret",
  "token",
  "password",
  "authorization",
  "cookie",
  "credential",
];

function redactSecrets(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(redacted)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
      redacted[k] = "[REDACTED]";
    } else if (
      typeof redacted[k] === "object" &&
      redacted[k] !== null &&
      !Array.isArray(redacted[k])
    ) {
      redacted[k] = redactSecrets(redacted[k] as Record<string, unknown>);
    }
  }
  return redacted;
}

/**
 * Write an action to the atenia_ai_actions audit table.
 * Returns the generated action ID.
 */
export async function logAction(
  supabase: any,
  action: ActionLogEntry,
): Promise<string | null> {
  try {
    const sanitizedSnapshot = action.input_snapshot
      ? redactSecrets(action.input_snapshot)
      : {};

    const row: Record<string, unknown> = {
      action_type: action.action_type,
      actor: action.actor ?? "AI_AUTOPILOT",
      actor_user_id: action.actor_user_id ?? null,
      scope: action.scope ?? "ORG",
      organization_id: action.organization_id ?? null,
      work_item_id: action.work_item_id ?? null,
      provider: action.provider ?? null,
      workflow_type: action.workflow_type ?? null,
      input_snapshot: sanitizedSnapshot,
      reasoning: action.reasoning,
      reason_code: action.reason_code ?? null,
      status: action.status ?? "EXECUTED",
      action_result: action.action_result ?? "applied",
      action_taken: action.action_taken ?? null,
      autonomy_tier: action.autonomy_tier ?? "ACT",
      is_reversible: action.is_reversible ?? action.reversible ?? true,
      reversible: action.reversible ?? true,
      expires_at: action.expires_at ?? null,
      evidence: action.evidence ?? {},
      target_entity_type: action.target_entity_type ?? null,
      target_entity_id: action.target_entity_id ?? null,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("atenia_ai_actions")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.warn("[action-logger] Insert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.warn("[action-logger] Unexpected error:", err);
    return null;
  }
}
