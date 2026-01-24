import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SoftDeleteResult {
  success: boolean;
  archived_count: number;
  archived_ids: string[];
  errors: Array<{ id: string; error: string }>;
}

interface UseSoftDeleteWorkItemsOptions {
  onSuccess?: (result: SoftDeleteResult) => void;
  onError?: (error: Error) => void;
}

// Queries to invalidate after soft delete
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

export function useSoftDeleteWorkItems(options?: UseSoftDeleteWorkItemsOptions) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (workItemIds: string[]): Promise<SoftDeleteResult> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const result: SoftDeleteResult = {
        success: true,
        archived_count: 0,
        archived_ids: [],
        errors: [],
      };

      // Soft delete each work item
      for (const id of workItemIds) {
        const { error } = await supabase
          .from("work_items")
          .update({
            deleted_at: new Date().toISOString(),
            deleted_by: user.id,
          })
          .eq("id", id)
          .eq("owner_id", user.id)
          .is("deleted_at", null); // Only delete if not already deleted

        if (error) {
          result.errors.push({ id, error: error.message });
        } else {
          result.archived_count++;
          result.archived_ids.push(id);

          // Create process_event for audit trail
          await supabase.from("process_events").insert({
            filing_id: id,
            owner_id: user.id,
            event_type: "SOFT_DELETED",
            description: "Elemento archivado (soft delete)",
            raw_data: {
              deleted_at: new Date().toISOString(),
              deleted_by: user.id,
            },
          });
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
      if (result.archived_count > 0) {
        toast.success(
          `${result.archived_count} elemento${result.archived_count !== 1 ? "s" : ""} archivado${result.archived_count !== 1 ? "s" : ""}`
        );
      }

      // Show partial errors if any
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} elemento(s) no pudieron ser archivados`);
      }

      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(`Error al archivar: ${error.message}`);
      options?.onError?.(error);
    },
  });

  // Helper for single item soft delete
  const archiveSingle = (workItemId: string) => {
    return mutation.mutateAsync([workItemId]);
  };

  // Helper for bulk soft delete
  const archiveBulk = (workItemIds: string[]) => {
    return mutation.mutateAsync(workItemIds);
  };

  return {
    ...mutation,
    archiveSingle,
    archiveBulk,
    isArchiving: mutation.isPending,
  };
}
