/**
 * useDeleteWorkItems — Unified DELETE hook for dashboard / pipeline / detail views.
 *
 * IMPORTANT: Per platform policy (see mem://architecture/work-item-centric-governance
 * "No hard deletes for users"), every user-triggered delete from the app must be a
 * SOFT delete with 10-day recovery. This hook is therefore a thin wrapper over
 * useSoftDeleteWorkItems that preserves the historical return shape
 * ({ deleted_count, deleted_ids, storage_files_deleted, errors, ok }) so existing
 * call sites do not have to change.
 *
 * The only surfaces allowed to invoke the true hard-purge edge function are:
 *   - Recycle Bin (ArchivedItemsSection)
 *   - Admin data lifecycle (AdminDataLifecycleTab)
 *   - Master delete (settings)
 * They must use `useHardPurgeWorkItems` from `./use-hard-purge-work-items`.
 */

import { useSoftDeleteWorkItems } from "./use-soft-delete-work-items";

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

export function useDeleteWorkItems(options?: UseDeleteWorkItemsOptions) {
  const soft = useSoftDeleteWorkItems({
    onSuccess: (softResult) => {
      const compatResult: DeleteResult = {
        ok: softResult.success,
        deleted_count: softResult.archived_count,
        deleted_ids: softResult.archived_ids,
        errors: softResult.errors,
        storage_files_deleted: 0,
      };
      options?.onSuccess?.(compatResult);
    },
    onError: options?.onError,
  });

  const deleteSingle = async (workItemId: string): Promise<DeleteResult> => {
    const r = await soft.archiveSingle(workItemId);
    return {
      ok: r.success,
      deleted_count: r.archived_count,
      deleted_ids: r.archived_ids,
      errors: r.errors,
      storage_files_deleted: 0,
    };
  };

  const bulkDelete = async (workItemIds: string[]): Promise<DeleteResult> => {
    const r = await soft.archiveBulk(workItemIds);
    return {
      ok: r.success,
      deleted_count: r.archived_count,
      deleted_ids: r.archived_ids,
      errors: r.errors,
      storage_files_deleted: 0,
    };
  };

  return {
    ...soft,
    deleteSingle,
    bulkDelete,
    isDeleting: soft.isArchiving,
  };
}
