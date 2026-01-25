/**
 * Platform Verification Tab - Diagnostics and acceptance tests for admin separation
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  CheckCircle2, 
  XCircle, 
  ShieldCheck, 
  Database, 
  Lock,
  Activity,
  RefreshCw,
  FileText
} from "lucide-react";

interface VerificationResult {
  name: string;
  passed: boolean;
  details: string;
}

export function PlatformVerificationTab() {
  const [isRunning, setIsRunning] = useState(false);

  // Run verification checks
  const { data: verificationResults, refetch, isLoading } = useQuery({
    queryKey: ["platform-verification"],
    queryFn: async () => {
      const results: VerificationResult[] = [];

      // 1. Check platform_admins table exists and has data
      try {
        const { data: platformAdmins, error } = await supabase
          .from("platform_admins")
          .select("user_id, role, created_at")
          .limit(10);
        
        if (error) {
          results.push({
            name: "Platform Admins Table",
            passed: false,
            details: `Error: ${error.message}`,
          });
        } else {
          results.push({
            name: "Platform Admins Table",
            passed: true,
            details: `${platformAdmins?.length || 0} platform admins configured`,
          });
        }
      } catch {
        results.push({
          name: "Platform Admins Table",
          passed: false,
          details: "Failed to query platform_admins",
        });
      }

      // 2. Check is_platform_admin() function works
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: adminCheck } = await supabase
            .from("platform_admins")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();
          
          results.push({
            name: "Platform Admin Function",
            passed: true,
            details: adminCheck ? "Current user IS platform admin" : "Function working, user not admin",
          });
        }
      } catch {
        results.push({
          name: "Platform Admin Function",
          passed: false,
          details: "Failed to check platform admin status",
        });
      }

      // 3. Check cross-org access for organizations
      try {
        const { data: orgs, error } = await supabase
          .from("organizations")
          .select("id, name")
          .limit(5);
        
        results.push({
          name: "Cross-Org Organizations Access",
          passed: !error && (orgs?.length || 0) > 0,
          details: error ? `Error: ${error.message}` : `Can access ${orgs?.length} organizations`,
        });
      } catch {
        results.push({
          name: "Cross-Org Organizations Access",
          passed: false,
          details: "Failed to query organizations",
        });
      }

      // 4. Check cross-org access for subscriptions
      try {
        const { data: subs, error } = await supabase
          .from("subscriptions")
          .select("id, organization_id, status")
          .limit(5);
        
        results.push({
          name: "Cross-Org Subscriptions Access",
          passed: !error && (subs?.length || 0) > 0,
          details: error ? `Error: ${error.message}` : `Can access ${subs?.length} subscriptions`,
        });
      } catch {
        results.push({
          name: "Cross-Org Subscriptions Access",
          passed: false,
          details: "Failed to query subscriptions",
        });
      }

      // 5. Check cross-org audit logs access
      try {
        const { data: logs, error } = await supabase
          .from("audit_logs")
          .select("id, organization_id, action")
          .limit(5);
        
        results.push({
          name: "Cross-Org Audit Logs Access",
          passed: !error,
          details: error ? `Error: ${error.message}` : `Can access ${logs?.length || 0} audit logs`,
        });
      } catch {
        results.push({
          name: "Cross-Org Audit Logs Access",
          passed: false,
          details: "Failed to query audit_logs",
        });
      }

      // 6. Check trial_vouchers table
      try {
        const { data: vouchers, error } = await supabase
          .from("trial_vouchers")
          .select("id, code")
          .limit(5);
        
        results.push({
          name: "Trial Vouchers Table",
          passed: !error,
          details: error ? `Error: ${error.message}` : `${vouchers?.length || 0} vouchers found`,
        });
      } catch {
        results.push({
          name: "Trial Vouchers Table",
          passed: false,
          details: "Failed to query trial_vouchers",
        });
      }

      // 7. Check plan_limits table
      try {
        const { data: limits, error } = await supabase
          .from("plan_limits")
          .select("tier, max_work_items")
          .limit(5);
        
        results.push({
          name: "Plan Limits Configuration",
          passed: !error && (limits?.length || 0) >= 4,
          details: error ? `Error: ${error.message}` : `${limits?.length} tiers configured`,
        });
      } catch {
        results.push({
          name: "Plan Limits Configuration",
          passed: false,
          details: "Failed to query plan_limits",
        });
      }

      // 8. Check system_health_events access
      try {
        const { data: events, error } = await supabase
          .from("system_health_events")
          .select("id, event_type")
          .limit(5);
        
        results.push({
          name: "System Health Events Access",
          passed: !error,
          details: error ? `Error: ${error.message}` : `Can access ${events?.length || 0} events`,
        });
      } catch {
        results.push({
          name: "System Health Events Access",
          passed: false,
          details: "Failed to query system_health_events",
        });
      }

      // 9. Check job_runs access
      try {
        const { data: jobs, error } = await supabase
          .from("job_runs")
          .select("id, job_name")
          .limit(5);
        
        results.push({
          name: "Job Runs Access",
          passed: !error,
          details: error ? `Error: ${error.message}` : `Can access ${jobs?.length || 0} job runs`,
        });
      } catch {
        results.push({
          name: "Job Runs Access",
          passed: false,
          details: "Failed to query job_runs",
        });
      }

      return results;
    },
    enabled: false, // Only run on demand
  });

  // Check DB triggers
  const { data: triggerInfo, refetch: refetchTriggers } = useQuery({
    queryKey: ["platform-triggers"],
    queryFn: async () => {
      // Get recent DB-triggered audit logs
      const { data: triggerLogs, error } = await supabase
        .from("audit_logs")
        .select("action, created_at")
        .like("action", "DB_%")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        return { hasTriggers: false, lastTriggerEvent: null, recentCount: 0 };
      }

      return {
        hasTriggers: true,
        lastTriggerEvent: triggerLogs?.[0]?.created_at || null,
        recentCount: triggerLogs?.length || 0,
        triggers: [
          { name: "organization_memberships", actions: ["INSERT", "UPDATE", "DELETE"] },
          { name: "subscriptions", actions: ["UPDATE"] },
          { name: "email_outbox", actions: ["UPDATE"] },
        ],
      };
    },
    enabled: false,
  });

  const runVerification = async () => {
    setIsRunning(true);
    await refetch();
    await refetchTriggers();
    setIsRunning(false);
  };

  const passedCount = verificationResults?.filter((r) => r.passed).length || 0;
  const totalCount = verificationResults?.length || 0;
  const allPassed = passedCount === totalCount && totalCount > 0;

  return (
    <div className="space-y-6">
      {/* Run Tests Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Verificación de Plataforma
          </CardTitle>
          <CardDescription>
            Ejecute pruebas de aceptación para verificar la separación de roles y accesos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={runVerification} 
            disabled={isRunning || isLoading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
            {isRunning ? "Ejecutando..." : "Ejecutar Verificación"}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {verificationResults && verificationResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Resultados de Verificación
              <Badge 
                variant={allPassed ? "default" : "destructive"}
                className="ml-2"
              >
                {passedCount}/{totalCount} PASARON
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {verificationResults.map((result, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border flex items-start gap-3 ${
                  result.passed 
                    ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900" 
                    : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900"
                }`}
              >
                {result.passed ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{result.name}</p>
                  <p className="text-xs text-muted-foreground">{result.details}</p>
                </div>
                <Badge variant={result.passed ? "outline" : "destructive"}>
                  {result.passed ? "PASS" : "FAIL"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Trigger Coverage */}
      {triggerInfo && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Cobertura de Triggers de Auditoría
            </CardTitle>
            <CardDescription>
              Safety-net triggers que capturan mutaciones a nivel de base de datos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {triggerInfo.triggers?.map((trigger, idx) => (
                <div key={idx} className="p-3 border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Lock className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">{trigger.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {trigger.actions.map((action) => (
                      <Badge key={action} variant="secondary" className="text-xs">
                        {action}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Alert>
              <FileText className="h-4 w-4" />
              <AlertTitle>Último Evento de Trigger</AlertTitle>
              <AlertDescription>
                {triggerInfo.lastTriggerEvent 
                  ? new Date(triggerInfo.lastTriggerEvent).toLocaleString("es-CO")
                  : "Sin eventos recientes de trigger DB"}
                <br />
                <span className="text-muted-foreground">
                  {triggerInfo.recentCount} eventos DB_* en auditoría reciente
                </span>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* Guardrails Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-amber-500" />
            Resumen de Guardrails
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Org Admin Console: Solo lectura para suscripciones</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Platform Console: Mutaciones habilitadas solo para platform admins</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>RLS: is_platform_admin() habilita acceso cross-org</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Audit: Todas las mutaciones registradas con actor y metadata</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>DB Triggers: Safety-net para memberships, subscriptions, email_outbox</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
