/**
 * Platform Verification Tab - Production-grade acceptance tests
 * 
 * Features:
 * - System Gate banner with PASS/WARN/FAIL status
 * - Deterministic verification checks with strict rules
 * - Grouped checks by category with Accordion
 * - RLS probe self-tests + negative probe validation
 * - Export Acceptance Report JSON
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  ShieldCheck, 
  RefreshCw,
  Copy,
  Download,
  Play,
  FileCheck,
  ChevronRight
} from "lucide-react";
import { toast } from "sonner";
import type { VerificationSnapshot, ProbeResult } from "@/lib/platform-verification";
import { getRelativeTime } from "@/lib/platform-verification";
import {
  VerificationCheck,
  VerificationLevel,
  AcceptanceReport,
  evaluateSnapshot,
  evaluateProbes,
  evaluateRlsNegativeProbe,
  computeOverallStatus,
  countByLevel,
  groupByCategory,
  generateAcceptanceReport,
  getRecommendation
} from "@/lib/platform-verification-rules";

// Status badge component
function StatusBadge({ status, size = "default" }: { status: VerificationLevel; size?: "default" | "lg" }) {
  const config = {
    PASS: { icon: CheckCircle2, variant: "success" as const },
    FAIL: { icon: XCircle, variant: "destructive" as const },
    WARN: { icon: AlertTriangle, variant: "warning" as const }
  };
  const { icon: Icon, variant } = config[status];
  const sizeClasses = size === "lg" ? "text-base px-4 py-2" : "";
  
  return (
    <Badge variant={variant} className={sizeClasses}>
      <Icon className={size === "lg" ? "h-5 w-5 mr-2" : "h-3 w-3 mr-1"} />
      {status}
    </Badge>
  );
}

// Check row with evidence expandable
function CheckRow({ check }: { check: VerificationCheck }) {
  const [showEvidence, setShowEvidence] = useState(false);
  
  return (
    <div className="py-2 border-b border-border/30 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{check.label}</p>
          {check.details && (
            <p className="text-xs text-muted-foreground mt-0.5">{check.details}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-2">
          {check.evidence && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setShowEvidence(!showEvidence)}
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${showEvidence ? "rotate-90" : ""}`} />
              Evidence
            </Button>
          )}
          <StatusBadge status={check.level} />
        </div>
      </div>
      {showEvidence && check.evidence && (
        <pre className="mt-2 p-2 bg-muted/50 rounded text-xs overflow-auto max-h-32 font-mono">
          {JSON.stringify(check.evidence, null, 2)}
        </pre>
      )}
    </div>
  );
}

// Category section in accordion
function CategorySection({ 
  category, 
  checks 
}: { 
  category: string; 
  checks: VerificationCheck[];
}) {
  const counts = countByLevel(checks);
  const categoryStatus = computeOverallStatus(checks);
  
  return (
    <AccordionItem value={category}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center justify-between w-full pr-4">
          <span className="font-medium">{category}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {counts.pass > 0 && <span className="text-primary mr-2">✓{counts.pass}</span>}
              {counts.warn > 0 && <span className="text-secondary-foreground mr-2">⚠{counts.warn}</span>}
              {counts.fail > 0 && <span className="text-destructive">✗{counts.fail}</span>}
            </span>
            <StatusBadge status={categoryStatus} />
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-0 px-1">
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function PlatformVerificationTab() {
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([]);
  const [probesRunAt, setProbesRunAt] = useState<string | null>(null);
  const [rlsNegativeResult, setRlsNegativeResult] = useState<{
    ok: boolean;
    policies?: Array<{ table: string; has_platform_policy: boolean; has_org_policy: boolean }>;
    error?: string;
  } | null>(null);

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
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  // RLS Probes mutation
  const probesMutation = useMutation({
    mutationFn: async () => {
      const results: ProbeResult[] = [];
      const probes = [
        { name: "Organizations Cross-Org Read", table: "organizations", query: () => supabase.from("organizations").select("id", { count: "exact", head: true }) },
        { name: "Memberships Cross-Org Read", table: "organization_memberships", query: () => supabase.from("organization_memberships").select("id", { count: "exact", head: true }) },
        { name: "Audit Logs Cross-Org Read", table: "audit_logs", query: () => supabase.from("audit_logs").select("id", { count: "exact", head: true }) },
        { name: "Job Runs Read", table: "job_runs", query: () => supabase.from("job_runs").select("id", { count: "exact", head: true }) },
        { name: "System Health Events Read", table: "system_health_events", query: () => supabase.from("system_health_events").select("id", { count: "exact", head: true }) },
        { name: "Subscriptions Cross-Org Read", table: "subscriptions", query: () => supabase.from("subscriptions").select("id", { count: "exact", head: true }) },
        { name: "Platform Admins Read", table: "platform_admins", query: () => supabase.from("platform_admins").select("user_id", { count: "exact", head: true }) },
      ];

      for (const probe of probes) {
        const start = performance.now();
        try {
          const { count, error } = await probe.query();
          const duration = performance.now() - start;
          results.push({
            name: probe.name,
            table: probe.table,
            passed: !error,
            rowCount: error ? null : (count ?? 0),
            error: error?.message || null,
            duration_ms: Math.round(duration)
          });
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

      // Run RLS negative probe
      try {
        const { data, error } = await supabase.rpc("platform_rls_probe_negative");
        if (error) {
          setRlsNegativeResult({ ok: false, error: error.message });
        } else {
          setRlsNegativeResult(data as { ok: boolean; policies?: Array<{ table: string; has_platform_policy: boolean; has_org_policy: boolean }>; error?: string });
        }
      } catch (e) {
        setRlsNegativeResult({ ok: false, error: e instanceof Error ? e.message : "Unknown error" });
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

  // Compute all checks
  const allChecks = useMemo(() => {
    const checks: VerificationCheck[] = [];
    
    if (snapshot) {
      checks.push(...evaluateSnapshot(snapshot));
    }
    
    if (probeResults.length > 0) {
      checks.push(...evaluateProbes(probeResults));
    }
    
    if (rlsNegativeResult) {
      checks.push(...evaluateRlsNegativeProbe(rlsNegativeResult));
    }
    
    return checks;
  }, [snapshot, probeResults, rlsNegativeResult]);

  const overallStatus = useMemo(() => computeOverallStatus(allChecks), [allChecks]);
  const counts = useMemo(() => countByLevel(allChecks), [allChecks]);
  const groupedChecks = useMemo(() => groupByCategory(allChecks), [allChecks]);

  // Build export data
  const buildAcceptanceReport = useCallback((): AcceptanceReport => {
    return generateAcceptanceReport(allChecks);
  }, [allChecks]);

  // Copy to clipboard
  const handleCopyJson = useCallback(() => {
    const data = buildAcceptanceReport();
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success("Acceptance report copied to clipboard");
  }, [buildAcceptanceReport]);

  // Download JSON file
  const handleDownloadJson = useCallback(() => {
    const data = buildAcceptanceReport();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `acceptance_report_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Acceptance report downloaded");
  }, [buildAcceptanceReport]);

  // Refresh all
  const handleRefreshAll = useCallback(() => {
    refetchSnapshot();
    setProbeResults([]);
    setProbesRunAt(null);
    setRlsNegativeResult(null);
  }, [refetchSnapshot]);

  const categoryOrder = ["Schema", "Triggers", "RLS", "Activity", "Jobs", "Probes"];

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
            Production-grade acceptance tests for deployment readiness
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyJson} className="gap-1">
            <Copy className="h-4 w-4" />
            Copy
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadJson} className="gap-1">
            <FileCheck className="h-4 w-4" />
            Export Report
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefreshAll} className="gap-1">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* System Gate Banner */}
      {allChecks.length > 0 && (
        <Card className={`border-2 ${
          overallStatus === "PASS" ? "border-primary/50 bg-primary/5" :
          overallStatus === "WARN" ? "border-secondary/50 bg-secondary/10" :
          "border-destructive/50 bg-destructive/10"
        }`}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <StatusBadge status={overallStatus} size="lg" />
                <div>
                  <p className="font-medium">System Gate Status</p>
                  <p className="text-sm text-muted-foreground">
                    {getRecommendation(overallStatus)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{counts.pass}</div>
                  <div className="text-xs text-muted-foreground">PASS</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-secondary-foreground">{counts.warn}</div>
                  <div className="text-xs text-muted-foreground">WARN</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-destructive">{counts.fail}</div>
                  <div className="text-xs text-muted-foreground">FAIL</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {snapshotError && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Snapshot Failed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-foreground">{snapshotError.message}</p>
            {(snapshotError as unknown as { details?: string })?.details && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Show error details
                </summary>
                <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-40 font-mono">
                  {JSON.stringify((snapshotError as unknown as { details?: string }).details, null, 2)}
                </pre>
              </details>
            )}
            <Button variant="outline" size="sm" onClick={() => refetchSnapshot()} className="gap-1">
              <RefreshCw className="h-3 w-3" />
              Retry
            </Button>
          </CardContent>
        </Card>
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

      {/* Run Probes Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Play className="h-5 w-5" />
            RLS Probe Tests
          </CardTitle>
          <CardDescription>
            Live read-only queries to verify platform admin cross-org access and policy structure
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              Run All Probes
            </Button>
            {probesRunAt && (
              <span className="text-xs text-muted-foreground">
                Last run: {new Date(probesRunAt).toLocaleString("es-CO")} ({getRelativeTime(probesRunAt)})
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Grouped Checks Accordion */}
      {allChecks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Verification Checks</CardTitle>
            <CardDescription>
              Detailed results grouped by category
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" defaultValue={categoryOrder} className="w-full">
              {categoryOrder.map(category => {
                const checks = groupedChecks[category];
                if (!checks || checks.length === 0) return null;
                return (
                  <CategorySection 
                    key={category}
                    category={category}
                    checks={checks}
                  />
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Snapshot metadata */}
      {snapshot && (
        <p className="text-xs text-muted-foreground text-center">
          Snapshot generated at: {new Date(snapshot.generated_at).toLocaleString("es-CO")}
        </p>
      )}
    </div>
  );
}
