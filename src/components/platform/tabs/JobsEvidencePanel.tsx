/**
 * Jobs Evidence Panel - Forensic display for job run diagnostics
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Copy, 
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Clock
} from "lucide-react";
import { toast } from "sonner";
import type { JobRunEvidence, JobExpectedSignature, JobMismatchType } from "@/lib/platform-verification";
import { formatDuration, getRelativeTime, getMismatchHint } from "@/lib/platform-verification";

interface JobsEvidencePanelProps {
  expectedSignature: JobExpectedSignature;
  lastSeenExact: JobRunEvidence | null;
  lastSeenFuzzy: JobRunEvidence | null;
  recentJobNames: string[];
  mismatchType: JobMismatchType;
  showAlways?: boolean;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "OK") {
    return <CheckCircle2 className="h-4 w-4 text-primary" />;
  }
  if (status === "ERROR") {
    return <XCircle className="h-4 w-4 text-destructive" />;
  }
  return <AlertTriangle className="h-4 w-4 text-warning" />;
}

function JobRecordCard({ 
  title, 
  record, 
  isExact 
}: { 
  title: string; 
  record: JobRunEvidence; 
  isExact: boolean;
}) {
  const [showError, setShowError] = useState(false);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(record, null, 2));
    toast.success("Job record copied to clipboard");
  };

  return (
    <Card className="bg-muted/30">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <StatusIcon status={record.status} />
            {title}
          </CardTitle>
          <div className="flex items-center gap-2">
            {!isExact && (
              <Badge variant="secondary" className="text-xs">
                Fuzzy Match
              </Badge>
            )}
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 px-2 text-xs"
              onClick={handleCopyJson}
            >
              <Copy className="h-3 w-3 mr-1" />
              Copy JSON
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="py-2 px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">job_name</span>
            <p className="font-mono text-xs break-all">{record.job_name}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">status</span>
            <p className="font-mono text-xs">
              <Badge 
                variant={record.status === "OK" ? "default" : "destructive"} 
                className="text-xs"
              >
                {record.status}
              </Badge>
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">finished_at</span>
            <p className="font-mono text-xs">
              {record.finished_at 
                ? (
                  <span title={new Date(record.finished_at).toLocaleString("es-CO")}>
                    {getRelativeTime(record.finished_at)}
                  </span>
                )
                : <span className="text-destructive">NULL</span>
              }
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">duration</span>
            <p className="font-mono text-xs">{formatDuration(record.duration_ms)}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">processed_count</span>
            <p className="font-mono text-xs">{record.processed_count ?? "N/A"}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">preview_flag</span>
            <p className="font-mono text-xs">{record.preview_flag ? "true" : "false"}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">has_metadata</span>
            <p className="font-mono text-xs">{record.has_metadata ? "true" : "false"}</p>
          </div>
          {record.error && (
            <div className="col-span-2 md:col-span-4">
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 px-2 text-xs text-destructive"
                onClick={() => setShowError(!showError)}
              >
                {showError ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                Show Error
              </Button>
              {showError && (
                <pre className="mt-1 p-2 bg-destructive/10 rounded text-xs overflow-auto max-h-24 font-mono text-destructive">
                  {record.error}
                </pre>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function JobsEvidencePanel({
  expectedSignature,
  lastSeenExact,
  lastSeenFuzzy,
  recentJobNames,
  mismatchType,
  showAlways = false
}: JobsEvidencePanelProps) {
  // Only show if there's a mismatch or showAlways is true
  if (!showAlways && !mismatchType && lastSeenExact?.status === "OK" && lastSeenExact?.finished_at) {
    return null;
  }

  const showFuzzy = lastSeenFuzzy && (
    !lastSeenExact || 
    lastSeenFuzzy.id !== lastSeenExact?.id ||
    lastSeenFuzzy.job_name !== lastSeenExact?.job_name
  );

  return (
    <div className="space-y-4 mt-4 pt-4 border-t border-border/50">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Clock className="h-4 w-4 text-muted-foreground" />
        Job Evidence (Forensic)
      </div>

      {/* Expected Signature */}
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Expected Signature
          </CardTitle>
          <CardDescription className="text-xs">
            {expectedSignature.notes}
          </CardDescription>
        </CardHeader>
        <CardContent className="py-2 px-4">
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">job_name:</span>
              <code className="ml-1 font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                {expectedSignature.job_name}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">status:</span>
              <code className="ml-1 font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                {expectedSignature.success_status}
              </code>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mismatch Explanation */}
      {mismatchType && (
        <Card className="bg-warning/10 border-warning/30">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Why This is WARN: {mismatchType.replace(/_/g, " ")}
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-4">
            <div className="flex items-start gap-2">
              <Lightbulb className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                {getMismatchHint(mismatchType)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Last Seen Exact */}
      {lastSeenExact && (
        <JobRecordCard 
          title="Last Seen (Exact Match)" 
          record={lastSeenExact} 
          isExact={true} 
        />
      )}

      {/* Last Seen Fuzzy (only if different from exact) */}
      {showFuzzy && lastSeenFuzzy && (
        <JobRecordCard 
          title="Last Seen (Fuzzy Match)" 
          record={lastSeenFuzzy} 
          isExact={false} 
        />
      )}

      {/* No Records Found */}
      {!lastSeenExact && !lastSeenFuzzy && (
        <Card className="bg-muted/30">
          <CardContent className="py-4 text-center text-muted-foreground text-sm">
            No job run records found matching the expected job name or patterns.
          </CardContent>
        </Card>
      )}

      {/* Recent Job Names */}
      {recentJobNames.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">
            Recent job names (last 30 days):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {recentJobNames.map((name) => (
              <Badge 
                key={name} 
                variant={name === expectedSignature.job_name ? "default" : "outline"}
                className="text-xs font-mono"
              >
                {name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <Separator />
    </div>
  );
}
