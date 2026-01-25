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

      const result: RestoreResult = {
        success: true,
        restored_count: 0,
        restored_ids: [],
        errors: [],
      };

      // Restore each work item
      for (const id of workItemIds) {
        const { error } = await supabase
          .from("work_items")
          .update({
            deleted_at: null,
            deleted_by: null,
            delete_reason: null,
          })
          .eq("id", id)
          .eq("owner_id", user.id)
          .not("deleted_at", "is", null); // Only restore if already deleted

        if (error) {
          result.errors.push({ id, error: error.message });
        } else {
          result.restored_count++;
          result.restored_ids.push(id);

          // Get org ID for audit log
          const { data: item } = await supabase
            .from("work_items")
            .select("organization_id")
            .eq("id", id)
            .single();

          if (item?.organization_id) {
            await logRestore(item.organization_id, "work_item", id, {
              restored_at: new Date().toISOString(),
              restored_by: user.id,
            });
          }
        }
      }

      result.success = result.errors.length === 0;
      return result;
    },
    onSuccess: (result) => {
      // Invalidate all relevant queries
      INVALIDATE_QUERIES.forEach((key) => {
        queryClient.invalidateQueries({ queryKey: [key] });
      });

      // Show success message
      if (result.restored_count > 0) {
        toast.success(
          `${result.restored_count} elemento${result.restored_count !== 1 ? "s" : ""} restaurado${result.restored_count !== 1 ? "s" : ""}`
        );
      }

      // Show partial errors if any
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

  // Helper for single item restore
  const restoreSingle = (workItemId: string) => {
    return mutation.mutateAsync([workItemId]);
  };

  // Helper for bulk restore
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
