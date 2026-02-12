/**
 * autonomy-policy.ts — Atenia AI Autonomy Policy enforcement
 *
 * Checks whether a given autonomous action is allowed based on:
 *   1. Global is_enabled flag
 *   2. Action whitelist (allowed_actions)
 *   3. Confirmation requirement (require_confirmation_actions)
 *   4. Hourly + daily budget enforcement
 *   5. Per-target cooldown enforcement
 */

export interface ActionBudget {
  max_per_hour: number;
  max_per_day: number;
}

export interface AutonomyPolicy {
  id: string;
  is_enabled: boolean;
  allowed_actions: string[];
  require_confirmation_actions: string[];
  budgets: Record<string, ActionBudget>;
  cooldowns: Record<string, number>; // minutes
  notify_on_critical: boolean;
  notification_email: string | null;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

/**
 * Load the singleton autonomy policy from DB.
 * Returns a default (disabled) policy if none exists.
 */
export async function loadAutonomyPolicy(supabase: any): Promise<AutonomyPolicy> {
  const { data, error } = await supabase
    .from("atenia_ai_autonomy_policy")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      id: "",
      is_enabled: false,
      allowed_actions: [],
      require_confirmation_actions: [],
      budgets: {},
      cooldowns: {},
      notify_on_critical: true,
      notification_email: null,
    };
  }

  return {
    id: data.id,
    is_enabled: data.is_enabled ?? false,
    allowed_actions: data.allowed_actions ?? [],
    require_confirmation_actions: data.require_confirmation_actions ?? [],
    budgets: data.budgets ?? {},
    cooldowns: data.cooldowns ?? {},
    notify_on_critical: data.notify_on_critical ?? true,
    notification_email: data.notification_email ?? null,
  };
}

/**
 * Check whether a specific autonomous action is permitted.
 *
 * Performs 4 checks in order:
 *   1. Policy enabled
 *   2. Action in allowed_actions
 *   3. Budget (hourly + daily)
 *   4. Cooldown on same target
 *
 * Returns { allowed: true, requiresConfirmation: true } for actions
 * that need admin approval before execution.
 */
export async function canExecuteAction(
  supabase: any,
  actionType: string,
  targetId?: string,
): Promise<PolicyCheckResult> {
  const policy = await loadAutonomyPolicy(supabase);

  // 1. Global kill switch
  if (!policy.is_enabled) {
    return { allowed: false, reason: "AUTONOMY_DISABLED" };
  }

  // 2. Action whitelist
  if (!policy.allowed_actions.includes(actionType)) {
    // Check if it's a confirmation-only action
    if (policy.require_confirmation_actions.includes(actionType)) {
      return { allowed: true, requiresConfirmation: true };
    }
    return { allowed: false, reason: "ACTION_NOT_ALLOWED" };
  }

  // 2b. Check if this action requires confirmation (propose-only)
  if (policy.require_confirmation_actions.includes(actionType)) {
    return { allowed: true, requiresConfirmation: true };
  }

  // 3. Budget enforcement
  const budget: ActionBudget | undefined = policy.budgets[actionType];
  if (budget) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { count: hourCount } = await supabase
      .from("atenia_ai_actions")
      .select("*", { count: "exact", head: true })
      .eq("action_type", actionType)
      .gte("created_at", hourAgo)
      .in("action_result", ["applied", "triggered", "SUCCESS"]);

    if ((hourCount ?? 0) >= budget.max_per_hour) {
      return { allowed: false, reason: "HOURLY_BUDGET_EXHAUSTED" };
    }

    const { count: dayCount } = await supabase
      .from("atenia_ai_actions")
      .select("*", { count: "exact", head: true })
      .eq("action_type", actionType)
      .gte("created_at", dayAgo)
      .in("action_result", ["applied", "triggered", "SUCCESS"]);

    if ((dayCount ?? 0) >= budget.max_per_day) {
      return { allowed: false, reason: "DAILY_BUDGET_EXHAUSTED" };
    }
  }

  // 4. Cooldown on same target
  if (targetId) {
    const cooldownMinutes = policy.cooldowns[actionType] ?? 0;
    if (cooldownMinutes > 0) {
      const cooldownCutoff = new Date(
        Date.now() - cooldownMinutes * 60 * 1000,
      ).toISOString();
      const { count } = await supabase
        .from("atenia_ai_actions")
        .select("*", { count: "exact", head: true })
        .eq("action_type", actionType)
        .eq("work_item_id", targetId)
        .gte("created_at", cooldownCutoff)
        .in("action_result", ["applied", "triggered", "SUCCESS"]);

      if ((count ?? 0) > 0) {
        return { allowed: false, reason: "COOLDOWN_ACTIVE" };
      }
    }
  }

  return { allowed: true };
}
