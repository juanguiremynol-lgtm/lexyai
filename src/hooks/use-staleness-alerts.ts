/**
 * Staleness Alerts Hook
 * Manages estados staleness alerts for the current organization
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { businessDaysBetween } from "@/lib/staleness/business-days";

export interface StalenessAlert {
  id: string;
  organization_id: string;
  status: "ACTIVE" | "RESOLVED" | "DISMISSED";
  last_ingestion_at: string | null;
  alert_created_at: string;
  last_email_sent_at: string | null;
  resolved_at: string | null;
  emails_sent_count: number;
}

export interface IngestionRun {
  id: string;
  organization_id: string;
  owner_id: string;
  ingestion_type: string;
  source: string;
  status: string;
  rows_processed: number;
  rows_imported: number;
  rows_duplicate: number;
  rows_failed: number;
  created_at: string;
}

export interface StalenessSettings {
  enabled: boolean;
  emailEnabled: boolean;
  thresholdDays: number;
}

/**
 * Hook to get staleness settings for the organization
 */
export function useStalenessSettings() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ["staleness-settings", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data, error } = await supabase
        .from("organizations")
        .select("estados_staleness_alerts_enabled, estados_staleness_email_enabled, estados_staleness_threshold_days")
        .eq("id", organizationId)
        .single();

      if (error) throw error;

      return {
        enabled: data?.estados_staleness_alerts_enabled ?? true,
        emailEnabled: data?.estados_staleness_email_enabled ?? true,
        thresholdDays: data?.estados_staleness_threshold_days ?? 3,
      } as StalenessSettings;
    },
    enabled: !!organizationId,
  });
}

/**
 * Hook to update staleness settings
 */
export function useUpdateStalenessSettings() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useMutation({
    mutationFn: async (settings: Partial<StalenessSettings>) => {
      if (!organizationId) throw new Error("No organization selected");

      const updateData: Record<string, unknown> = {};
      if (settings.enabled !== undefined) {
        updateData.estados_staleness_alerts_enabled = settings.enabled;
      }
      if (settings.emailEnabled !== undefined) {
        updateData.estados_staleness_email_enabled = settings.emailEnabled;
      }
      if (settings.thresholdDays !== undefined) {
        updateData.estados_staleness_threshold_days = settings.thresholdDays;
      }

      const { error } = await supabase
        .from("organizations")
        .update(updateData)
        .eq("id", organizationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staleness-settings", organizationId] });
    },
  });
}

/**
 * Hook to get active staleness alert for the organization
 */
export function useActiveStalenessAlert() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ["staleness-alert", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data, error } = await supabase
        .from("estados_staleness_alerts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "ACTIVE")
        .maybeSingle();

      if (error) throw error;
      return data as StalenessAlert | null;
    },
    enabled: !!organizationId,
  });
}

/**
 * Hook to get the last successful ingestion for the organization
 */
export function useLastIngestion() {
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ["last-ingestion", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data, error } = await supabase
        .from("ingestion_runs")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "SUCCESS")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as IngestionRun | null;
    },
    enabled: !!organizationId,
  });
}

/**
 * Hook to dismiss a staleness alert
 */
export function useDismissStalenessAlert() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("estados_staleness_alerts")
        .update({
          status: "DISMISSED",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", alertId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staleness-alert", organizationId] });
    },
  });
}

/**
 * Calculate staleness info from last ingestion
 */
export function calculateStalenessInfo(lastIngestionAt: string | null, thresholdDays: number = 3) {
  if (!lastIngestionAt) {
    return {
      isStale: true,
      businessDaysSinceIngestion: null,
      lastIngestionDate: null,
    };
  }

  const lastDate = new Date(lastIngestionAt);
  const now = new Date();
  const daysSince = businessDaysBetween(lastDate, now);

  return {
    isStale: daysSince >= thresholdDays,
    businessDaysSinceIngestion: daysSince,
    lastIngestionDate: lastDate,
  };
}
