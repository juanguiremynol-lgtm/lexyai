import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface AlertEmailStatus {
  ok: boolean;
  membership_id: string;
  alert_email: string | null;
  alert_email_verified_at: string | null;
  pending_alert_email: string | null;
  pending_expires_at: string | null;
  effective_email: string | null;
  login_email: string | null;
  is_using_login_email: boolean;
}

export function useAlertEmail(organizationId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ["alert-email-status", organizationId];

  const { data: status, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<AlertEmailStatus | null> => {
      if (!organizationId) return null;
      const { data, error } = await supabase.functions.invoke("manage-alert-email", {
        body: { action: "status", organization_id: organizationId },
      });
      if (error) throw error;
      return data as AlertEmailStatus;
    },
    enabled: !!organizationId,
  });

  const setAlertEmail = useMutation({
    mutationFn: async (alertEmail: string) => {
      const { data, error } = await supabase.functions.invoke("manage-alert-email", {
        body: { action: "set", organization_id: organizationId, alert_email: alertEmail },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Error desconocido");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      if (data.auto_verified) {
        toast.success("Email de alertas configurado y verificado");
      } else if (data.verification_sent) {
        toast.success("Email de verificación enviado. Revisa tu bandeja de entrada.");
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resendVerification = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("manage-alert-email", {
        body: { action: "resend", organization_id: organizationId },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Error desconocido");
      return data;
    },
    onSuccess: () => {
      toast.success("Email de verificación reenviado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cancelPending = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("manage-alert-email", {
        body: { action: "cancel", organization_id: organizationId },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Error desconocido");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Cambio cancelado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const sendTestEmail = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("manage-alert-email", {
        body: { action: "test", organization_id: organizationId },
      });
      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Error desconocido");
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Correo de prueba enviado a ${data.test_sent_to}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return {
    status,
    isLoading,
    refetch,
    setAlertEmail,
    resendVerification,
    cancelPending,
    sendTestEmail,
  };
}
