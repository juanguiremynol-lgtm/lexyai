/**
 * Platform Verification Tab - Production-grade diagnostics and acceptance tests
 * 
 * Features:
 * - DB RPC snapshot with strict PASS/FAIL/WARN checks
 * - Trigger activity last-seen timestamps
 * - RLS probe self-tests (read-only)
 * - Export/copy JSON diagnostics
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  ShieldCheck, 
  Database, 
  Lock,
  Activity,
  RefreshCw,
  Copy,
  Download,
  Play,
  Clock,
  Zap,
  Server
} from "lucide-react";
import { toast } from "sonner";
import {
  VerificationSnapshot,
  ProbeResult,
  VerificationExport,
  CheckStatus,
  getRelativeTime,
  getActivityStatus,
  formatDuration,
  REQUIRED_EMAIL_COLUMNS,
  TRIGGER_ACTIONS,
  TriggerAction
} from "@/lib/platform-verification";

// Status badge component
function StatusBadge({ status }: { status: CheckStatus }) {
  const config = {
    PASS: { icon: CheckCircle2, variant: "success" as const },
    FAIL: { icon: XCircle, variant: "destructive" as const },
    WARN: { icon: AlertTriangle, variant: "warning" as const }
  };
  const { icon: Icon, variant } = config[status];
  return (
    <Badge variant={variant}>
      <Icon className="h-3 w-3 mr-1" />
      {status}
    </Badge>
  );
}

// Check row component
function CheckRow({ 
  name, 
  status, 
  evidence 
}: { 
  name: string; 
  status: CheckStatus; 
  evidence?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <div className="flex-1">
        <p className="text-sm font-medium">{name}</p>
        {evidence && (
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{evidence}</p>
        )}
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

export function PlatformVerificationTab() {
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([]);
  const [probesRunAt, setProbesRunAt] = useState<string | null>(null);

  // Fetch DB snapshot via RPC
  const { 
    data: snapshot, 
    error: snapshotError, 
    isLoading: snapshotLoading,
    refetch: refetchSnapshot 
  } = useQuery({
    queryKey: ["platform-verification-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("platform_verification_snapshot");
      if (error) throw error;
      return data as unknown as VerificationSnapshot;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1,
  });

  // RLS Probes mutation
  const probesMutation = useMutation({
    mutationFn: async () => {
      const results: ProbeResult[] = [];
      const probes = [
        { name: "Organizations Cross-Org Read", table: "organizations", query: () => supabase.from("organizations").select("id,name").limit(5) },
        { name: "Memberships Cross-Org Read", table: "organization_memberships", query: () => supabase.from("organization_memberships").select("id,organization_id,user_id,role").limit(5) },
        { name: "Audit Logs Cross-Org Read", table: "audit_logs", query: () => supabase.from("audit_logs").select("id,organization_id,action,created_at").order("created_at", { ascending: false }).limit(5) },
        { name: "Job Runs Read", table: "job_runs", query: () => supabase.from("job_runs").select("id,job_name,status,finished_at").order("created_at", { ascending: false }).limit(5) },
        { name: "System Health Events Read", table: "system_health_events", query: () => supabase.from("system_health_events").select("id,event_type,status,created_at").order("created_at", { ascending: false }).limit(5) },
        { name: "Subscriptions Cross-Org Read", table: "subscriptions", query: () => supabase.from("subscriptions").select("id,organization_id,status").limit(5) },
        { name: "Platform Admins Read", table: "platform_admins", query: () => supabase.from("platform_admins").select("user_id,role").limit(5) },
      ];

      for (const probe of probes) {
        const start = performance.now();
        try {
          const { data, error } = await probe.query();
          const duration = performance.now() - start;
          if (error) {
            results.push({
              name: probe.name,
              table: probe.table,
              passed: false,
              rowCount: null,
              error: error.message,
              duration_ms: Math.round(duration)
            });
          } else {
            results.push({
              name: probe.name,
              table: probe.table,
              passed: true,
              rowCount: Array.isArray(data) ? data.length : 0,
              error: null,
              duration_ms: Math.round(duration)
            });
          }
        } catch (e) {
          const duration = performance.now() - start;
          results.push({
            name: probe.name,
            table: probe.table,
            passed: false,
            rowCount: null,
            error: e instanceof Error ? e.message : "Unknown error",
            duration_ms: Math.round(duration)
          });
        }
      }

      return results;
    },
    onSuccess: (results) => {
      setProbeResults(results);
      setProbesRunAt(new Date().toISOString());
      const passed = results.filter(r => r.passed).length;
      toast.success(`RLS Probes completed: ${passed}/${results.length} passed`);
    },
    onError: (error) => {
      toast.error(`RLS Probes failed: ${error.message}`);
    }
  });

  // Build export object
  const buildExportData = useCallback((): VerificationExport => {
    return {
      exported_at: new Date().toISOString(),
      snapshot: snapshot || null,
      snapshot_error: snapshotError?.message || null,
      probes: probeResults,
      probes_run_at: probesRunAt
    };
  }, [snapshot, snapshotError, probeResults, probesRunAt]);

  // Copy to clipboard
  const handleCopyJson = useCallback(() => {
    const data = buildExportData();
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success("JSON copied to clipboard");
  }, [buildExportData]);

  // Download JSON file
  const handleDownloadJson = useCallback(() => {
    const data = buildExportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `platform_verification_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("JSON downloaded");
  }, [buildExportData]);

  // Refresh all
  const handleRefreshAll = useCallback(() => {
    refetchSnapshot();
    setProbeResults([]);
    setProbesRunAt(null);
  }, [refetchSnapshot]);

  // Compute summary stats
  const computeStats = () => {
    if (!snapshot) return { pass: 0, fail: 0, warn: 0 };
    
    let pass = 0, fail = 0, warn = 0;

    // Schema checks
    if (snapshot.schema.email_outbox_columns_ok) pass++; else fail++;
    if (snapshot.schema.email_outbox_indexes_ok) pass++; else fail++;

    // Trigger checks
    if (snapshot.triggers.audit_trigger_function_exists) pass++; else fail++;
    if (snapshot.triggers.organization_memberships_triggers_ok) pass++; else fail++;
    if (snapshot.triggers.subscriptions_trigger_ok) pass++; else fail++;
    if (snapshot.triggers.email_outbox_trigger_ok) pass++; else fail++;

    // RLS checks
    if (snapshot.rls.audit_logs_rls_enabled) pass++; else fail++;
    if (snapshot.rls.admin_notifications_rls_enabled) pass++; else fail++;
    if (snapshot.rls.subscriptions_rls_enabled) pass++; else fail++;
    if (snapshot.rls.organizations_rls_enabled) pass++; else fail++;

    // Activity checks - WARN if null but trigger exists
    TRIGGER_ACTIONS.forEach(action => {
      const timestamp = snapshot.activity_last_seen[action];
      const hasTrigger = action.includes("MEMBERSHIP") 
        ? snapshot.triggers.organization_memberships_triggers_ok
        : action.includes("SUBSCRIPTION")
        ? snapshot.triggers.subscriptions_trigger_ok
        : snapshot.triggers.email_outbox_trigger_ok;
      
      const status = getActivityStatus(timestamp, hasTrigger);
      if (status === "PASS") pass++;
      else if (status === "FAIL") fail++;
      else warn++;
    });

    return { pass, fail, warn };
  };

  const stats = computeStats();

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Platform Verification
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Production-grade diagnostics and acceptance tests
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyJson} className="gap-1">
            <Copy className="h-4 w-4" />
            Copy JSON
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadJson} className="gap-1">
            <Download className="h-4 w-4" />
            Download
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefreshAll} className="gap-1">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      {snapshot && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold text-primary">{stats.pass}</div>
              <div className="text-sm text-muted-foreground">PASS</div>
            </CardContent>
          </Card>
          <Card className="border-secondary/50 bg-secondary/20">
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold text-secondary-foreground">{stats.warn}</div>
              <div className="text-sm text-muted-foreground">WARN</div>
            </CardContent>
          </Card>
          <Card className="border-destructive/30 bg-destructive/10">
            <CardContent className="pt-4 text-center">
              <div className="text-3xl font-bold text-destructive">{stats.fail}</div>
              <div className="text-sm text-muted-foreground">FAIL</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Error state */}
      {snapshotError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Snapshot Failed</AlertTitle>
          <AlertDescription>{snapshotError.message}</AlertDescription>
        </Alert>
      )}

      {/* Loading state */}
      {snapshotLoading && (
        <Card>
          <CardContent className="py-8 text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Loading verification snapshot...</p>
          </CardContent>
        </Card>
      )}

      {/* Section 1: Schema Checks */}
      {snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5" />
              Schema Checks
            </CardTitle>
            <CardDescription>Database schema validation for critical tables</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <CheckRow
              name="email_outbox columns"
              status={snapshot.schema.email_outbox_columns_ok ? "PASS" : "FAIL"}
              evidence={`Found: ${snapshot.schema.email_outbox_columns_found?.join(", ") || "none"}`}
            />
            <CheckRow
              name="email_outbox indexes"
              status={snapshot.schema.email_outbox_indexes_ok ? "PASS" : "FAIL"}
              evidence={`${snapshot.schema.email_outbox_indexes_found?.length || 0} index(es) found`}
            />
          </CardContent>
        </Card>
      )}

      {/* Section 2: Trigger Checks */}
      {snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="h-5 w-5" />
              Trigger Checks
            </CardTitle>
            <CardDescription>Database trigger existence for audit safety-net</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <CheckRow
              name="audit_trigger_write_audit_log() function"
              status={snapshot.triggers.audit_trigger_function_exists ? "PASS" : "FAIL"}
            />
            <CheckRow
              name="organization_memberships triggers"
              status={snapshot.triggers.organization_memberships_triggers_ok ? "PASS" : "FAIL"}
            />
            <CheckRow
              name="subscriptions trigger"
              status={snapshot.triggers.subscriptions_trigger_ok ? "PASS" : "FAIL"}
            />
            <CheckRow
              name="email_outbox trigger"
              status={snapshot.triggers.email_outbox_trigger_ok ? "PASS" : "FAIL"}
            />
            {snapshot.triggers.triggers_found?.length > 0 && (
              <p className="text-xs text-muted-foreground pt-2 font-mono">
                Triggers found: {snapshot.triggers.triggers_found.join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 3: RLS Checks */}
      {snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lock className="h-5 w-5" />
              RLS Configuration
            </CardTitle>
            <CardDescription>Row Level Security enforcement status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <CheckRow
              name="audit_logs RLS enabled"
              status={snapshot.rls.audit_logs_rls_enabled ? "PASS" : "FAIL"}
              evidence={snapshot.rls.audit_logs_rls_forced ? "force_rls=true" : "force_rls=false"}
            />
            <CheckRow
              name="admin_notifications RLS enabled"
              status={snapshot.rls.admin_notifications_rls_enabled ? "PASS" : "FAIL"}
            />
            <CheckRow
              name="subscriptions RLS enabled"
              status={snapshot.rls.subscriptions_rls_enabled ? "PASS" : "FAIL"}
            />
            <CheckRow
              name="organizations RLS enabled"
              status={snapshot.rls.organizations_rls_enabled ? "PASS" : "FAIL"}
            />
          </CardContent>
        </Card>
      )}

      {/* Section 4: Trigger Activity Last-Seen */}
      {snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5" />
              Trigger Activity Last-Seen
            </CardTitle>
            <CardDescription>Most recent DB-trigger audit events</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {TRIGGER_ACTIONS.map(action => {
                const timestamp = snapshot.activity_last_seen[action];
                const hasTrigger = action.includes("MEMBERSHIP") 
                  ? snapshot.triggers.organization_memberships_triggers_ok
                  : action.includes("SUBSCRIPTION")
                  ? snapshot.triggers.subscriptions_trigger_ok
                  : snapshot.triggers.email_outbox_trigger_ok;
                const status = getActivityStatus(timestamp, hasTrigger);
                
                return (
                  <CheckRow
                    key={action}
                    name={action}
                    status={status}
                    evidence={timestamp 
                      ? `${new Date(timestamp).toLocaleString("es-CO")} (${getRelativeTime(timestamp)})`
                      : "never"
                    }
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section 5: Job Runs */}
      {snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Server className="h-5 w-5" />
              Job Runs (Scheduled Ops)
            </CardTitle>
            <CardDescription>Status of scheduled background operations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2">purge-old-audit-logs</h4>
              {snapshot.jobs.purge_old_audit_logs_last_run ? (
                <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Last Successful Run</span>
                    <Badge variant={snapshot.jobs.purge_old_audit_logs_last_run.status === "OK" ? "success" : "destructive"}>
                      {snapshot.jobs.purge_old_audit_logs_last_run.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(snapshot.jobs.purge_old_audit_logs_last_run.finished_at).toLocaleString("es-CO")}
                    </div>
                    <div>Duration: {formatDuration(snapshot.jobs.purge_old_audit_logs_last_run.duration_ms)}</div>
                    <div>Processed: {snapshot.jobs.purge_old_audit_logs_last_run.processed_count} records</div>
                    <div>Preview: {snapshot.jobs.purge_old_audit_logs_last_run.preview ? "Yes" : "No"}</div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No successful runs recorded</p>
              )}
              
              {snapshot.jobs.purge_old_audit_logs_last_error && (
                <div className="bg-destructive/10 rounded-lg p-3 mt-2 border border-destructive/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-destructive">Last Error</span>
                    <Badge variant="destructive">ERROR</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(snapshot.jobs.purge_old_audit_logs_last_error.finished_at).toLocaleString("es-CO")}
                  </p>
                  <p className="text-xs text-destructive mt-1 font-mono">
                    {snapshot.jobs.purge_old_audit_logs_last_error.error}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Section 6: RLS Probes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5" />
            RLS Probe Self-Tests
          </CardTitle>
          <CardDescription>
            Live read-only queries to verify platform admin cross-org access
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button
              onClick={() => probesMutation.mutate()}
              disabled={probesMutation.isPending}
              className="gap-2"
            >
              {probesMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run RLS Probes
            </Button>
            {probesRunAt && (
              <span className="text-xs text-muted-foreground">
                Last run: {new Date(probesRunAt).toLocaleString("es-CO")} ({getRelativeTime(probesRunAt)})
              </span>
            )}
          </div>

          {probeResults.length > 0 && (
            <div className="space-y-1 mt-4">
              {probeResults.map((probe, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border flex items-start gap-3 ${
                    probe.passed 
                      ? "bg-primary/5 border-primary/30" 
                      : "bg-destructive/10 border-destructive/30"
                  }`}
                >
                  {probe.passed ? (
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{probe.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{probe.table}</p>
                    {probe.passed ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        {probe.rowCount} row(s) returned in {probe.duration_ms}ms
                      </p>
                    ) : (
                      <p className="text-xs text-destructive mt-1 font-mono break-all">
                        {probe.error}
                      </p>
                    )}
                  </div>
                  <Badge variant={probe.passed ? "success" : "destructive"}>
                    {probe.passed ? "PASS" : "FAIL"}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {probeResults.length === 0 && !probesMutation.isPending && (
            <p className="text-sm text-muted-foreground">
              Click "Run RLS Probes" to execute read-only cross-org access tests
            </p>
          )}
        </CardContent>
      </Card>

      {/* Snapshot metadata */}
      {snapshot && (
        <p className="text-xs text-muted-foreground text-center">
          Snapshot generated at: {new Date(snapshot.generated_at).toLocaleString("es-CO")}
        </p>
      )}
    </div>
  );
}
