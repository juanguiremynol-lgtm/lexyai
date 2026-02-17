/**
 * SentView — Lists email_outbox entries for platform admin with AI outbox analysis
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPlatformSent, type EmailConsoleFilters, type OutboxMessage } from "@/lib/platform/email-console-service";
import { analyzeOutboxHealth } from "@/lib/platform/email-ai-service";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Search, ChevronLeft, ChevronRight, SendHorizonal, Brain, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { MessageDetailPanel } from "./MessageDetailPanel";
import { toast } from "sonner";

const PAGE_SIZE = 20;

const outboxStatusBadge = (status: string, failedPermanent: boolean) => {
  if (failedPermanent) return "bg-destructive/10 text-destructive border-destructive/20";
  const map: Record<string, string> = {
    PENDING: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    SENT: "bg-green-500/10 text-green-500 border-green-500/20",
    DELIVERED: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    BOUNCED: "bg-red-500/10 text-red-500 border-red-500/20",
    FAILED: "bg-destructive/10 text-destructive border-destructive/20",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
};

export function SentView() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filters] = useState<EmailConsoleFilters>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  const activeFilters = { ...filters, search: search || undefined };

  const { data, isLoading } = useQuery({
    queryKey: ["platform-email-sent", activeFilters, page],
    queryFn: () => fetchPlatformSent(activeFilters, { page, pageSize: PAGE_SIZE }),
  });

  const messages = data?.data ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleAnalyze = async () => {
    setAnalysisLoading(true);
    try {
      const result = await analyzeOutboxHealth();
      setAnalysisResult(result);
      toast.success("Análisis de outbox completado por Atenia AI");
    } catch (err) {
      toast.error("Error en análisis de outbox");
      console.error(err);
    } finally {
      setAnalysisLoading(false);
    }
  };

  if (selectedId) {
    return (
      <MessageDetailPanel
        messageId={selectedId}
        direction="outbound"
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por asunto o destinatario..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{total} enviados</span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAnalyze}
          disabled={analysisLoading}
          className="gap-1.5 ml-auto"
        >
          {analysisLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
          Análisis IA
        </Button>
      </div>

      {/* AI Outbox Analysis */}
      {analysisResult && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" /> Análisis Outbox — Atenia AI
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  Entrega: {analysisResult.deliveryRate}
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => setAnalysisResult(null)} className="text-xs">
                  Cerrar
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{analysisResult.summary}</p>

            {analysisResult.issues?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> Emails con problemas
                </p>
                {analysisResult.issues.slice(0, 5).map((issue: any) => (
                  <div key={issue.id} className="text-xs text-muted-foreground border-l-2 border-destructive/40 pl-2">
                    <strong>{issue.to}</strong> — {issue.error}
                  </div>
                ))}
              </div>
            )}

            {analysisResult.recommendations?.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <strong>Recomendaciones:</strong>
                <ul className="list-disc pl-4 mt-1 space-y-0.5">
                  {analysisResult.recommendations.map((r: string, i: number) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : messages.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <SendHorizonal className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No hay emails enviados</p>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {messages.map((msg: OutboxMessage) => (
            <button
              key={msg.id}
              onClick={() => setSelectedId(msg.id)}
              className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm truncate">{msg.to_email}</span>
                  <Badge variant="outline" className={outboxStatusBadge(msg.status, msg.failed_permanent)}>
                    {msg.failed_permanent ? "FALLO PERMANENTE" : msg.status}
                  </Badge>
                  {msg.trigger_reason && (
                    <Badge variant="outline" className="bg-primary/5 text-primary/70 border-primary/20 text-xs">
                      {msg.trigger_reason}
                    </Badge>
                  )}
                </div>
                <p className="text-sm truncate">{msg.subject}</p>
                {msg.error && (
                  <p className="text-xs text-destructive truncate mt-0.5">{msg.error}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(msg.created_at), "dd MMM HH:mm", { locale: es })}
                </span>
                {msg.attempts > 0 && (
                  <p className="text-xs text-muted-foreground">×{msg.attempts}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            Siguiente <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
