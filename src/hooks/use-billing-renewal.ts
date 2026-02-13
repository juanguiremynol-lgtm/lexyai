/**
 * Billing Renewal Hook
 * Frontend hook for triggering and monitoring renewal processing
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useRenewalProcessor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { organization_ids?: string[]; limit?: number }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch("/functions/v1/billing-renewal-processor", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to process renewals");
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["billing-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-events"] });
      toast.success(`${data.processed} renovaciones procesadas`);
    },
    onError: (error) => {
      toast.error(`Error: ${(error as Error).message}`);
    },
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      organization_id: string;
      price_point_id: string;
      discount_code_id?: string;
      amount_breakdown: {
        base_price_cop: number;
        discount_amount_cop: number;
        final_payable_cop: number;
        plan_id: string;
        billing_cycle_months: number;
      };
      period_start: string;
      period_end: string;
      invoice_reason: "RENEWAL" | "MANUAL" | "ONE_TIME";
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch("/functions/v1/billing-create-invoice", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to create invoice");
      }
      return data.invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-events"] });
      toast.success("Factura creada exitosamente");
    },
    onError: (error) => {
      toast.error(`Error: ${(error as Error).message}`);
    },
  });
}
