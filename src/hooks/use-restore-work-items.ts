import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logRestore } from "@/lib/audit-log";

interface RestoreResult {
  success: boolean;
  restored_count: number;
  restored_ids: string[];
  errors: Array<{ id: string; error: string }>;
}

interface UseRestoreWorkItemsOptions {
  onSuccess?: (result: RestoreResult) => void;
  onError?: (error: Error) => void;
}

// Queries to invalidate after restore
const INVALIDATE_QUERIES = [
  "work-items",
  "work-item-detail",
  "cgp-items",
  "cgp-work-items",
  "peticiones",
  "tutelas",
  "cpaca-processes",
  "monitored-processes",
  "admin-processes",
  "filings",
  "alerts",
  "alert-instances",
  "tasks",
  "documents",
  "process-events",
  "archived-work-items",
];

export function useRestoreWorkItems(options?: UseRestoreWorkItemsOptions) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (workItemIds: string[]): Promise<RestoreResult> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Resolve caller's org membership + billing tier for authorization
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .single();

      const orgId = profile?.organization_id ?? null;
      let membershipRole: string | null = null;
      let isBusinessTier = false;

      if (orgId) {
        const { data: membership } = await supabase
          .from("organization_memberships")
          .select("role")
          .eq("organization_id", orgId)
          .eq("user_id", user.id)
          .maybeSingle();

        membershipRole = membership?.role ?? null;

        const { data: billing } = await supabase
          .from("billing_subscription_state")
          .select("plan_code")
          .eq("organization_id", orgId)
          .maybeSingle();

        isBusinessTier = ["BUSINESS", "ENTERPRISE"].includes(billing?.plan_code ?? "");
      }

      const isOrgAdmin = isBusinessTier && (membershipRole === "OWNER" || membershipRole === "ADMIN");

      const result: RestoreResult = {
        success: true,
        restored_count: 0,
        restored_ids: [],
        errors: [],
      };

      for (const id of workItemIds) {
        // Fetch the item to check ownership before restore
        const { data: item } = await supabase
          .from("work_items")
          .select("id, owner_id, organization_id")
          .eq("id", id)
          .not("deleted_at", "is", null)
          .maybeSingle();

        if (!item) {
          result.errors.push({ id, error: "No encontrado o no eliminado" });
          continue;
        }

        // AUTHORIZATION: owner OR business org admin (same org)
        const isOwner = item.owner_id === user.id;
        const isAdminSameOrg = isOrgAdmin && orgId && item.organization_id === orgId;

        if (!isOwner && !isAdminSameOrg) {
          result.errors.push({ id, error: "Sin permiso para restaurar este asunto" });
          continue;
        }

        const { error } = await supabase
          .from("work_items")
          .update({
            deleted_at: null,
            deleted_by: null,
            delete_reason: null,
            purge_after: null,
          })
          .eq("id", id);

        if (error) {
          result.errors.push({ id, error: error.message });
        } else {
          result.restored_count++;
          result.restored_ids.push(id);

          if (item.organization_id) {
            await logRestore(item.organization_id, "work_item", id, {
              restored_at: new Date().toISOString(),
              restored_by: user.id,
              authorization: { is_owner: isOwner, is_org_admin: isAdminSameOrg },
            });
          }
        }
      }

      result.success = result.errors.length === 0;
      return result;
    },
    onSuccess: (result) => {
      INVALIDATE_QUERIES.forEach((key) => {
        queryClient.invalidateQueries({ queryKey: [key] });
      });

      if (result.restored_count > 0) {
        toast.success(
          `${result.restored_count} elemento${result.restored_count !== 1 ? "s" : ""} restaurado${result.restored_count !== 1 ? "s" : ""}`
        );
      }

      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} elemento(s) no pudieron ser restaurados`);
      }

      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(`Error al restaurar: ${error.message}`);
      options?.onError?.(error);
    },
  });

  const restoreSingle = (workItemId: string) => {
    return mutation.mutateAsync([workItemId]);
  };

  const restoreBulk = (workItemIds: string[]) => {
    return mutation.mutateAsync(workItemIds);
  };

  return {
    ...mutation,
    restoreSingle,
    restoreBulk,
    isRestoring: mutation.isPending,
  };
}
