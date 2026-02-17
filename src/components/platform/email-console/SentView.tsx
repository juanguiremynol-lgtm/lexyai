/**
 * SentView — Lists email_outbox entries for platform admin
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPlatformSent, type EmailConsoleFilters, type OutboxMessage } from "@/lib/platform/email-console-service";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Search, ChevronLeft, ChevronRight, SendHorizonal } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { MessageDetailPanel } from "./MessageDetailPanel";

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

  const activeFilters = { ...filters, search: search || undefined };

  const { data, isLoading } = useQuery({
    queryKey: ["platform-email-sent", activeFilters, page],
    queryFn: () => fetchPlatformSent(activeFilters, { page, pageSize: PAGE_SIZE }),
  });

  const messages = data?.data ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

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
      </div>

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
