/**
 * useHardPurgeWorkItems — Permanent (non-recoverable) purge of work items.
 *
 * Reserved for admin surfaces only:
 *   - Recycle Bin (ArchivedItemsSection)
 *   - Admin Data Lifecycle (AdminDataLifecycleTab)
 *   - Master Delete (settings)
 *
 * Regular users / dashboard / pipeline / detail views must use
 * `useDeleteWorkItems` (soft delete with 10-day recovery) instead.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit-log";

export interface HardPurgeResult {
  ok: boolean;
  deleted_count: number;
  deleted_ids: string[];
  errors: Array<{ id: string; error: string }>;
  storage_files_deleted: number;
}

interface Options {
  onSuccess?: (result: HardPurgeResult) => void;
  onError?: (error: Error) => void;
}

const INVALIDATE_QUERIES = [
  "work-items",
  "work-item-detail",
  "cgp-items",
  "cgp-work-items",
  "peticiones",
  "tutelas",
  "tutelas-work-items",
  "cpaca-processes",
  "cpaca-work-items-pipeline",
  "admin-processes",
  "archived-work-items",
  "admin-archived-work-items",
  "dashboard-stats",
  "dashboard",
  "alerts",
  "alert-instances",
  "tasks",
  "documents",
  "process-events",
];

export function useHardPurgeWorkItems(options?: Options) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (workItemIds: string[]): Promise<HardPurgeResult> => {
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase.functions.invoke<HardPurgeResult>("delete-work-items", {
        body: { work_item_ids: workItemIds, mode: "HARD_DELETE" },
      });
      if (error) throw new Error(error.message || "Error al eliminar permanentemente");
      if (!data) throw new Error("No se recibió respuesta del servidor");

      if (data.deleted_count > 0 && user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("organization_id")
          .eq("id", user.id)
          .single();

        if (profile?.organization_id) {
          await logAudit({
            organizationId: profile.organization_id,
            action: "RECYCLE_BIN_PURGED",
            entityType: "work_item",
            metadata: {
              purged_count: data.deleted_count,
              purged_ids: data.deleted_ids,
              storage_files_deleted: data.storage_files_deleted,
              errors_count: data.errors.length,
            },
          });
        }
      }
      return data;
    },
    onSuccess: (result) => {
      INVALIDATE_QUERIES.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

      if (result.deleted_count > 0) {
        const storageMsg = result.storage_files_deleted > 0
          ? ` (${result.storage_files_deleted} archivos)`
          : "";
        toast.success(
          `${result.deleted_count} elemento${result.deleted_count !== 1 ? "s" : ""} eliminado${result.deleted_count !== 1 ? "s" : ""} permanentemente${storageMsg}`,
        );
      }

      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} elemento(s) no pudieron ser eliminados`);
      }

      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(`Error al eliminar permanentemente: ${error.message}`);
      options?.onError?.(error);
    },
  });

  const purgeSingle = (workItemId: string) => mutation.mutateAsync([workItemId]);
  const purgeBulk = (workItemIds: string[]) => mutation.mutateAsync(workItemIds);

  return {
    ...mutation,
    purgeSingle,
    purgeBulk,
    isPurging: mutation.isPending,
  };
}