/**
 * use-email-connection — Outlook mailbox connection state for the signed-in
 * user, plus connect / disconnect / manual-sync actions.
 *
 * Token columns are never selected: they are bytea and only the service role
 * can decrypt them.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { OUTLOOK_SEND_ENABLED } from "@/lib/feature-flags";

export interface EmailConnection {
  id: string;
  provider: string;
  ms_account_email: string | null;
  status: "PENDING" | "CONNECTED" | "ERROR" | "REVOKED";
  last_error: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  can_send: boolean;
}

export function useEmailConnection() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["email-connection"],
    queryFn: async (): Promise<EmailConnection | null> => {
      const { data, error } = await supabase
        .from("user_email_connections")
        .select("id, provider, ms_account_email, status, last_error, connected_at, last_sync_at, can_send")
        .eq("provider", "outlook")
        .maybeSingle();
      if (error) throw error;
      return (data as EmailConnection | null) ?? null;
    },
    staleTime: 30_000,
  });

  const connect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("outlook-connect", { body: {} });
      if (error) throw error;
      if (!data?.authorize_url) throw new Error(data?.error ?? "No se pudo iniciar la conexión.");
      return data.authorize_url as string;
    },
    onSuccess: (url) => {
      const popup = window.open(url, "outlook-oauth", "width=520,height=680");
      if (!popup) {
        window.location.href = url;
        return;
      }
      const listener = (event: MessageEvent) => {
        if (event.data?.type !== "outlook-oauth") return;
        window.removeEventListener("message", listener);
        if (event.data.ok) toast.success("Outlook conectado");
        void queryClient.invalidateQueries({ queryKey: ["email-connection"] });
      };
      window.addEventListener("message", listener);
      const poll = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(poll);
          window.removeEventListener("message", listener);
          void queryClient.invalidateQueries({ queryKey: ["email-connection"] });
        }
      }, 1000);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("outlook-disconnect", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Outlook desconectado");
      void queryClient.invalidateQueries({ queryKey: ["email-connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation<
    { results?: { links_created?: number; messages_scanned?: number }[] },
    Error,
    { fullSweep?: boolean; lookbackMonths?: number } | void
  >({
    mutationFn: async (options) => {
      const { data, error } = await supabase.functions.invoke("outlook-sync", {
        body: options && options.fullSweep
          ? { full_sweep: true, lookback_months: options.lookbackMonths ?? 12 }
          : {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { results?: { links_created?: number; messages_scanned?: number }[] };
    },
    onSuccess: (data) => {
      const created = (data?.results ?? []).reduce((acc, r) => acc + (r.links_created ?? 0), 0);
      toast.success(created > 0 ? `${created} correo(s) vinculado(s)` : "Buzón revisado, sin correos nuevos por vincular");
      void queryClient.invalidateQueries({ queryKey: ["email-connection"] });
      void queryClient.invalidateQueries({ queryKey: ["work-item-email-links"] });
      void queryClient.invalidateQueries({ queryKey: ["suggested-email-links"] });
      void queryClient.invalidateQueries({ queryKey: ["detected-processes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connection = query.data ?? null;
  const isConnected = connection?.status === "CONNECTED";
  return {
    ...query,
    connection,
    isConnected,
    /** Sending is authorized, always behind the explicit confirmation modal. */
    canSend: Boolean(OUTLOOK_SEND_ENABLED && isConnected && connection?.can_send),
    /** True when the mailbox was connected before Mail.Send was granted. */
    needsReconnectForSend: Boolean(
      OUTLOOK_SEND_ENABLED && isConnected && !connection?.can_send,
    ),
    connect,
    disconnect,
    sync,
  };
}

export interface OutlookSendAuditEntry {
  id: string;
  created_at: string;
  recipients: string[];
  cc: string[];
  subject: string | null;
  attachment_count: number;
  attachment_names: string[];
  result: "SUCCESS" | "ERROR";
  error_message: string | null;
  work_item_id: string | null;
}

/** Immutable, user-owned history of every send attempt. */
export function useOutlookSendAuditLog(limit = 25) {
  return useQuery({
    queryKey: ["outlook-send-audit-log", limit],
    queryFn: async (): Promise<OutlookSendAuditEntry[]> => {
      const { data, error } = await supabase
        .from("outlook_send_audit_log")
        .select(
          "id, created_at, recipients, cc, subject, attachment_count, attachment_names, result, error_message, work_item_id",
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as OutlookSendAuditEntry[];
    },
    staleTime: 30_000,
  });
}

/**
 * NOTE: sending lives in `use-outlook-send.tsx`, which forces the two-step
 * confirmation screen. Never re-add an unguarded send mutation here.
 */

export interface WorkItemEmailLink {
  id: string;
  subject: string | null;
  sender: string | null;
  direction: "sent" | "received";
  received_at: string | null;
  has_attachments: boolean;
  web_link: string | null;
  matched_by: string;
  confidence: number;
  evidence_type: string | null;
  /** Acuses de recibo / respuestas automáticas: válidos pero sin sustancia. */
  low_content: boolean;
  /** Metadatos de evidencia (p. ej. enlace SGDE y su vigencia). */
  evidence_meta: SgdeEvidenceMeta | null;
  link_status: "CONFIRMED" | "SUGGESTED" | "DISMISSED";
}

export interface SgdeEvidenceMeta {
  access_url?: string | null;
  allowed_until?: string | null;
  expired?: boolean;
  offer_access_link?: boolean;
}

export function useWorkItemEmailLinks(workItemId: string | undefined) {
  return useQuery({
    queryKey: ["work-item-email-links", workItemId],
    queryFn: async (): Promise<WorkItemEmailLink[]> => {
      if (!workItemId) return [];
      const { data, error } = await supabase
        .from("work_item_email_links")
        .select(
          "id, subject, sender, direction, received_at, has_attachments, web_link, matched_by, confidence, evidence_type, low_content, evidence_meta, link_status",
        )
        .eq("work_item_id", workItemId)
        .neq("link_status", "DISMISSED")
        .order("received_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as WorkItemEmailLink[];
    },
    enabled: !!workItemId,
  });
}

/**
 * Confirm or dismiss a medium-confidence (SUGGESTED) email link.
 *
 * Without this the 0.5-0.7 band stays invisible and the PARTE matcher is dead
 * weight. Only the owner of the link can change its status (RLS).
 */
export function useUpdateEmailLinkStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "CONFIRMED" | "DISMISSED" }) => {
      const { error } = await supabase
        .from("work_item_email_links")
        .update({ link_status: status })
        .eq("id", id);
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      toast.success(status === "CONFIRMED" ? "Vínculo confirmado" : "Vínculo descartado");
      void queryClient.invalidateQueries({ queryKey: ["work-item-email-links"] });
      void queryClient.invalidateQueries({ queryKey: ["suggested-email-links"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface SuggestedEmailLink extends WorkItemEmailLink {
  work_item_id: string;
  matched_value: string | null;
  internet_message_id: string | null;
  message_id: string | null;
  work_items: {
    id: string;
    radicado: string | null;
    title: string | null;
    expediente_url?: string | null;
  } | null;
}

/**
 * Decisión por MENSAJE, no por fila. Un mismo correo puede haber generado N
 * filas hermanas (una por expediente candidato); descartarlo debe eliminarlas
 * todas, y confirmar una debe descartar el resto.
 */
export function useResolveEmailMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      internetMessageId,
      messageId,
      confirmLinkId,
    }: {
      internetMessageId: string | null;
      messageId: string | null;
      confirmLinkId?: string;
    }) => {
      let siblings = supabase
        .from("work_item_email_links")
        .update({ link_status: "DISMISSED" })
        .eq("link_status", "SUGGESTED");
      siblings = internetMessageId
        ? siblings.eq("internet_message_id", internetMessageId)
        : siblings.eq("message_id", messageId ?? "");
      if (confirmLinkId) siblings = siblings.neq("id", confirmLinkId);
      const { error } = await siblings;
      if (error) throw error;

      if (confirmLinkId) {
        const { error: confirmError } = await supabase
          .from("work_item_email_links")
          .update({ link_status: "CONFIRMED" })
          .eq("id", confirmLinkId);
        if (confirmError) throw confirmError;
      }
      return Boolean(confirmLinkId);
    },
    onSuccess: (confirmed) => {
      toast.success(confirmed ? "Vínculo confirmado" : "Correo descartado");
      void queryClient.invalidateQueries({ queryKey: ["work-item-email-links"] });
      void queryClient.invalidateQueries({ queryKey: ["suggested-email-links"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Confirma un correo SGDE y usa su enlace como acceso al expediente
 * electrónico del work item. Nunca se autopobla: siempre pasa por aquí.
 */
export function useApplySgdeAccessLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      linkId,
      workItemId,
      accessUrl,
    }: {
      linkId: string;
      workItemId: string;
      accessUrl: string;
    }) => {
      const { error: wiError } = await supabase
        .from("work_items")
        .update({ expediente_url: accessUrl })
        .eq("id", workItemId);
      if (wiError) throw wiError;
      const { error } = await supabase
        .from("work_item_email_links")
        .update({ link_status: "CONFIRMED" })
        .eq("id", linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Enlace de acceso al expediente guardado");
      void queryClient.invalidateQueries({ queryKey: ["suggested-email-links"] });
      void queryClient.invalidateQueries({ queryKey: ["work-item-email-links"] });
      void queryClient.invalidateQueries({ queryKey: ["work-item"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Global inbox of medium-confidence links awaiting the user's decision. */
export function useSuggestedEmailLinks() {
  return useQuery({
    queryKey: ["suggested-email-links"],
    queryFn: async (): Promise<SuggestedEmailLink[]> => {
      const { data, error } = await supabase
        .from("work_item_email_links")
        .select(
          "id, work_item_id, subject, sender, direction, received_at, has_attachments, web_link, matched_by, matched_value, confidence, evidence_type, low_content, evidence_meta, link_status, work_items(id, radicado, title, expediente_url)",
        )
        .eq("link_status", "SUGGESTED")
        .order("received_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as SuggestedEmailLink[];
    },
    staleTime: 30_000,
  });
}