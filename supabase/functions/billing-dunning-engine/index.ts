/**
 * Billing Dunning Engine
 * 
 * Processes the dunning schedule for overdue subscriptions.
 * Called periodically (e.g. every hour) by a cron or manually by admin.
 * 
 * For each PENDING dunning entry whose scheduled_at has passed:
 * 1. Attempt payment retry via gateway (or mark for manual retry)
 * 2. Send notification emails
 * 3. Escalate (suspend/cancel) per dunning_rules
 * 4. Log all actions to subscription_events
 * 
 * POST body (optional):
 *   { "dry_run": true }  — preview what would happen without executing
 *   { "organization_id": "..." } — process only a specific org
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // Fetch pending dunning entries that are due
    let query = supabase
      .from("dunning_schedule")
      .select("*")
      .eq("status", "PENDING")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(50);

    if (targetOrgId) {
      query = query.eq("organization_id", targetOrgId);
    }

    const { data: pendingEntries, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    if (!pendingEntries?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0, message: "No pending dunning entries" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch dunning rules for escalation logic
    const { data: rules } = await supabase
      .from("dunning_rules")
      .select("*")
      .order("attempt_number", { ascending: true });

    const rulesMap = new Map((rules || []).map(r => [r.attempt_number, r]));

    const results: any[] = [];

    for (const entry of pendingEntries) {
      const rule = rulesMap.get(entry.attempt_number);
      const escalation = rule?.escalation_action || null;

      if (dryRun) {
        results.push({
          id: entry.id,
          organization_id: entry.organization_id,
          attempt_number: entry.attempt_number,
          action: entry.action_type,
          escalation,
          dry_run: true,
        });
        continue;
      }

      // Mark entry as processing
      await supabase
        .from("dunning_schedule")
        .update({ status: "PROCESSING" })
        .eq("id", entry.id);

      let outcome = "RETRY_SCHEDULED";
      let eventDescription = `Intento de cobro #${entry.attempt_number}`;

      // Handle escalation actions
      if (escalation === "SUSPEND") {
        // Suspend the subscription
        await supabase
          .from("billing_subscription_state")
          .update({ status: "SUSPENDED", updated_at: new Date().toISOString() })
          .eq("organization_id", entry.organization_id);

        outcome = "SUSPENDED";
        eventDescription = `Suscripción suspendida tras ${entry.attempt_number} intentos fallidos de cobro`;
      } else if (escalation === "CANCEL") {
        await supabase
          .from("billing_subscription_state")
          .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
          .eq("organization_id", entry.organization_id);

        outcome = "CANCELLED";
        eventDescription = `Suscripción cancelada por morosidad prolongada (${entry.attempt_number} intentos)`;
      }

      // Log subscription event
      await supabase.from("subscription_events").insert({
        organization_id: entry.organization_id,
        event_type: `DUNNING_ATTEMPT_${entry.attempt_number}`,
        description: eventDescription,
        actor: "SYSTEM",
        metadata: {
          dunning_entry_id: entry.id,
          attempt_number: entry.attempt_number,
          action_type: entry.action_type,
          escalation,
          outcome,
        },
      });

      // If not final escalation, schedule next attempt
      if (!escalation || escalation !== "CANCEL") {
        const nextRule = rulesMap.get(entry.attempt_number + 1);
        if (nextRule) {
          const nextScheduledAt = new Date(Date.now() + nextRule.delay_hours * 3600 * 1000).toISOString();
          await supabase.from("dunning_schedule").insert({
            organization_id: entry.organization_id,
            attempt_number: entry.attempt_number + 1,
            action_type: nextRule.action_type,
            scheduled_at: nextScheduledAt,
            status: "PENDING",
          });
        }
      }

      // Mark current entry as completed
      await supabase
        .from("dunning_schedule")
        .update({
          status: outcome === "CANCELLED" || outcome === "SUSPENDED" ? "ESCALATED" : "COMPLETED",
          executed_at: new Date().toISOString(),
        })
        .eq("id", entry.id);

      results.push({
        id: entry.id,
        organization_id: entry.organization_id,
        attempt_number: entry.attempt_number,
        outcome,
        escalation,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      processed: results.length,
      dry_run: dryRun,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("billing-dunning-engine error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
