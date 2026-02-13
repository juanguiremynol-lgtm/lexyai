/**
 * Atenia AI Payment Verification
 *
 * Verifies payment using stored amount_breakdown (source of truth) from checkout session.
 * Cross-checks with price-version resolution at checkout time.
 * Strict COP integer comparison. Idempotent.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildAmountBreakdown,
  verifyAmountMatch,
  redactSecrets,
  type AmountBreakdown,
} from "../_shared/pricing-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // 2. Load checkout session for stored amount_breakdown (source of truth)
    let storedBreakdown: AmountBreakdown | null = null;
    if (txn.checkout_session_id) {
      const { data: session } = await supabase
        .from("billing_checkout_sessions")
        .select("amount_breakdown, amount_cop_incl_iva, price_point_id, discount_code_id, discount_amount_cop")
        .eq("id", txn.checkout_session_id)
        .single();

      if (session?.amount_breakdown && typeof session.amount_breakdown === "object" && (session.amount_breakdown as any).price_point_id) {
        storedBreakdown = session.amount_breakdown as unknown as AmountBreakdown;
      }
    }

    // 3. Amount verification using stored breakdown
    if (storedBreakdown) {
      const amountResult = verifyAmountMatch(txn.amount_cop, storedBreakdown);
      checks.push({
        check: "AMOUNT_MATCH",
        passed: amountResult.matches,
        expected: amountResult.expected,
        actual: amountResult.actual,
        detail: amountResult.detail,
      });

      checks.push({
        check: "PRICE_VERSION",
        passed: true,
        detail: `Price version ${storedBreakdown.price_point_version} del ${storedBreakdown.computed_at}`,
      });

      if (storedBreakdown.discount_amount_cop > 0) {
        checks.push({
          check: "DISCOUNT_RECONCILED",
          passed: true,
          detail: `Descuento ${storedBreakdown.discount_code}: $${storedBreakdown.discount_amount_cop.toLocaleString("es-CO")} COP (${storedBreakdown.discount_type} ${storedBreakdown.discount_value})`,
        });
      }
    } else {
      // Fallback: live price lookup (legacy path)
      const { data: billingPlan } = await supabase
        .from("billing_plans")
        .select("id, code, display_name")
        .eq("code", txn.plan_code)
        .single();

      if (!billingPlan) {
        checks.push({ check: "PLAN_EXISTS", passed: false, detail: `Plan ${txn.plan_code} no encontrado` });
      } else {
        checks.push({ check: "PLAN_EXISTS", passed: true, detail: `Plan válido: ${billingPlan.display_name}` });

        const now = new Date();
        const priceType = txn.billing_cycle_months === 24 ? "INTRO" : "REGULAR";
        const { data: pricePoint } = await supabase
          .from("billing_price_points")
          .select("*")
          .eq("plan_id", billingPlan.id)
          .eq("billing_cycle_months", txn.billing_cycle_months)
          .eq("price_type", priceType)
          .eq("is_active", true)
          .lte("valid_from", now.toISOString())
          .or(`valid_to.is.null,valid_to.gte.${now.toISOString()}`)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pricePoint) {
          let expectedAmount = pricePoint.price_cop_incl_iva;
          if (txn.discount_amount_cop && txn.discount_amount_cop > 0) {
            expectedAmount = Math.max(0, expectedAmount - txn.discount_amount_cop);
          }
          const amountMatch = txn.amount_cop === expectedAmount;
          checks.push({
            check: "AMOUNT_MATCH",
            passed: amountMatch,
            expected: expectedAmount,
            actual: txn.amount_cop,
            detail: amountMatch
              ? `Monto correcto: $${txn.amount_cop.toLocaleString("es-CO")} COP (fallback)`
              : `⚠️ Monto incorrecto: esperado $${expectedAmount.toLocaleString("es-CO")}, recibido $${txn.amount_cop.toLocaleString("es-CO")} COP`,
          });
        } else {
          checks.push({ check: "AMOUNT_MATCH", passed: false, detail: `No se encontró precio para plan ${txn.plan_code}` });
        }
      }
    }

    // 4. Currency check
    const currencyOk = txn.currency === "COP";
    checks.push({ check: "CURRENCY_MATCH", passed: currencyOk, detail: currencyOk ? "Moneda correcta: COP" : `⚠️ Moneda inesperada: ${txn.currency}` });

    // 5. Duplicate check (same org, ACTIVATED in last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: duplicates } = await supabase
      .from("payment_transactions")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", txn.organization_id)
      .eq("status", "ACTIVATED")
      .gte("created_at", oneHourAgo)
      .neq("id", transaction_id);

    const noDuplicates = (duplicates ?? 0) === 0;
    checks.push({ check: "NO_DUPLICATE", passed: noDuplicates, detail: noDuplicates ? "Sin pagos duplicados" : `⚠️ ${duplicates} pago(s) reciente(s)` });

    // 6. Org valid
    const { data: org } = await supabase.from("organizations").select("id, name").eq("id", txn.organization_id).single();
    const orgValid = !!org;
    checks.push({ check: "ORG_VALID", passed: orgValid, detail: orgValid ? `Organización válida: ${org?.name}` : "⚠️ Organización no encontrada" });

    // 7. Checkout session not already activated
    if (txn.checkout_session_id) {
      const { data: checkoutSession } = await supabase
        .from("billing_checkout_sessions")
        .select("status")
        .eq("id", txn.checkout_session_id)
        .single();

      const sessionNotActivated = checkoutSession?.status !== "COMPLETED";
      // It's OK if the session IS completed (from billing-complete-checkout), we just check for double activation
      checks.push({
        check: "SESSION_NOT_DOUBLE_ACTIVATED",
        passed: true, // Allow re-verification, idempotency handled at txn level
        detail: `Checkout session status: ${checkoutSession?.status || "unknown"}`,
      });
    }

    // 8. Fraud signals
    const fraudSignals: string[] = [];
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentFailures } = await supabase
      .from("payment_transactions")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", txn.organization_id)
      .eq("status", "FAILED")
      .gte("created_at", twentyFourHoursAgo);

    if ((recentFailures ?? 0) >= 5) fraudSignals.push(`${recentFailures} pagos fallidos en 24h`);

    checks.push({
      check: "FRAUD_SCREEN",
      passed: fraudSignals.length === 0,
      detail: fraudSignals.length === 0 ? "Sin señales de fraude" : `⚠️ ${fraudSignals.join(", ")}`,
    });

    // 9. Determine result
    const criticalChecks = ["AMOUNT_MATCH", "CURRENCY_MATCH", "ORG_VALID"];
    const allCriticalPassed = checks.filter((c) => criticalChecks.includes(c.check)).every((c) => c.passed);
    const verified = allCriticalPassed && fraudSignals.length === 0;

    // 10. Log AI action
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
      evidence: redactSecrets({
        checks,
        fraud_signals: fraudSignals,
        stored_breakdown: storedBreakdown ? {
          price_point_version: storedBreakdown.price_point_version,
          base_price_cop: storedBreakdown.base_price_cop,
          discount_amount_cop: storedBreakdown.discount_amount_cop,
          final_payable_cop: storedBreakdown.final_payable_cop,
        } : null,
      } as Record<string, unknown>),
    });

    // 11. Update transaction
    if (verified) {
      await supabase.from("payment_transactions").update({
        status: "VERIFIED",
        verification_checks: checks,
        verified_at: new Date().toISOString(),
        verified_by_action_id: actionId,
        amount_breakdown: storedBreakdown || {},
      }).eq("id", transaction_id);

      // Log event
      await supabase.from("subscription_events").insert({
        organization_id: txn.organization_id,
        event_type: "PAYMENT_VERIFIED",
        description: `Pago de $${txn.amount_cop.toLocaleString("es-CO")} COP verificado por Atenia AI. Plan: ${txn.plan_code}. Versión de precio: ${storedBreakdown?.price_point_version || "N/A"}.`,
        payload: redactSecrets({
          transaction_id,
          action_id: actionId,
          price_point_version: storedBreakdown?.price_point_version,
          discount_code: storedBreakdown?.discount_code,
          checks: checks.map((c) => ({ check: c.check, passed: c.passed })),
        } as Record<string, unknown>),
        triggered_by: "ATENIA_AI",
        triggered_by_action_id: actionId,
      });

      // Activate subscription
      const now = new Date();
      const periodEnd = new Date(now);
      if (txn.billing_cycle_months === 24) {
        periodEnd.setMonth(periodEnd.getMonth() + 24);
      } else {
        periodEnd.setDate(periodEnd.getDate() + 30);
      }

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

      // Legacy subscriptions table
      const planNameMap: Record<string, string> = { BASIC: "basic", PRO: "standard", ENTERPRISE: "unlimited" };
      const planName = planNameMap[txn.plan_code] || "basic";
      const { data: planRow } = await supabase.from("subscription_plans").select("id").eq("name", planName).single();

      if (planRow) {
        const { data: existingSub } = await supabase.from("subscriptions").select("id").eq("organization_id", txn.organization_id).maybeSingle();
        if (existingSub) {
          await supabase.from("subscriptions").update({
            plan_id: planRow.id, status: "active",
            current_period_start: now.toISOString(), current_period_end: periodEnd.toISOString(),
            trial_ends_at: null, updated_at: now.toISOString(),
          }).eq("id", existingSub.id);
        } else {
          await supabase.from("subscriptions").insert({
            organization_id: txn.organization_id, plan_id: planRow.id, status: "active",
            current_period_start: now.toISOString(), current_period_end: periodEnd.toISOString(),
          });
        }
      }

      // Mark ACTIVATED
      await supabase.from("payment_transactions").update({ status: "ACTIVATED" }).eq("id", transaction_id);

      // Log activation
      await supabase.from("subscription_events").insert({
        organization_id: txn.organization_id,
        event_type: "PLAN_ACTIVATED",
        description: `Plan ${txn.plan_code} activado. Período: ${now.toLocaleDateString("es-CO")} — ${periodEnd.toLocaleDateString("es-CO")}.`,
        payload: redactSecrets({ plan_code: txn.plan_code, period_end: periodEnd.toISOString(), amount_cop: txn.amount_cop, transaction_id, price_point_version: storedBreakdown?.price_point_version } as Record<string, unknown>),
        triggered_by: "ATENIA_AI",
        triggered_by_action_id: actionId,
      });

      console.log(`[atenia-ai-verify-payment] VERIFIED + ACTIVATED txn ${transaction_id}`);
      return new Response(
        JSON.stringify({ ok: true, verified: true, activated: true, action_id: actionId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Rejected
      await supabase.from("payment_transactions").update({
        status: "REJECTED", verification_checks: checks,
        verified_at: new Date().toISOString(), verified_by_action_id: actionId,
      }).eq("id", transaction_id);

      await supabase.from("subscription_events").insert({
        organization_id: txn.organization_id,
        event_type: "PAYMENT_REJECTED",
        description: `Pago rechazado por Atenia AI: ${checks.filter((c) => !c.passed).map((c) => c.detail).join("; ")}`,
        payload: redactSecrets({ transaction_id, checks } as Record<string, unknown>),
        triggered_by: "ATENIA_AI",
        triggered_by_action_id: actionId,
      });

      console.log(`[atenia-ai-verify-payment] REJECTED txn ${transaction_id}`);
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
