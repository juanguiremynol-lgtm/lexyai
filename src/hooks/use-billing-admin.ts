/**
 * Billing Admin Hooks — Frontend integration with admin edge functions
 * 
 * Handles mutation calls for plans, discounts, and subscription overrides
 * All calls include proper auth, error handling, and optimistic updates
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ============= Plans & Pricing =============

export function useCreatePriceSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      plan_id: string;
      new_price_cop_incl_iva: number;
      effective_at: string;
      scope: "NEW_ONLY" | "RENEWALS" | "ALL";
      reason?: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch("/functions/v1/billing-admin-plans", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to create price schedule");
      }
      return data.schedule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-price-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["platform-billing-plans-admin"] });
      toast.success("Cambio de precio programado");
    },
    onError: (error) => {
      toast.error(`Error: ${(error as Error).message}`);
    },
  });
}

export function useApplyPriceSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch("/functions/v1/billing-admin-plans", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ schedule_id: scheduleId }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to apply schedule");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-price-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["platform-billing-plans-admin"] });
      toast.success("Cambio de precio aplicado");
    },
    onError: (error) => {
      toast.error(`Error: ${(error as Error).message}`);
    },
  });
}

// ============= Discounts & Vouchers =============

export function useCreateDiscountCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      code: string;
      discount_type: "PERCENT" | "FIXED_COP";
      discount_value: number;
      eligible_plans?: string[];
      eligible_cycles?: number[];
      max_redemptions?: number | null;
      valid_from?: string;
      valid_to?: string | null;
      target_org_id?: string | null;
      target_user_email?: string | null;
      notes?: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch("/functions/v1/billing-admin-discounts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to create discount code");
      }
      return data.discount;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-discount-codes"] });
      toast.success("Código de descuento creado");
    },
    onError: (error) => {
      toast.error(`Error: ${(error as Error).message}`);
    },
  });
}

export function useUpdateDiscountCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { code_id: string; is_active: boolean }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch("/functions/v1/billing-admin-discounts", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to update discount code");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-discount-codes"] });
      toast.success("Código actualizado");
    },
    onError: (error) => {
      toast.error(`Error: ${(error as Error).message}`);
    },
  });
}

// ============= Subscription Overrides =============

export function useAdminSubscriptionAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      organization_id: string;
      action: "FORCE_RE_VERIFY" | "EXTEND_TRIAL" | "SCHEDULE_CANCELLATION" | "REVERSE_CANCELLATION" | "GRANT_COMP";
      duration_days?: number;
      reason: string;
      notes?: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch("/functions/v1/billing-admin-subscriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to perform admin action");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-subscription-state"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-events"] });
      toast.success("Acción completada exitosamente");
    },
    onError: (error) => {
      toast.error(`Error: ${(error as Error).message}`);
    },
  });
}
