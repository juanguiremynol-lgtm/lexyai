/**
 * SentView — Lists system_email_messages (direction=outbound) for platform admin
 * with AI outbox analysis. Shows provider_status, provider_message_id, created_at.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyzeOutboxHealth } from "@/lib/platform/email-ai-service";
import { supabase } from "@/integrations/supabase/client";
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

interface SystemEmailMessage {
  id: string;
  direction: string;
  folder: string;
  provider: string;
  provider_message_id: string | null;
  provider_status: string;
  from_raw: string;
  to_raw: string[];
  subject: string | null;
  snippet: string | null;
  sent_at: string | null;
  created_at: string;
}

const sentStatusBadge = (status: string) => {
  const map: Record<string, string> = {
    queued: "bg-muted text-muted-foreground",
    sent: "bg-primary/10 text-primary border-primary/20",
    delivered: "bg-primary/10 text-primary border-primary/20",
    failed: "bg-destructive/10 text-destructive border-destructive/20",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
};

export function SentView() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["platform-email-sent", search, page],
    queryFn: async () => {
      let query = (supabase.from("system_email_messages") as any)
        .select("id, direction, folder, provider, provider_message_id, provider_status, from_raw, to_raw, subject, snippet, sent_at, created_at", { count: "exact" })
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search) {
        query = query.or(`subject.ilike.%${search}%,from_raw.ilike.%${search}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: (data ?? []) as SystemEmailMessage[], count: count ?? 0 };
    },
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
          {messages.map((msg) => (
            <button
              key={msg.id}
              onClick={() => setSelectedId(msg.id)}
              className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm truncate">
                    {Array.isArray(msg.to_raw) ? msg.to_raw.join(", ") : msg.to_raw}
                  </span>
                  <Badge variant="outline" className={sentStatusBadge(msg.provider_status)}>
                    {msg.provider_status}
                  </Badge>
                  {msg.provider_message_id && (
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {msg.provider_message_id.slice(0, 12)}…
                    </Badge>
                  )}
                </div>
                <p className="text-sm truncate">{msg.subject || "(Sin asunto)"}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap mt-1">
                {format(new Date(msg.sent_at || msg.created_at), "dd MMM HH:mm", { locale: es })}
              </span>
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
