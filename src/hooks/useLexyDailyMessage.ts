/**
 * useLexyDailyMessage Hook
 *
 * Fetches today's Lexy daily message for the current user.
 * Shows the message card on dashboard if not yet seen.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export interface LexyDailyMessage {
  id: string;
  user_id: string;
  organization_id: string;
  message_date: string;
  greeting: string;
  summary_body: string;
  highlights: Array<{ icon: string; text: string }>;
  closing: string | null;
  alerts_included: string[];
  work_items_covered: number;
  new_actuaciones_count: number;
  new_publicaciones_count: number;
  critical_alerts_count: number;
  delivered_via: string[];
  seen_at: string | null;
  created_at: string;
}

function todayCOT(): string {
  const now = new Date();
  const cot = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cot.toISOString().slice(0, 10);
}

export function useLexyDailyMessage() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  const today = todayCOT();

  const { data: message, isLoading } = useQuery({
    queryKey: ["lexy-daily-message", userId, today],
    queryFn: async () => {
      if (!userId) return null;

      const { data, error } = await (supabase
        .from("lexy_daily_messages" as any) as any)
        .select("*")
        .eq("user_id", userId)
        .eq("message_date", today)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn("[useLexyDailyMessage] Error:", error.message);
        return null;
      }

      // Type the response explicitly instead of relying on generated types
      return data as LexyDailyMessage | null;
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      if (!message) return;
      await (supabase
        .from("lexy_daily_messages" as any) as any)
        .update({ seen_at: new Date().toISOString() })
        .eq("id", message.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lexy-daily-message"] });
    },
  });

  return {
    message: message || null,
    isNew: !!message && !message.seen_at,
    isLoading,
    dismiss: () => dismissMutation.mutate(),
  };
}
