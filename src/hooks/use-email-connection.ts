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

export interface EmailConnection {
  id: string;
  provider: string;
  ms_account_email: string | null;
  status: "PENDING" | "CONNECTED" | "ERROR" | "REVOKED";
  last_error: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
}

export function useEmailConnection() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["email-connection"],
    queryFn: async (): Promise<EmailConnection | null> => {
      const { data, error } = await supabase
        .from("user_email_connections")
        .select("id, provider, ms_account_email, status, last_error, connected_at, last_sync_at")
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

  const sync = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("outlook-sync", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { results?: { links_created?: number; messages_scanned?: number }[] };
    },
    onSuccess: (data) => {
      const created = (data?.results ?? []).reduce((acc, r) => acc + (r.links_created ?? 0), 0);
      toast.success(created > 0 ? `${created} correo(s) vinculado(s)` : "Buzón revisado, sin correos nuevos por vincular");
      void queryClient.invalidateQueries({ queryKey: ["email-connection"] });
      void queryClient.invalidateQueries({ queryKey: ["work-item-email-links"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { ...query, connection: query.data ?? null, connect, disconnect, sync };
}

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
  link_status: "CONFIRMED" | "SUGGESTED" | "DISMISSED";
}

export function useWorkItemEmailLinks(workItemId: string | undefined) {
  return useQuery({
    queryKey: ["work-item-email-links", workItemId],
    queryFn: async (): Promise<WorkItemEmailLink[]> => {
      if (!workItemId) return [];
      const { data, error } = await supabase
        .from("work_item_email_links")
        .select(
          "id, subject, sender, direction, received_at, has_attachments, web_link, matched_by, confidence, evidence_type, link_status",
        )
        .eq("work_item_id", workItemId)
        .neq("link_status", "DISMISSED")
        .order("received_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WorkItemEmailLink[];
    },
    enabled: !!workItemId,
  });
}