/**
 * EmailSetupBanner — Shows setup progress and CTA in Platform Console pages.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";

const SETUP_STATE_ID = "00000000-0000-0000-0000-000000000001";

export function EmailSetupBanner() {
  const navigate = useNavigate();

  const { data: setupState } = useQuery({
    queryKey: ["email-setup-state-banner"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("system_email_setup_state") as any)
        .select("*")
        .eq("id", SETUP_STATE_ID)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    staleTime: 60_000,
  });

  const { data: settings } = useQuery({
    queryKey: ["system-email-settings-banner"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("system_email_settings") as any)
        .select("is_enabled")
        .maybeSingle();
      if (error) return null;
      return data;
    },
    staleTime: 60_000,
  });

  if (!setupState) return null;

  const steps = [
    setupState.step_resend_key_ok,
    setupState.step_from_identity_ok,
    true, // DNS (informational)
    setupState.step_test_send_ok,
    setupState.step_inbound_selected,
    setupState.step_inbound_selected,
    setupState.step_inbound_ok,
    settings?.is_enabled,
  ];
  const totalSteps = 8;
  const completedCount = steps.filter(Boolean).length;
  const isFullySetup = settings?.is_enabled && completedCount >= 5;

  if (isFullySetup) return null;

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        {completedCount === 0 ? (
          <AlertTriangle className="h-4 w-4 text-destructive" />
        ) : (
          <Mail className="h-4 w-4 text-primary" />
        )}
        <span className="text-sm">
          <strong>Email Setup:</strong> Paso {Math.min(completedCount + 1, totalSteps)} de {totalSteps}
        </span>
        <Badge variant="outline" className="text-xs">
          {completedCount}/{totalSteps} completados
        </Badge>
        {setupState.last_error_message && (
          <span className="text-xs text-destructive hidden md:inline">
            — {setupState.last_error_message}
          </span>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate("/platform/email-setup")}
        className="gap-1.5"
      >
        Completar setup <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
