import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { softDeleteWorkItem } from "@/lib/services/work-item-delete-service";

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
  "work-items-cgp-pipeline",
  "work-items-laboral-pipeline",
  "work-items-penal-pipeline",
  "gov-procedure-work-items",
  "tutelas-work-items",
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
  "dashboard-stats",
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

      // Soft delete each work item using the full service
      for (const id of workItemIds) {
        const deleteResult = await softDeleteWorkItem(supabase, id, user.id);

        if (deleteResult.success) {
          result.archived_count++;
          result.archived_ids.push(id);
        } else {
          result.errors.push({ id, error: deleteResult.error ?? "Error desconocido" });
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
          `${result.archived_count} asunto${result.archived_count !== 1 ? "s" : ""} eliminado${result.archived_count !== 1 ? "s" : ""}. Recuperable con Atenia AI por 10 días.`
        );
      }

      // Show partial errors if any
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} elemento(s) no pudieron ser eliminados`);
      }

      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(`Error al eliminar: ${error.message}`);
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
