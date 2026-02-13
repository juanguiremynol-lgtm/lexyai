/**
 * Billing E2E Test Console — Super Admin Only
 *
 * Allows time-travel, scenario setup, and lifecycle inspection
 * for the billing state machine without Wompi integration.
 */

import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Clock, Play, RotateCcw, CheckCircle2, XCircle, AlertTriangle,
  FastForward, Timer, Loader2, FlaskConical, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { billingClock } from "@/lib/billing/billing-clock";
import {
  computeBillingState,
  computeStatusTransition,
  buildTickerMessages,
  type BillingStateInput,
  type ComputedBillingState,
  PRE_DUE_NOTICE_DAYS,
  GRACE_PERIOD_DAYS,
} from "@/lib/billing/billing-state-machine";
import { formatCOP } from "@/lib/billing/pricing-windows";

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
  timestamp: Date;
}

interface AuditEvent {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export default function BillingTestConsole() {
  const { organization } = useOrganization();
  const { billingSubscription, subscription, refetch } = useSubscription();

  // Time travel state
  const [clockOverrideInput, setClockOverrideInput] = useState("");
  const [isClockOverridden, setIsClockOverridden] = useState(billingClock.isOverridden());
  const [currentClockTime, setCurrentClockTime] = useState<Date>(billingClock.now());

  // Scenario setup
  const [dueInDays, setDueInDays] = useState("5");
  const [isSettingScenario, setIsSettingScenario] = useState(false);

  // Test results
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunningTests, setIsRunningTests] = useState(false);

  // Audit events
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // Computed state preview
  const [previewState, setPreviewState] = useState<ComputedBillingState | null>(null);

  // ======== TIME TRAVEL ========

  const handleSetClock = useCallback(() => {
    if (!clockOverrideInput) {
      toast.error("Ingresa una fecha válida");
      return;
    }
    const overrideDate = new Date(clockOverrideInput);
    if (isNaN(overrideDate.getTime())) {
      toast.error("Fecha inválida");
      return;
    }
    billingClock.setOverride(overrideDate);
    setIsClockOverridden(true);
    setCurrentClockTime(overrideDate);
    toast.success(`Reloj de billing fijado a ${overrideDate.toLocaleString("es-CO")}`);
    updatePreview(overrideDate);
  }, [clockOverrideInput]);

  const handleResetClock = useCallback(() => {
    billingClock.reset();
    setIsClockOverridden(false);
    const now = new Date();
    setCurrentClockTime(now);
    setClockOverrideInput("");
    toast.info("Reloj restaurado a tiempo real");
    updatePreview(now);
  }, []);

  const handleTimeJump = useCallback((days: number) => {
    const base = billingClock.now();
    const jumped = new Date(base);
    jumped.setDate(jumped.getDate() + days);
    billingClock.setOverride(jumped);
    setIsClockOverridden(true);
    setCurrentClockTime(jumped);
    setClockOverrideInput(jumped.toISOString().slice(0, 16));
    toast.success(`Avanzado ${days} día(s) → ${jumped.toLocaleString("es-CO")}`);
    updatePreview(jumped);
  }, []);

  // ======== STATE PREVIEW ========

  const updatePreview = useCallback(
    (now?: Date) => {
      const time = now || billingClock.now();
      const input: BillingStateInput = {
        currentPeriodEnd: billingSubscription?.current_period_end || subscription?.current_period_end || null,
        trialEndAt: billingSubscription?.trial_end_at || subscription?.trial_ends_at || null,
        compedUntilAt: billingSubscription?.comped_until_at || null,
        status: billingSubscription?.status || null,
        suspendedAt: billingSubscription?.suspended_at || null,
      };
      setPreviewState(computeBillingState(input, time));
    },
    [billingSubscription, subscription]
  );

  // ======== SCENARIO SETUP ========

  const handleSetScenario = useCallback(
    async (scenarioDays: number) => {
      if (!organization?.id) return;
      setIsSettingScenario(true);
      try {
        const now = billingClock.now();
        const newDueDate = new Date(now);
        newDueDate.setDate(newDueDate.getDate() + scenarioDays);

        const { error } = await supabase
          .from("billing_subscription_state")
          .update({
            current_period_end: newDueDate.toISOString(),
            status: "ACTIVE",
            suspended_at: null,
            consecutive_payment_failures: 0,
          })
          .eq("organization_id", organization.id);

        if (error) throw error;

        // Also update legacy subscriptions table
        await supabase
          .from("subscriptions")
          .update({
            current_period_end: newDueDate.toISOString(),
            status: "active",
          })
          .eq("organization_id", organization.id);

        toast.success(`Escenario configurado: vence en ${scenarioDays} días (${newDueDate.toLocaleDateString("es-CO")})`);
        refetch();
        updatePreview();
      } catch (err) {
        toast.error("Error al configurar escenario: " + String(err));
      } finally {
        setIsSettingScenario(false);
      }
    },
    [organization?.id, refetch, updatePreview]
  );

  const handleForceStatus = useCallback(
    async (newStatus: string) => {
      if (!organization?.id) return;
      setIsSettingScenario(true);
      try {
        const updateData: Record<string, unknown> = { status: newStatus };
        if (newStatus === "ACTIVE") {
          updateData.suspended_at = null;
          updateData.consecutive_payment_failures = 0;
        }
        if (newStatus === "SUSPENDED") {
          updateData.suspended_at = new Date().toISOString();
        }

        const { error } = await supabase
          .from("billing_subscription_state")
          .update(updateData)
          .eq("organization_id", organization.id);

        if (error) throw error;

        toast.success(`Estado forzado a ${newStatus}`);
        refetch();
        updatePreview();
      } catch (err) {
        toast.error("Error: " + String(err));
      } finally {
        setIsSettingScenario(false);
      }
    },
    [organization?.id, refetch, updatePreview]
  );

  // ======== AUTOMATED TESTS ========

  const runAllTests = useCallback(async () => {
    setIsRunningTests(true);
    const results: TestResult[] = [];

    // Test #1: Pre-due ticker at D-5
    (() => {
      const now = new Date("2026-06-10T12:00:00Z");
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + 5);
      const state = computeBillingState(
        { currentPeriodEnd: dueDate.toISOString(), trialEndAt: null, compedUntilAt: null, status: "ACTIVE", suspendedAt: null },
        now
      );
      results.push({
        name: "Test #1: Pre-due ticker at D-5",
        passed: state.urgency === "pre_due" && state.showTopTicker && !state.showBottomTicker,
        detail: `urgency=${state.urgency}, top=${state.showTopTicker}, bottom=${state.showBottomTicker}`,
        timestamp: new Date(),
      });
    })();

    // Test #2: Double ticker on due date
    (() => {
      const now = new Date("2026-06-15T12:00:00Z");
      const state = computeBillingState(
        { currentPeriodEnd: now.toISOString(), trialEndAt: null, compedUntilAt: null, status: "ACTIVE", suspendedAt: null },
        now
      );
      results.push({
        name: "Test #2: Double ticker on due date",
        passed: state.urgency === "due_today" && state.showTopTicker && state.showBottomTicker,
        detail: `urgency=${state.urgency}, top=${state.showTopTicker}, bottom=${state.showBottomTicker}`,
        timestamp: new Date(),
      });
    })();

    // Test #3: Suspension after grace
    (() => {
      const now = new Date("2026-06-18T12:00:00Z");
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() - 3);
      const state = computeBillingState(
        { currentPeriodEnd: dueDate.toISOString(), trialEndAt: null, compedUntilAt: null, status: "ACTIVE", suspendedAt: null },
        now
      );
      results.push({
        name: "Test #3: Suspension after grace period",
        passed: state.urgency === "suspended" && state.showPaywall && state.status === "SUSPENDED",
        detail: `urgency=${state.urgency}, paywall=${state.showPaywall}, status=${state.status}`,
        timestamp: new Date(),
      });
    })();

    // Test #4: Reactivation transition
    (() => {
      const now = new Date("2026-06-18T12:00:00Z");
      const newPeriodEnd = new Date(now);
      newPeriodEnd.setDate(newPeriodEnd.getDate() + 30);
      const state = computeBillingState(
        { currentPeriodEnd: newPeriodEnd.toISOString(), trialEndAt: null, compedUntilAt: null, status: "ACTIVE", suspendedAt: null },
        now
      );
      results.push({
        name: "Test #4: Post-payment reactivation",
        passed: state.urgency === "none" && !state.showPaywall && state.status === "ACTIVE",
        detail: `urgency=${state.urgency}, paywall=${state.showPaywall}, status=${state.status}`,
        timestamp: new Date(),
      });
    })();

    // Test #5: Grace period boundary (D+2)
    (() => {
      const now = new Date("2026-06-17T12:00:00Z");
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() - 2);
      const state = computeBillingState(
        { currentPeriodEnd: dueDate.toISOString(), trialEndAt: null, compedUntilAt: null, status: "ACTIVE", suspendedAt: null },
        now
      );
      results.push({
        name: "Test #5: Grace period boundary (D+2)",
        passed: state.urgency === "grace" && state.inGrace && state.status === "PAST_DUE",
        detail: `urgency=${state.urgency}, inGrace=${state.inGrace}, daysOverdue=${state.daysOverdue}`,
        timestamp: new Date(),
      });
    })();

    // Test #6: Ticker messages
    (() => {
      const msgs = buildTickerMessages("pre_due", 3, 0);
      const passed = msgs.admin.includes("3 días") && msgs.member.includes("administrador");
      results.push({
        name: "Test #6: Ticker message localization",
        passed,
        detail: `admin="${msgs.admin.substring(0, 50)}..."`,
        timestamp: new Date(),
      });
    })();

    setTestResults(results);
    setIsRunningTests(false);

    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    if (passed === total) {
      toast.success(`✅ ${passed}/${total} tests pasaron`);
    } else {
      toast.error(`⚠️ ${passed}/${total} tests pasaron`);
    }
  }, []);

  // ======== AUDIT TIMELINE ========

  const loadAuditEvents = useCallback(async () => {
    if (!organization?.id) return;
    setIsLoadingAudit(true);
    try {
      const { data, error } = await supabase
        .from("subscription_events")
        .select("id, event_type, description, created_at, payload")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setAuditEvents((data || []) as AuditEvent[]);
    } catch (err) {
      toast.error("Error al cargar eventos: " + String(err));
    } finally {
      setIsLoadingAudit(false);
    }
  }, [organization?.id]);

  // ======== MOCK PAYMENT ========

  const handleMockPayment = useCallback(
    async (outcome: "APPROVED" | "DECLINED") => {
      if (!organization?.id) return;
      try {
        if (outcome === "APPROVED") {
          const now = billingClock.now();
          const newPeriodEnd = new Date(now);
          newPeriodEnd.setDate(newPeriodEnd.getDate() + 30);

          // Update billing state
          await supabase
            .from("billing_subscription_state")
            .update({
              status: "ACTIVE",
              current_period_start: now.toISOString(),
              current_period_end: newPeriodEnd.toISOString(),
              next_billing_at: newPeriodEnd.toISOString(),
              suspended_at: null,
              consecutive_payment_failures: 0,
            })
            .eq("organization_id", organization.id);

          // Update legacy table
          await supabase
            .from("subscriptions")
            .update({
              status: "active",
              current_period_end: newPeriodEnd.toISOString(),
            })
            .eq("organization_id", organization.id);

          // Log event
          await supabase.from("subscription_events").insert({
            organization_id: organization.id,
            event_type: "PAYMENT_VERIFIED",
            description: `Pago mock APROBADO. Próximo vencimiento: ${newPeriodEnd.toLocaleDateString("es-CO")}.`,
            payload: { source: "test_console", outcome, new_period_end: newPeriodEnd.toISOString() },
            triggered_by: "USER",
          });

          toast.success("✅ Pago aprobado — cuenta reactivada");
        } else {
          await supabase
            .from("billing_subscription_state")
            .update({ consecutive_payment_failures: (billingSubscription?.consecutive_payment_failures || 0) + 1 })
            .eq("organization_id", organization.id);

          await supabase.from("subscription_events").insert({
            organization_id: organization.id,
            event_type: "PAYMENT_FAILED",
            description: "Pago mock RECHAZADO.",
            payload: { source: "test_console", outcome },
            triggered_by: "USER",
          });

          toast.error("❌ Pago rechazado");
        }
        refetch();
        updatePreview();
      } catch (err) {
        toast.error("Error: " + String(err));
      }
    },
    [organization?.id, billingSubscription, refetch, updatePreview]
  );

  const urgencyColor: Record<string, string> = {
    none: "bg-emerald-500",
    pre_due: "bg-amber-500",
    due_today: "bg-orange-500",
    grace: "bg-red-500",
    suspended: "bg-destructive",
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <FlaskConical className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Billing E2E Test Console</h1>
          <p className="text-sm text-muted-foreground">
            Simulación de ciclo de vida de facturación (modo mock)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ======== TIME TRAVEL ======== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Billing Clock
            </CardTitle>
            <CardDescription>
              Controla el tiempo para probar escenarios de vencimiento
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Hora actual de billing</p>
              <p className="text-lg font-mono font-bold">
                {currentClockTime.toLocaleString("es-CO")}
              </p>
              {isClockOverridden && (
                <Badge variant="destructive" className="mt-1">OVERRIDE ACTIVO</Badge>
              )}
            </div>

            <div className="space-y-2">
              <Label>Fijar fecha/hora</Label>
              <div className="flex gap-2">
                <Input
                  type="datetime-local"
                  value={clockOverrideInput}
                  onChange={(e) => setClockOverrideInput(e.target.value)}
                />
                <Button size="sm" onClick={handleSetClock}>
                  <Timer className="h-4 w-4 mr-1" /> Fijar
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => handleTimeJump(1)}>
                <FastForward className="h-3 w-3 mr-1" /> +1 día
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleTimeJump(3)}>
                +3 días
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleTimeJump(5)}>
                +5 días
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleTimeJump(-5)}>
                -5 días
              </Button>
              <Button variant="ghost" size="sm" onClick={handleResetClock}>
                <RotateCcw className="h-3 w-3 mr-1" /> Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ======== CURRENT STATE PREVIEW ======== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Estado Actual
            </CardTitle>
            <CardDescription>
              Estado computado del billing para org actual
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" size="sm" className="w-full" onClick={() => updatePreview()}>
              Recalcular
            </Button>

            {previewState ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge>{previewState.status}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Urgency:</span>
                  <Badge className={urgencyColor[previewState.urgency]}>
                    {previewState.urgency}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Days until due:</span>
                  <span>{previewState.daysUntilDue}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Days overdue:</span>
                  <span>{previewState.daysOverdue}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">In grace:</span>
                  <span>{previewState.inGrace ? "Sí" : "No"}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Top ticker:</span>
                  <span>{previewState.showTopTicker ? "✅" : "❌"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bottom ticker:</span>
                  <span>{previewState.showBottomTicker ? "✅" : "❌"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paywall:</span>
                  <span>{previewState.showPaywall ? "🔒" : "❌"}</span>
                </div>
                {previewState.dueDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Due date:</span>
                    <span className="font-mono text-xs">
                      {previewState.dueDate.toLocaleString("es-CO")}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Haz clic en "Recalcular" para ver el estado
              </p>
            )}

            <Separator />
            <div className="text-xs text-muted-foreground">
              <p>Plan: {billingSubscription?.plan_code || "N/A"}</p>
              <p>Precio: {billingSubscription?.current_price_cop_incl_iva ? formatCOP(billingSubscription.current_price_cop_incl_iva) : "N/A"}</p>
              <p>Período fin: {billingSubscription?.current_period_end || subscription?.current_period_end || "N/A"}</p>
              <p>Status DB: {billingSubscription?.status || "N/A"}</p>
            </div>
          </CardContent>
        </Card>

        {/* ======== SCENARIO SETUP ======== */}
        <Card>
          <CardHeader>
            <CardTitle>Configurar Escenario</CardTitle>
            <CardDescription>
              Ajusta la fecha de vencimiento y estado de la suscripción
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Vencimiento en N días</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={dueInDays}
                  onChange={(e) => setDueInDays(e.target.value)}
                  className="w-24"
                />
                <Button
                  size="sm"
                  disabled={isSettingScenario}
                  onClick={() => handleSetScenario(Number(dueInDays))}
                >
                  Aplicar
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={isSettingScenario} onClick={() => handleSetScenario(5)}>
                D-5 (Pre-due)
              </Button>
              <Button variant="outline" size="sm" disabled={isSettingScenario} onClick={() => handleSetScenario(0)}>
                D0 (Hoy)
              </Button>
              <Button variant="outline" size="sm" disabled={isSettingScenario} onClick={() => handleSetScenario(-1)}>
                D+1 (Grace)
              </Button>
              <Button variant="outline" size="sm" disabled={isSettingScenario} onClick={() => handleSetScenario(-3)}>
                D+3 (Suspended)
              </Button>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Forzar Estado</Label>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={isSettingScenario} onClick={() => handleForceStatus("ACTIVE")}>
                  ACTIVE
                </Button>
                <Button variant="outline" size="sm" disabled={isSettingScenario} onClick={() => handleForceStatus("PAST_DUE")}>
                  PAST_DUE
                </Button>
                <Button variant="outline" size="sm" disabled={isSettingScenario} onClick={() => handleForceStatus("SUSPENDED")}>
                  SUSPENDED
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ======== MOCK PAYMENT ======== */}
        <Card>
          <CardHeader>
            <CardTitle>Mock Payment</CardTitle>
            <CardDescription>
              Simula pago aprobado o rechazado (webhook-style)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Button
                className="flex-1 gap-2"
                onClick={() => handleMockPayment("APPROVED")}
              >
                <CheckCircle2 className="h-4 w-4" />
                Aprobar Pago
              </Button>
              <Button
                variant="destructive"
                className="flex-1 gap-2"
                onClick={() => handleMockPayment("DECLINED")}
              >
                <XCircle className="h-4 w-4" />
                Rechazar Pago
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              "Aprobar" extiende el período 30 días y reactiva la cuenta instantáneamente.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ======== AUTOMATED TESTS ======== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Tests Automatizados
          </CardTitle>
          <CardDescription>
            Ejecuta los 6 tests de la máquina de estados de billing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={runAllTests} disabled={isRunningTests} className="gap-2">
            {isRunningTests ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Ejecutar Todos
          </Button>

          {testResults.length > 0 && (
            <div className="space-y-2">
              {testResults.map((r, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  {r.passed ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{r.detail}</p>
                  </div>
                  <Badge variant={r.passed ? "default" : "destructive"}>
                    {r.passed ? "PASS" : "FAIL"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ======== AUDIT TIMELINE ======== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Audit Timeline
          </CardTitle>
          <CardDescription>
            Eventos de suscripción y billing para esta organización
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            onClick={loadAuditEvents}
            disabled={isLoadingAudit}
            className="mb-4 gap-2"
          >
            {isLoadingAudit ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Cargar Eventos
          </Button>

          {auditEvents.length > 0 ? (
            <ScrollArea className="h-80">
              <div className="space-y-2">
                {auditEvents.map((evt) => (
                  <div key={evt.id} className="flex gap-3 rounded border p-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <Badge variant="outline" className="mb-1">{evt.event_type}</Badge>
                      <p className="text-muted-foreground">{evt.description}</p>
                      <p className="font-mono text-muted-foreground/60">
                        {new Date(evt.created_at).toLocaleString("es-CO")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Sin eventos cargados
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
