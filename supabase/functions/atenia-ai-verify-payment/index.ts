/**
 * Atenia AI Payment Verification
 *
 * Verifies a payment transaction before activating a subscription plan.
 * Called after a webhook records an APPROVED payment, or after mock checkout completes.
 *
 * Checks:
 *  1. Amount matches plan price
 *  2. Currency is COP
 *  3. No duplicate payment in last hour
 *  4. Organization exists
 *  5. Plan is valid and available
 *
 * On success: marks transaction VERIFIED → activates subscription → marks ACTIVATED
 * On failure: marks transaction REJECTED and logs reason
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface VerificationCheck {
  check: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  detail: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { transaction_id } = await req.json();
    if (!transaction_id) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Missing transaction_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Load transaction
    const { data: txn, error: txnError } = await supabase
      .from("payment_transactions")
      .select("*")
      .eq("id", transaction_id)
      .single();

    if (txnError || !txn) {
      return new Response(
        JSON.stringify({ ok: false, code: "NOT_FOUND", message: "Transaction not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotent — already processed
    if (txn.status === "ACTIVATED" || txn.status === "VERIFIED") {
      return new Response(
        JSON.stringify({ ok: true, already_processed: true, status: txn.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (txn.status !== "PROCESSING" && txn.status !== "PENDING") {
      return new Response(
        JSON.stringify({ ok: false, code: "INVALID_STATUS", message: `Cannot verify transaction in status ${txn.status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const checks: VerificationCheck[] = [];

    // 2. Find expected plan price
    const { data: billingPlan } = await supabase
      .from("billing_plans")
      .select("id, code, display_name")
      .eq("code", txn.plan_code)
      .single();

    if (!billingPlan) {
      checks.push({ check: "PLAN_EXISTS", passed: false, detail: `Plan ${txn.plan_code} no encontrado` });
    } else {
      checks.push({ check: "PLAN_EXISTS", passed: true, detail: `Plan válido: ${billingPlan.display_name}` });

      // Find price point
      const now = new Date();
      const priceType = txn.billing_cycle_months === 24 ? "INTRO" : "REGULAR";
      const { data: pricePoint } = await supabase
        .from("billing_price_points")
        .select("price_cop_incl_iva")
        .eq("plan_id", billingPlan.id)
        .eq("billing_cycle_months", txn.billing_cycle_months)
        .eq("price_type", priceType)
        .lte("valid_from", now.toISOString())
        .or(`valid_to.is.null,valid_to.gte.${now.toISOString()}`)
        .maybeSingle();

      if (pricePoint) {
        const amountMatch = txn.amount_cop === pricePoint.price_cop_incl_iva;
        checks.push({
          check: "AMOUNT_MATCH",
          passed: amountMatch,
          expected: pricePoint.price_cop_incl_iva,
          actual: txn.amount_cop,
          detail: amountMatch
            ? `Monto correcto: $${txn.amount_cop.toLocaleString("es-CO")} COP`
            : `⚠️ Monto incorrecto: esperado $${pricePoint.price_cop_incl_iva.toLocaleString("es-CO")}, recibido $${txn.amount_cop.toLocaleString("es-CO")}`,
        });
      } else {
        checks.push({
          check: "AMOUNT_MATCH",
          passed: false,
          detail: `No se encontró precio para plan ${txn.plan_code}, ciclo ${txn.billing_cycle_months}m`,
        });
      }
    }

    // 3. Currency check
    const currencyOk = txn.currency === "COP";
    checks.push({
      check: "CURRENCY_MATCH",
      passed: currencyOk,
      detail: currencyOk ? "Moneda correcta: COP" : `⚠️ Moneda inesperada: ${txn.currency}`,
    });

    // 4. Duplicate check (same org, ACTIVATED in last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: duplicates } = await supabase
      .from("payment_transactions")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", txn.organization_id)
      .eq("status", "ACTIVATED")
      .gte("created_at", oneHourAgo)
      .neq("id", transaction_id);

    const noDuplicates = (duplicates ?? 0) === 0;
    checks.push({
      check: "NO_DUPLICATE",
      passed: noDuplicates,
      detail: noDuplicates
        ? "Sin pagos duplicados detectados"
        : `⚠️ ${duplicates} pago(s) reciente(s) para la misma organización`,
    });

    // 5. Org valid
    const { data: org } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", txn.organization_id)
      .single();

    const orgValid = !!org;
    checks.push({
      check: "ORG_VALID",
      passed: orgValid,
      detail: orgValid ? `Organización válida: ${org?.name}` : "⚠️ Organización no encontrada",
    });

    // 6. Fraud signals (basic)
    const fraudSignals: string[] = [];
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentFailures } = await supabase
      .from("payment_transactions")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", txn.organization_id)
      .eq("status", "FAILED")
      .gte("created_at", twentyFourHoursAgo);

    if ((recentFailures ?? 0) >= 5) {
      fraudSignals.push(`${recentFailures} pagos fallidos en 24h`);
    }

    checks.push({
      check: "FRAUD_SCREEN",
      passed: fraudSignals.length === 0,
      detail: fraudSignals.length === 0
        ? "Sin señales de fraude detectadas"
        : `⚠️ Señales de fraude: ${fraudSignals.join(", ")}`,
    });

    // 7. Determine result
    const criticalChecks = ["AMOUNT_MATCH", "CURRENCY_MATCH", "ORG_VALID", "PLAN_EXISTS"];
    const allCriticalPassed = checks
      .filter((c) => criticalChecks.includes(c.check))
      .every((c) => c.passed);

    const hasFraud = fraudSignals.length > 0;
    const verified = allCriticalPassed && !hasFraud;

    // 8. Log Atenia AI action
    const actionId = crypto.randomUUID();
    const decisionReason = verified
      ? `Pago verificado: $${txn.amount_cop.toLocaleString("es-CO")} COP para plan ${txn.plan_code} (${txn.billing_cycle_months}m). Todas las verificaciones pasaron.`
      : `Pago rechazado: ${checks.filter((c) => !c.passed).map((c) => c.detail).join("; ")}`;

    await supabase.from("atenia_ai_actions").insert({
      id: actionId,
      action_type: verified ? "VERIFY_PAYMENT" : "DETECT_FRAUD",
      autonomy_tier: "T1",
      organization_id: txn.organization_id,
      reasoning: decisionReason,
      status: "EXECUTED",
      evidence: { checks, fraud_signals: fraudSignals },
    });

    // 9. Update transaction
    if (verified) {
      await supabase.from("payment_transactions").update({
        status: "VERIFIED",
        verification_checks: checks,
        verified_at: new Date().toISOString(),
        verified_by_action_id: actionId,
      }).eq("id", transaction_id);

      // 10. Log subscription event
      await supabase.from("subscription_events").insert({
        organization_id: txn.organization_id,
        event_type: "PAYMENT_VERIFIED",
        description: `Pago de $${txn.amount_cop.toLocaleString("es-CO")} COP verificado por Atenia AI. Plan: ${txn.plan_code}.`,
        payload: { transaction_id, checks: checks.map((c) => ({ check: c.check, passed: c.passed })) },
        triggered_by: "ATENIA_AI",
        triggered_by_action_id: actionId,
      });

      // 11. Activate subscription
      const now = new Date();
      const periodEnd = new Date(now);
      if (txn.billing_cycle_months === 24) {
        periodEnd.setMonth(periodEnd.getMonth() + 24);
      } else {
        periodEnd.setDate(periodEnd.getDate() + 30);
      }

      // Update billing_subscription_state
      await supabase.from("billing_subscription_state").upsert({
        organization_id: txn.organization_id,
        plan_code: txn.plan_code,
        billing_cycle_months: txn.billing_cycle_months,
        currency: "COP",
        current_price_cop_incl_iva: txn.amount_cop,
        intro_offer_applied: txn.billing_cycle_months === 24,
        trial_end_at: null,
        status: "ACTIVE",
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        next_billing_at: periodEnd.toISOString(),
        last_payment_id: transaction_id,
        consecutive_payment_failures: 0,
        suspended_at: null,
        grace_period_end: null,
        updated_at: now.toISOString(),
      }, { onConflict: "organization_id" });

      // Update legacy subscriptions table (for SubscriptionContext compatibility)
      const planNameMap: Record<string, string> = {
        BASIC: "basic",
        PRO: "standard",
        ENTERPRISE: "unlimited",
      };
      const planName = planNameMap[txn.plan_code] || "basic";
      const { data: planRow } = await supabase
        .from("subscription_plans")
        .select("id")
        .eq("name", planName)
        .single();

      if (planRow) {
        const { data: existingSub } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("organization_id", txn.organization_id)
          .maybeSingle();

        if (existingSub) {
          await supabase.from("subscriptions").update({
            plan_id: planRow.id,
            status: "active",
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
            trial_ends_at: null,
            updated_at: now.toISOString(),
          }).eq("id", existingSub.id);
        } else {
          await supabase.from("subscriptions").insert({
            organization_id: txn.organization_id,
            plan_id: planRow.id,
            status: "active",
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
          });
        }
      }

      // Mark transaction as activated
      await supabase.from("payment_transactions").update({
        status: "ACTIVATED",
      }).eq("id", transaction_id);

      // Log activation event
      await supabase.from("subscription_events").insert({
        organization_id: txn.organization_id,
        event_type: "PLAN_ACTIVATED",
        description: `Plan ${txn.plan_code} activado. Período: ${now.toLocaleDateString("es-CO")} — ${periodEnd.toLocaleDateString("es-CO")}.`,
        payload: {
          plan_code: txn.plan_code,
          period_start: now.toISOString(),
          period_end: periodEnd.toISOString(),
          amount_cop: txn.amount_cop,
          transaction_id,
        },
        triggered_by: "ATENIA_AI",
        triggered_by_action_id: actionId,
      });

      console.log(`[atenia-ai-verify-payment] VERIFIED + ACTIVATED txn ${transaction_id} for org ${txn.organization_id}`);

      return new Response(
        JSON.stringify({ ok: true, verified: true, activated: true, action_id: actionId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Rejected
      await supabase.from("payment_transactions").update({
        status: "REJECTED",
        verification_checks: checks,
        verified_at: new Date().toISOString(),
        verified_by_action_id: actionId,
      }).eq("id", transaction_id);

      await supabase.from("subscription_events").insert({
        organization_id: txn.organization_id,
        event_type: "PAYMENT_REJECTED",
        description: `Pago rechazado por Atenia AI: ${checks.filter((c) => !c.passed).map((c) => c.detail).join("; ")}`,
        payload: { transaction_id, checks },
        triggered_by: "ATENIA_AI",
        triggered_by_action_id: actionId,
      });

      console.log(`[atenia-ai-verify-payment] REJECTED txn ${transaction_id}: ${decisionReason}`);

      return new Response(
        JSON.stringify({ ok: true, verified: false, reason: "VERIFICATION_FAILED", checks }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("atenia-ai-verify-payment error:", error);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
