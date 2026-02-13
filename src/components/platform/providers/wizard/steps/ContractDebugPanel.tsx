/**
 * Contract Debug Panel — Shows the exact request/response contract details
 * for an external provider E2E test.
 * 
 * Displays:
 *   - URL + path
 *   - Header names (not values)
 *   - Request JSON (redacted)
 *   - Response status + error snippet (redacted)
 */

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  ArrowUpRight, ArrowDownLeft, AlertTriangle, CheckCircle2, XCircle, 
  FileJson, Globe, KeyRound, Send
} from "lucide-react";

interface ContractDebugPanelProps {
  syncResult: {
    ok?: boolean;
    code?: string;
    error?: string;
    duration_ms?: number;
    inserted_actuaciones?: number;
    inserted_publicaciones?: number;
    [key: string]: unknown;
  } | null;
  traces: TraceStep[];
}

interface TraceStep {
  stage: string;
  result_code: string;
  ok: boolean;
  latency_ms: number;
  payload: Record<string, unknown>;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    // Redact JWT tokens
    if (value.match(/^eyJ[A-Za-z0-9_-]{20,}/)) return "[JWT_REDACTED]";
    // Redact long hex strings (likely API keys)
    if (value.match(/^[a-f0-9]{32,}$/i)) return "[KEY_REDACTED]";
    // Redact Bearer tokens
    if (value.toLowerCase().startsWith("bearer ")) return "Bearer [REDACTED]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/secret|key|token|password|authorization/i.test(k)) {
        result[k] = "[REDACTED]";
      } else {
        result[k] = redactValue(v);
      }
    }
    return result;
  }
  return value;
}

export function ContractDebugPanel({ syncResult, traces }: ContractDebugPanelProps) {
  // Find relevant trace steps
  const requestTrace = traces.find(t => t.stage === "EXT_PROVIDER_REQUEST");
  const responseTrace = traces.find(t => t.stage === "EXT_PROVIDER_RESPONSE");
  const secretTrace = traces.find(t => t.stage === "SECRET_RESOLUTION");
  const snapshotTrace = traces.find(t => t.stage === "SNAPSHOT_FETCHED");

  if (!requestTrace && !responseTrace) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/30 p-4 text-center text-sm text-muted-foreground">
        <FileJson className="h-5 w-5 mx-auto mb-2 opacity-50" />
        No hay datos de contrato disponibles. Ejecute un E2E primero.
      </div>
    );
  }

  const reqPayload = requestTrace?.payload || {};
  const resPayload = responseTrace?.payload || {};
  const statusCode = resPayload.status_code as number;
  const isError = statusCode && statusCode >= 400;

  return (
    <div className="space-y-3 mt-4">
      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <FileJson className="h-4 w-4 text-primary" />
        Contract Debug
      </h4>

      {/* Request Section */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Send className="h-3.5 w-3.5 text-primary" />
          <span>REQUEST</span>
        </div>

        {/* URL + Method */}
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="font-mono text-[10px]">POST</Badge>
          <Globe className="h-3 w-3 text-muted-foreground" />
          <code className="font-mono text-xs text-foreground">
            {String(reqPayload.url_host || "")}{String(reqPayload.url_path || "")}
          </code>
        </div>

        {/* Headers (names only) */}
        {reqPayload.header_names && (
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <KeyRound className="h-3 w-3" /> Headers presentes:
            </span>
            <div className="flex flex-wrap gap-1">
              {(reqPayload.header_names as string[]).map(h => (
                <Badge key={h} variant="secondary" className="font-mono text-[10px]">{h}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Auth type */}
        {reqPayload.auth_type && (
          <div className="text-[10px] text-muted-foreground">
            Auth: <span className="font-mono text-foreground">{reqPayload.auth_type as string}</span>
          </div>
        )}

        {/* Request body (redacted) */}
        {reqPayload.request_body && (
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3" /> Request body:
            </span>
            <ScrollArea className="max-h-32">
              <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap break-all">
                {JSON.stringify(redactValue(reqPayload.request_body), null, 2)}
              </pre>
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Response Section */}
      <div className={`rounded-lg border p-3 space-y-2 ${isError ? "bg-destructive/5 border-destructive/20" : "bg-card"}`}>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <ArrowDownLeft className="h-3.5 w-3.5 text-accent-foreground" />
          <span>RESPONSE</span>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <Badge variant={isError ? "destructive" : "default"} className="font-mono text-[10px]">
            {statusCode || "?"}
          </Badge>
          {isError ? (
            <XCircle className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          )}
          <span className="text-xs text-muted-foreground">
            {resPayload.body_kind as string} · {resPayload.bytes_length as number} bytes · {responseTrace?.latency_ms}ms
          </span>
        </div>

        {/* Content-Type */}
        {resPayload.content_type && (
          <div className="text-[10px] text-muted-foreground">
            Content-Type: <span className="font-mono text-foreground">{resPayload.content_type as string}</span>
          </div>
        )}

        {/* Error body (redacted) */}
        {resPayload.error_body_redacted && (
          <div className="space-y-1">
            <span className="text-[10px] text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Error body (redacted):
            </span>
            <ScrollArea className="max-h-40">
              <pre className="text-[10px] font-mono bg-destructive/5 rounded p-2 whitespace-pre-wrap break-all text-destructive">
                {resPayload.error_body_redacted as string}
              </pre>
            </ScrollArea>
          </div>
        )}

        {/* Snapshot parse info */}
        {snapshotTrace && (
          <div className="grid grid-cols-2 gap-2 text-[10px] mt-1">
            <div>
              <span className="text-muted-foreground">Format:</span>{" "}
              <span className="font-mono">{snapshotTrace.payload?.snapshot_format as string}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Parse OK:</span>{" "}
              <span className="font-mono">{String(snapshotTrace.payload?.parse_ok)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Has estados:</span>{" "}
              <span className="font-mono">{String(snapshotTrace.payload?.has_estados)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Has actuaciones:</span>{" "}
              <span className="font-mono">{String(snapshotTrace.payload?.has_actuaciones)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Secret resolution summary */}
      {secretTrace && (
        <div className="rounded-lg border bg-card p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5 text-accent-foreground" />
          <span>SECRET RESOLUTION</span>
        </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <span className="text-muted-foreground">Key mode:</span>{" "}
              <span className="font-mono">{secretTrace.payload?.platform_key_mode as string}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Decrypt:</span>{" "}
              <Badge variant={secretTrace.payload?.decrypt_ok ? "default" : "destructive"} className="text-[10px]">
                {secretTrace.payload?.decrypt_ok ? "OK" : "FAIL"}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Scope:</span>{" "}
              <span className="font-mono">{secretTrace.payload?.instance_scope as string}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Auth:</span>{" "}
              <span className="font-mono">{secretTrace.payload?.auth_mode as string}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
