/**
 * AteniaThreadView — Unified timeline for a single incident conversation.
 * Shows observations, actions, and messages in chronological order.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { updateConversationStatus, addMessage } from "@/lib/services/atenia-ai-conversations";
import { generateExportBundle } from "@/lib/services/atenia-ai-export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  ArrowLeft, Check, X, Copy, Download, Bot, Eye, Zap, MessageSquare,
  VolumeX, CheckCircle2, Loader2, Send,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { AteniaGeminiPanel } from "./AteniaGeminiPanel";

interface Props {
  conversationId: string;
  onBack: () => void;
  currentUserId: string;
}

interface TimelineEntry {
  _type: "message" | "observation" | "action";
  _at: string;
  [key: string]: unknown;
}

const ROLE_LABELS: Record<string, { label: string; icon: string }> = {
  system: { label: "Sistema", icon: "⚙️" },
  user: { label: "Usuario", icon: "👤" },
  admin: { label: "Admin", icon: "💬" },
  assistant: { label: "Asistente", icon: "🤖" },
  gemini: { label: "Gemini", icon: "🤖" },
};

export function AteniaThreadView({ conversationId, onBack, currentUserId }: Props) {
  const [adminNote, setAdminNote] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [geminiOpen, setGeminiOpen] = useState(false);
  const queryClient = useQueryClient();

  // Load conversation
  const { data: conv } = useQuery({
    queryKey: ["atenia-conversation", conversationId],
    queryFn: async () => {
      const { data } = await (supabase
        .from("atenia_ai_conversations") as any)
        .select("*")
        .eq("id", conversationId)
        .single();
      return data;
    },
  });

  // Load timeline
  const { data: timeline, isLoading } = useQuery({
    queryKey: ["atenia-thread-timeline", conversationId],
    queryFn: async () => {
      const [msgRes, obsRes, actRes] = await Promise.all([
        (supabase.from("atenia_ai_op_messages") as any)
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
        (supabase.from("atenia_ai_observations") as any)
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
        (supabase.from("atenia_ai_actions") as any)
          .select("id, action_type, actor, reasoning, action_result, status, evidence, work_item_id, provider, created_at, reversible")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
      ]);

      const entries: TimelineEntry[] = [
        ...(msgRes.data || []).map((m: any) => ({ ...m, _type: "message" as const, _at: m.created_at })),
        ...(obsRes.data || []).map((o: any) => ({ ...o, _type: "observation" as const, _at: o.created_at })),
        ...(actRes.data || []).map((a: any) => ({ ...a, _type: "action" as const, _at: a.created_at })),
      ];

      entries.sort((a, b) => new Date(a._at).getTime() - new Date(b._at).getTime());
      return entries;
    },
    refetchInterval: 15_000,
  });

  const handleAddNote = async () => {
    if (!adminNote.trim()) return;
    setIsSending(true);
    try {
      await addMessage(conversationId, "admin", adminNote, currentUserId);
      setAdminNote("");
      queryClient.invalidateQueries({ queryKey: ["atenia-thread-timeline", conversationId] });
    } catch {
      toast.error("Error al agregar nota");
    } finally {
      setIsSending(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    try {
      await updateConversationStatus(conversationId, status, currentUserId);
      queryClient.invalidateQueries({ queryKey: ["atenia-conversation", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["atenia-conversations"] });
      toast.success(`Estado cambiado a ${status}`);
    } catch {
      toast.error("Error al cambiar estado");
    }
  };

  const handleCopyBundle = async () => {
    try {
      const md = await generateExportBundle(conversationId, "MARKDOWN", currentUserId);
      await navigator.clipboard.writeText(md);
      toast.success("Bundle copiado al portapapeles");
    } catch {
      toast.error("Error al generar bundle");
    }
  };

  const handleDownloadJson = async () => {
    try {
      const json = await generateExportBundle(conversationId, "JSON", currentUserId);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `atenia-incident-${conversationId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("JSON descargado");
    } catch {
      toast.error("Error al descargar");
    }
  };

  const handleApproveAction = async (actionId: string) => {
    try {
      await (supabase.from("atenia_ai_actions") as any)
        .update({ action_result: "applied", status: "APPROVED" })
        .eq("id", actionId);
      queryClient.invalidateQueries({ queryKey: ["atenia-thread-timeline", conversationId] });
      toast.success("Acción aprobada");
    } catch {
      toast.error("Error al aprobar");
    }
  };

  const handleRejectAction = async (actionId: string) => {
    try {
      await (supabase.from("atenia_ai_actions") as any)
        .update({ action_result: "rejected", status: "SKIPPED" })
        .eq("id", actionId);
      queryClient.invalidateQueries({ queryKey: ["atenia-thread-timeline", conversationId] });
      toast.info("Acción rechazada");
    } catch {
      toast.error("Error al rechazar");
    }
  };

  if (!conv) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const severityIcon = conv.severity === "CRITICAL" ? "🔴" : conv.severity === "WARNING" ? "🟡" : "🟢";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-7 px-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span>{severityIcon}</span>
              <CardTitle className="text-base truncate">{conv.title}</CardTitle>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-[9px]">{conv.channel}</Badge>
              <span>·</span>
              <Badge
                variant={conv.status === "OPEN" ? "secondary" : "default"}
                className="text-[9px]"
              >
                {conv.status}
              </Badge>
              <span>·</span>
              <span>
                {formatDistanceToNow(new Date(conv.created_at), { addSuffix: true, locale: es })}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Timeline */}
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto border rounded-lg p-3">
            {(timeline || []).map((entry, idx) => (
              <div key={idx} className="border-b last:border-0 pb-2 last:pb-0">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
                  <span>
                    {new Date(entry._at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {entry._type === "observation" && (
                    <>
                      <Eye className="h-3 w-3" />
                      <Badge variant="outline" className="text-[9px]">{String(entry.kind)}</Badge>
                    </>
                  )}
                  {entry._type === "action" && (
                    <>
                      <Zap className="h-3 w-3" />
                      <Badge variant="outline" className="text-[9px] font-mono">{String(entry.action_type)}</Badge>
                      {(entry.status === "PLANNED" || entry.action_result === "pending_approval") ? (
                        <Badge variant="secondary" className="text-[9px]">Pendiente</Badge>
                      ) : (
                        <Badge variant="default" className="text-[9px]">{String(entry.status || entry.action_result)}</Badge>
                      )}
                    </>
                  )}
                  {entry._type === "message" && (
                    <>
                      <MessageSquare className="h-3 w-3" />
                      <span className="font-medium">
                        {ROLE_LABELS[String(entry.role)]?.icon} {ROLE_LABELS[String(entry.role)]?.label || String(entry.role)}
                      </span>
                    </>
                  )}
                </div>

                {entry._type === "observation" && (
                  <p className="text-xs">{String(entry.title ?? "")}</p>
                )}
                {entry._type === "action" && (
                  <>
                    <p className="text-xs">{String(entry.reasoning ?? "")}</p>
                    {(entry.status === "PLANNED" || entry.action_result === "pending_approval") && (
                      <div className="flex gap-2 mt-1">
                        <Button size="sm" className="h-5 text-[10px] px-2" onClick={() => handleApproveAction(String(entry.id))}>
                          ✅ Aprobar
                        </Button>
                        <Button size="sm" variant="outline" className="h-5 text-[10px] px-2" onClick={() => handleRejectAction(String(entry.id))}>
                          ❌ Rechazar
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {entry._type === "message" && (
                  <p className="text-xs whitespace-pre-wrap">{String(entry.content_text)}</p>
                )}
              </div>
            ))}
            {(!timeline || timeline.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">Sin actividad registrada</p>
            )}
          </div>
        )}

        {/* Admin note input */}
        <div className="flex gap-2">
          <Input
            placeholder="Agregar nota de admin..."
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
            className="h-8 text-xs"
          />
          <Button size="sm" className="h-8" onClick={handleAddNote} disabled={isSending || !adminNote.trim()}>
            <Send className="h-3 w-3" />
          </Button>
        </div>

        {/* Actions footer */}
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCopyBundle}>
            <Copy className="h-3 w-3 mr-1" /> Copiar bundle
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleDownloadJson}>
            <Download className="h-3 w-3 mr-1" /> JSON
          </Button>
          <Sheet open={geminiOpen} onOpenChange={setGeminiOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs">
                <Bot className="h-3 w-3 mr-1" /> Preguntar a Gemini
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-lg">
              <SheetHeader>
                <SheetTitle>Consultar a Gemini</SheetTitle>
              </SheetHeader>
              <AteniaGeminiPanel
                conversationId={conversationId}
                currentUserId={currentUserId}
              />
            </SheetContent>
          </Sheet>

          <div className="flex-1" />

          {conv.status === "OPEN" && (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleStatusChange("MUTED")}>
                <VolumeX className="h-3 w-3 mr-1" /> Silenciar
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => handleStatusChange("RESOLVED")}>
                <CheckCircle2 className="h-3 w-3 mr-1" /> Resolver
              </Button>
            </>
          )}
          {(conv.status === "RESOLVED" || conv.status === "MUTED") && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleStatusChange("OPEN")}>
              Reabrir
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
