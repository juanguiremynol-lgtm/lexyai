import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DeleteResult {
  ok: boolean;
  deleted_count: number;
  deleted_ids: string[];
  errors: Array<{ id: string; error: string }>;
  storage_files_deleted: number;
}

interface UseDeleteWorkItemsOptions {
  onSuccess?: (result: DeleteResult) => void;
  onError?: (error: Error) => void;
}

// Queries to invalidate after deletion
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
];

export function useDeleteWorkItems(options?: UseDeleteWorkItemsOptions) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (workItemIds: string[]): Promise<DeleteResult> => {
      const { data, error } = await supabase.functions.invoke<DeleteResult>("delete-work-items", {
        body: { work_item_ids: workItemIds, mode: "HARD_DELETE" },
      });

      if (error) {
        throw new Error(error.message || "Error al eliminar");
      }

      if (!data) {
        throw new Error("No se recibió respuesta del servidor");
      }

      return data;
    },
    onSuccess: (result) => {
      // Invalidate all relevant queries
      INVALIDATE_QUERIES.forEach((key) => {
        queryClient.invalidateQueries({ queryKey: [key] });
      });

      // Show success message
      if (result.deleted_count > 0) {
        const storageMsg = result.storage_files_deleted > 0 
          ? ` (${result.storage_files_deleted} archivos)` 
          : "";
        toast.success(
          `${result.deleted_count} elemento${result.deleted_count !== 1 ? "s" : ""} eliminado${result.deleted_count !== 1 ? "s" : ""}${storageMsg}`
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

  // Helper for single item delete
  const deleteSingle = (workItemId: string) => {
    return mutation.mutateAsync([workItemId]);
  };

  // Helper for bulk delete
  const bulkDelete = (workItemIds: string[]) => {
    return mutation.mutateAsync(workItemIds);
  };

  return {
    ...mutation,
    deleteSingle,
    bulkDelete,
    isDeleting: mutation.isPending,
  };
}
