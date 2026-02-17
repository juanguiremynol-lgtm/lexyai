/**
 * InboxView — Lists system_email_messages (direction=inbound) for platform admin
 * with Atenia AI bulk scan. Zero-state guides to webhook setup.
 */

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { digestRecentEmails, type AIEmailDigestResult } from "@/lib/platform/email-ai-service";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Search, ChevronLeft, ChevronRight, Mail, Brain, AlertTriangle, Inbox, Settings2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { MessageDetailPanel } from "./MessageDetailPanel";
import { useNavigate } from "react-router-dom";
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
  cc_raw: string[];
  subject: string | null;
  snippet: string | null;
  text_body: string | null;
  html_body: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
}

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    received: "bg-primary/10 text-primary border-primary/20",
    processed: "bg-primary/10 text-primary border-primary/20",
    sent: "bg-primary/10 text-primary border-primary/20",
    failed: "bg-destructive/10 text-destructive border-destructive/20",
    queued: "bg-muted text-muted-foreground",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
};

export function InboxView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestResult, setDigestResult] = useState<AIEmailDigestResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["platform-email-inbox", search, page],
    queryFn: async () => {
      let query = (supabase.from("system_email_messages") as any)
        .select("id, direction, folder, provider, provider_message_id, provider_status, from_raw, to_raw, cc_raw, subject, snippet, received_at, created_at", { count: "exact" })
        .eq("direction", "inbound")
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

  // Realtime subscription for new inbound messages
  useEffect(() => {
    const channel = supabase
      .channel("inbox-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "system_email_messages",
          filter: "direction=eq.inbound",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["platform-email-inbox"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const messages = data?.data ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleDigest = async () => {
    setDigestLoading(true);
    try {
      const result = await digestRecentEmails(20);
      setDigestResult(result);
      toast.success("Análisis de bandeja completado por Atenia AI");
    } catch (err) {
      toast.error("Error en análisis de bandeja");
      console.error(err);
    } finally {
      setDigestLoading(false);
    }
  };

  if (selectedId) {
    return (
      <MessageDetailPanel
        messageId={selectedId}
        direction="inbound"
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
            placeholder="Buscar por asunto o remitente..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{total} mensajes</span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDigest}
          disabled={digestLoading}
          className="gap-1.5 ml-auto"
        >
          {digestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
          Análisis IA
        </Button>
      </div>

      {/* AI Digest Result */}
      {digestResult && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" /> Resumen Atenia AI — {digestResult.totalAnalyzed} emails
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setDigestResult(null)} className="text-xs">
                Cerrar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{digestResult.summary}</p>
            {Object.keys(digestResult.classifications).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(digestResult.classifications).map(([type, count]) => (
                  <Badge key={type} variant="outline" className="text-xs">
                    {type}: {count as number}
                  </Badge>
                ))}
              </div>
            )}
            {digestResult.criticalItems.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> Items críticos
                </p>
                {digestResult.criticalItems.map((item) => (
                  <div key={item.id} className="text-xs text-muted-foreground border-l-2 border-destructive/40 pl-2">
                    <strong>{item.subject}</strong> — {item.reason}
                  </div>
                ))}
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
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">No hay correos recibidos aún</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Configura el webhook de entrada en el paso 4 del asistente de configuración para empezar a recibir correos.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 gap-1.5"
              onClick={() => navigate("/platform/email-setup")}
            >
              <Settings2 className="h-3.5 w-3.5" /> Ir al Setup Wizard
            </Button>
          </CardContent>
        </Card>
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
                    {msg.from_raw}
                  </span>
                  <Badge variant="outline" className={statusBadge(msg.provider_status)}>
                    {msg.provider_status}
                  </Badge>
                </div>
                <p className="text-sm truncate">{msg.subject || "(Sin asunto)"}</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {msg.snippet || "Sin vista previa"}
                </p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap mt-1">
                {format(new Date(msg.received_at || msg.created_at), "dd MMM HH:mm", { locale: es })}
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
