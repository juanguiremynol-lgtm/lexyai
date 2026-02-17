/**
 * InboxView — Lists system_email_messages for platform admin.
 * Supports: inbox, archived, and trash views with archive/delete/restore actions.
 * Atenia AI bulk scan. Zero-state guides to webhook setup.
 */

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { digestRecentEmails, type AIEmailDigestResult } from "@/lib/platform/email-ai-service";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2, Search, ChevronLeft, ChevronRight, Mail, Brain, AlertTriangle,
  Inbox, Settings2, Archive, Trash2, RotateCcw, ArchiveRestore,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  is_archived: boolean;
  deleted_at: string | null;
}

type ViewMode = "inbox" | "archived" | "trash";

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

interface InboxViewProps {
  viewMode?: ViewMode;
}

export function InboxView({ viewMode = "inbox" }: InboxViewProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestResult, setDigestResult] = useState<AIEmailDigestResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  const queryKey = ["platform-email-inbox", viewMode, search, page];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      let query = (supabase.from("system_email_messages") as any)
        .select("id, direction, folder, provider, provider_message_id, provider_status, from_raw, to_raw, cc_raw, subject, snippet, received_at, created_at, is_archived, deleted_at", { count: "exact" })
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Filter based on view mode
      if (viewMode === "inbox") {
        query = query.eq("is_archived", false).is("deleted_at", null);
      } else if (viewMode === "archived") {
        query = query.eq("is_archived", true).is("deleted_at", null);
      } else if (viewMode === "trash") {
        query = query.not("deleted_at", "is", null);
      }

      if (search) {
        query = query.or(`subject.ilike.%${search}%,from_raw.ilike.%${search}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: (data ?? []) as SystemEmailMessage[], count: count ?? 0 };
    },
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("inbox-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "system_email_messages", filter: "direction=eq.inbound" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["platform-email-inbox"] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const messages = data?.data ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // ── Bulk actions ──────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === messages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(messages.map(m => m.id)));
    }
  };

  const handleBulkAction = async (action: "archive" | "unarchive" | "trash" | "restore") => {
    if (selectedIds.size === 0) return;
    setActionLoading(true);
    try {
      const ids = Array.from(selectedIds);
      let updatePayload: Record<string, unknown> = {};

      if (action === "archive") updatePayload = { is_archived: true };
      else if (action === "unarchive") updatePayload = { is_archived: false };
      else if (action === "trash") updatePayload = { deleted_at: new Date().toISOString() };
      else if (action === "restore") updatePayload = { deleted_at: null, is_archived: false };

      const { error } = await (supabase.from("system_email_messages") as any)
        .update(updatePayload)
        .in("id", ids);

      if (error) throw error;

      const labels: Record<string, string> = {
        archive: "archivados",
        unarchive: "restaurados a bandeja",
        trash: "movidos a papelera",
        restore: "restaurados",
      };
      toast.success(`${ids.length} email(s) ${labels[action]}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["platform-email-inbox"] });
    } catch (err: any) {
      toast.error(err.message || "Error al procesar acción");
    } finally {
      setActionLoading(false);
    }
  };

  const handleEmptyTrash = async () => {
    setActionLoading(true);
    try {
      // Delete all trashed inbound messages permanently
      const { error } = await (supabase.from("system_email_messages") as any)
        .delete()
        .eq("direction", "inbound")
        .not("deleted_at", "is", null);

      if (error) throw error;
      toast.success("Papelera vaciada");
      queryClient.invalidateQueries({ queryKey: ["platform-email-inbox"] });
    } catch (err: any) {
      toast.error(err.message || "Error al vaciar papelera");
    } finally {
      setActionLoading(false);
    }
  };

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

  const viewLabels: Record<ViewMode, { title: string; icon: typeof Inbox; emptyText: string; emptyDesc: string }> = {
    inbox: {
      title: "Bandeja de entrada",
      icon: Inbox,
      emptyText: "No hay correos recibidos",
      emptyDesc: "Configura el webhook de entrada en el Setup Wizard.",
    },
    archived: {
      title: "Archivados",
      icon: Archive,
      emptyText: "No hay correos archivados",
      emptyDesc: "Los emails archivados se moverán aquí para mantener la bandeja limpia.",
    },
    trash: {
      title: "Papelera",
      icon: Trash2,
      emptyText: "La papelera está vacía",
      emptyDesc: "Los emails eliminados permanecen aquí 30 días antes de borrarse definitivamente.",
    },
  };

  const viewInfo = viewLabels[viewMode];
  const ViewIcon = viewInfo.icon;

  return (
    <div className="space-y-4">
      {/* Search + Actions bar */}
      <div className="flex items-center gap-3 flex-wrap">
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

        {/* Bulk action buttons */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-xs text-muted-foreground">{selectedIds.size} seleccionados</span>
            {viewMode === "inbox" && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleBulkAction("archive")} disabled={actionLoading} className="gap-1 text-xs">
                  <Archive className="h-3.5 w-3.5" /> Archivar
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleBulkAction("trash")} disabled={actionLoading} className="gap-1 text-xs text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </Button>
              </>
            )}
            {viewMode === "archived" && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleBulkAction("unarchive")} disabled={actionLoading} className="gap-1 text-xs">
                  <ArchiveRestore className="h-3.5 w-3.5" /> Mover a Bandeja
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleBulkAction("trash")} disabled={actionLoading} className="gap-1 text-xs text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </Button>
              </>
            )}
            {viewMode === "trash" && (
              <Button variant="outline" size="sm" onClick={() => handleBulkAction("restore")} disabled={actionLoading} className="gap-1 text-xs">
                <RotateCcw className="h-3.5 w-3.5" /> Restaurar
              </Button>
            )}
          </div>
        )}

        {selectedIds.size === 0 && viewMode === "inbox" && (
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
        )}

        {viewMode === "trash" && total > 0 && selectedIds.size === 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="gap-1 text-xs ml-auto" disabled={actionLoading}>
                <Trash2 className="h-3.5 w-3.5" /> Vaciar papelera
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Vaciar papelera?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminarán permanentemente todos los emails en la papelera. Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleEmptyTrash} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Eliminar todo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Trash notice */}
      {viewMode === "trash" && total > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-muted-foreground">
            Los emails en la papelera se eliminan automáticamente después de <strong>30 días</strong>.
          </span>
        </div>
      )}

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
            <ViewIcon className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">{viewInfo.emptyText}</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">{viewInfo.emptyDesc}</p>
            {viewMode === "inbox" && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-1.5"
                onClick={() => navigate("/platform/email-setup")}
              >
                <Settings2 className="h-3.5 w-3.5" /> Ir al Setup Wizard
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg divide-y">
          {/* Select all header */}
          <div className="px-4 py-2 flex items-center gap-3 bg-muted/30">
            <input
              type="checkbox"
              checked={selectedIds.size === messages.length && messages.length > 0}
              onChange={toggleSelectAll}
              className="rounded border-muted-foreground/40"
            />
            <span className="text-xs text-muted-foreground">Seleccionar todo</span>
          </div>

          {messages.map((msg) => (
            <div
              key={msg.id}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(msg.id)}
                onChange={() => toggleSelect(msg.id)}
                className="mt-1 rounded border-muted-foreground/40"
              />
              <button
                onClick={() => setSelectedId(msg.id)}
                className="flex-1 min-w-0 text-left"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm truncate">
                    {msg.from_raw}
                  </span>
                  <Badge variant="outline" className={statusBadge(msg.provider_status)}>
                    {msg.provider_status}
                  </Badge>
                  {viewMode === "trash" && msg.deleted_at && (
                    <Badge variant="outline" className="text-[10px] text-destructive border-destructive/20">
                      Borrado {format(new Date(msg.deleted_at), "dd MMM", { locale: es })}
                    </Badge>
                  )}
                </div>
                <p className="text-sm truncate">{msg.subject || "(Sin asunto)"}</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {msg.snippet || "Sin vista previa"}
                </p>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {viewMode === "inbox" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([msg.id])); handleBulkAction("archive"); }}
                    title="Archivar"
                  >
                    <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
                {viewMode === "inbox" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([msg.id])); handleBulkAction("trash"); }}
                    title="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
                <span className="text-xs text-muted-foreground whitespace-nowrap ml-1">
                  {format(new Date(msg.received_at || msg.created_at), "dd MMM HH:mm", { locale: es })}
                </span>
              </div>
            </div>
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
