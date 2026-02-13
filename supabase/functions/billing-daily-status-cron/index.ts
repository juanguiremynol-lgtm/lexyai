/**
 * Billing Daily Status Cron
 * 
 * Runs periodically to auto-transition subscription statuses:
 *   TRIAL → ACTIVE/PAST_DUE/SUSPENDED (when trial ends)
 *   ACTIVE → PAST_DUE (when past due date, within grace)
 *   PAST_DUE → SUSPENDED (when grace period expired)
 * 
 * Uses the same pure billing state logic as the frontend.
 * Super admins / comped accounts are exempt from suspension.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Inline billing state logic (mirrors src/lib/billing/billing-state-machine.ts) ──

const PRE_DUE_NOTICE_DAYS = 5;
const GRACE_PERIOD_DAYS = 2;

type BillingStatus = "ACTIVE" | "TRIAL" | "PENDING_PAYMENT" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | "EXPIRED" | "CHURNED";

interface BillingStateInput {
  currentPeriodEnd: string | null;
  trialEndAt: string | null;
  compedUntilAt: string | null;
  status: string | null;
  suspendedAt: string | null;
}

interface StatusTransition {
  newStatus: BillingStatus;
  reason: string;
  shouldSuspend: boolean;
  shouldNotify: boolean;
}

function computeStatusTransition(input: BillingStateInput, now: Date): StatusTransition | null {
  const currentStatus = (input.status || "ACTIVE") as BillingStatus;

  // Skip already-terminal statuses
  if (["CANCELLED", "CHURNED"].includes(currentStatus)) return null;

  // Comped accounts are always active
  if (input.compedUntilAt) {
    const compedEnd = new Date(input.compedUntilAt);
    if (now < compedEnd) return null;
  }

  // ── TRIAL LOGIC ──
  if (input.trialEndAt && !input.currentPeriodEnd) {
    const trialEnd = new Date(input.trialEndAt);
    const trialDiffMs = trialEnd.getTime() - now.getTime();
    const trialDiffDays = Math.ceil(trialDiffMs / (1000 * 60 * 60 * 24));

    if (trialDiffDays > 0) {
      // Still in trial, no transition
      if (currentStatus !== "TRIAL") {
        return {
          newStatus: "TRIAL",
          reason: "Cuenta en período de prueba.",
          shouldSuspend: false,
          shouldNotify: false,
        };
      }
      return null;
    }

    // Trial has ended - need to transition
    // The trial_end_at IS the first due date
    const daysOverdue = Math.max(0, -trialDiffDays);
    const beyondGrace = daysOverdue > GRACE_PERIOD_DAYS;
    const inGrace = daysOverdue > 0 && daysOverdue <= GRACE_PERIOD_DAYS;

    if (beyondGrace) {
      if (currentStatus === "SUSPENDED") return null;
      return {
        newStatus: "SUSPENDED",
        reason: "Período de prueba finalizado. Cuenta suspendida por falta de pago.",
        shouldSuspend: true,
        shouldNotify: true,
      };
    }

    if (inGrace || trialDiffDays === 0) {
      if (currentStatus === "PAST_DUE") return null;
      return {
        newStatus: "PAST_DUE",
        reason: `Período de prueba finalizado. Pago vencido. Período de gracia de ${GRACE_PERIOD_DAYS} días.`,
        shouldSuspend: false,
        shouldNotify: true,
      };
    }
  }

  // ── BILLING PERIOD LOGIC ──
  const dueDateStr = input.currentPeriodEnd || input.trialEndAt;
  if (!dueDateStr) return null;

  const dueDate = new Date(dueDateStr);
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const daysOverdue = Math.max(0, -diffDays);
  const beyondGrace = daysOverdue > GRACE_PERIOD_DAYS;
  const inGrace = daysOverdue > 0 && daysOverdue <= GRACE_PERIOD_DAYS;

  let computedStatus: BillingStatus;
  if (beyondGrace || input.status === "SUSPENDED") {
    computedStatus = "SUSPENDED";
  } else if (inGrace || diffDays === 0) {
    computedStatus = "PAST_DUE";
  } else {
    computedStatus = "ACTIVE";
  }

  if (computedStatus === currentStatus) return null;

  // ACTIVE → PAST_DUE
  if (computedStatus === "PAST_DUE" && currentStatus === "ACTIVE") {
    return {
      newStatus: "PAST_DUE",
      reason: `Pago vencido. Período de gracia de ${GRACE_PERIOD_DAYS} días inicia.`,
      shouldSuspend: false,
      shouldNotify: true,
    };
  }

  // → SUSPENDED
  if (computedStatus === "SUSPENDED" && currentStatus !== "SUSPENDED") {
    return {
      newStatus: "SUSPENDED",
      reason: "Período de gracia vencido. Cuenta suspendida por falta de pago.",
      shouldSuspend: true,
      shouldNotify: true,
    };
  }

  return {
    newStatus: computedStatus,
    reason: `Transición automática: ${currentStatus} → ${computedStatus}`,
    shouldSuspend: computedStatus === "SUSPENDED",
    shouldNotify: true,
  };
}

// ── Main handler ──

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body.dry_run === true;
    const targetOrgId = body.organization_id || null;
    const limit = body.limit || 200;
    const now = new Date();

    // Fetch all non-terminal billing subscriptions
    let query = supabase
      .from("billing_subscription_state")
      .select("organization_id, status, current_period_end, trial_end_at, comped_until_at, suspended_at")
      .in("status", ["ACTIVE", "TRIAL", "PAST_DUE", "PENDING_PAYMENT"])
      .limit(limit);

    if (targetOrgId) {
      query = query.eq("organization_id", targetOrgId);
    }

    const { data: subscriptions, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    if (!subscriptions?.length) {
      return new Response(JSON.stringify({
        ok: true, processed: 0, transitions: 0, message: "No subscriptions to evaluate",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch platform admins to exempt their orgs
    const { data: platformAdmins } = await supabase
      .from("platform_admins")
      .select("user_id");
    
    const adminUserIds = new Set((platformAdmins || []).map(a => a.user_id));

    const orgIds = subscriptions.map(s => s.organization_id);
    const { data: orgOwners } = await supabase
      .from("organization_memberships")
      .select("organization_id, user_id")
      .in("organization_id", orgIds)
      .eq("role", "OWNER");

    const exemptOrgIds = new Set<string>();
    for (const owner of orgOwners || []) {
      if (adminUserIds.has(owner.user_id)) {
        exemptOrgIds.add(owner.organization_id);
      }
    }

    const results: any[] = [];
    let transitionCount = 0;

    for (const sub of subscriptions) {
      if (exemptOrgIds.has(sub.organization_id)) {
        results.push({
          organization_id: sub.organization_id,
          action: "SKIPPED",
          reason: "Platform admin exempt",
        });
        continue;
      }

      const input: BillingStateInput = {
        currentPeriodEnd: sub.current_period_end,
        trialEndAt: sub.trial_end_at,
        compedUntilAt: sub.comped_until_at,
        status: sub.status,
        suspendedAt: sub.suspended_at,
      };

      const transition = computeStatusTransition(input, now);

      if (!transition) continue;

      if (dryRun) {
        results.push({
          organization_id: sub.organization_id,
          from: sub.status,
          to: transition.newStatus,
          reason: transition.reason,
          dry_run: true,
        });
        transitionCount++;
        continue;
      }

      const updateData: Record<string, unknown> = {
        status: transition.newStatus,
        updated_at: now.toISOString(),
      };
      if (transition.shouldSuspend) {
        updateData.suspended_at = now.toISOString();
      }

      const { error: updateError } = await supabase
        .from("billing_subscription_state")
        .update(updateData)
        .eq("organization_id", sub.organization_id);

      if (updateError) {
        console.error(`Failed to transition ${sub.organization_id}:`, updateError);
        results.push({
          organization_id: sub.organization_id,
          action: "ERROR",
          error: updateError.message,
        });
        continue;
      }

      // Also update legacy subscriptions table
      const legacyStatus = transition.newStatus === "PAST_DUE" ? "past_due" :
                           transition.newStatus === "SUSPENDED" ? "suspended" :
                           transition.newStatus === "TRIAL" ? "trialing" : "active";
      await supabase
        .from("subscriptions")
        .update({ status: legacyStatus })
        .eq("organization_id", sub.organization_id);

      // Log to subscription_events
      await supabase.from("subscription_events").insert({
        organization_id: sub.organization_id,
        event_type: `STATUS_TRANSITION_${transition.newStatus}`,
        description: transition.reason,
        actor: "SYSTEM",
        metadata: {
          from_status: sub.status,
          to_status: transition.newStatus,
          trigger: "daily_cron",
          should_notify: transition.shouldNotify,
        },
      });

      results.push({
        organization_id: sub.organization_id,
        from: sub.status,
        to: transition.newStatus,
        reason: transition.reason,
      });
      transitionCount++;
    }

    return new Response(JSON.stringify({
      ok: true,
      processed: subscriptions.length,
      transitions: transitionCount,
      dry_run: dryRun,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("billing-daily-status-cron error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
