/**
 * useWorkItemActions — single source of truth for lifecycle actions on any work_item
 * (dashboard cards, list rows, detail header). Consumers pick which actions to render
 * from `available` and invoke the matching `actions.*` function.
 *
 * Actions map to canonical RPC `set_work_item_lifecycle` via `softDeleteWorkItem`
 * (soft delete) / `setWorkItemLifecycle` (pause/resume/close) / `useRestoreWorkItems`
 * / `useHardPurgeWorkItems`. This hook does NOT open modals — callers own UX.
 */

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { setWorkItemLifecycle } from "@/lib/lifecycle";
import { softDeleteWorkItem } from "@/lib/services/work-item-delete-service";
import { useRestoreWorkItems } from "./use-restore-work-items";
import { useHardPurgeWorkItems } from "./use-hard-purge-work-items";

export type LifecycleView = "ACTIVE" | "PAUSED" | "CLOSED" | "DELETED";

export type WorkItemActionKey =
  | "pausar"
  | "reactivar"
  | "cerrar"
  | "eliminar"
  | "restaurar"
  | "eliminar_definitivo";

export interface WorkItemActionInput {
  id: string;
  radicado?: string | null;
  title?: string | null;
  client_id?: string | null;
  workflow_type?: string | null;
  lifecycle_state?: string | null;
  monitoring_enabled?: boolean | null;
  deleted_at?: string | null;
  purge_after?: string | null;
  stage?: string | null;
}

const INVALIDATE_KEYS = [
  "work-items",
  "work-item-detail",
  "work-items-cgp-pipeline",
  "work-items-laboral-pipeline",
  "work-items-penal-pipeline",
  "work-items-admin-pipeline",
  "gov-procedure-work-items",
  "cpaca-processes",
  "monitored-processes",
  "dashboard-stats",
  "archived-work-items",
  "cgp-items",
];

export function deriveLifecycleView(wi: WorkItemActionInput): LifecycleView {
  if (wi.lifecycle_state) {
    const s = wi.lifecycle_state.toUpperCase();
    if (s === "DELETED") return "DELETED";
    if (s === "PAUSED") return "PAUSED";
    if (s === "CLOSED" || wi.stage === "CLOSED") return "CLOSED";
    if (s === "ARCHIVED") return "DELETED"; // legacy
    return "ACTIVE";
  }
  if (wi.deleted_at) return "DELETED";
  if (wi.stage === "CLOSED") return "CLOSED";
  if (wi.monitoring_enabled === false) return "PAUSED";
  return "ACTIVE";
}

function actionsForState(state: LifecycleView): WorkItemActionKey[] {
  switch (state) {
    case "ACTIVE":
      return ["pausar", "cerrar", "eliminar"];
    case "PAUSED":
      return ["reactivar", "cerrar", "eliminar"];
    case "CLOSED":
      return ["reactivar", "eliminar"];
    case "DELETED":
      return ["restaurar", "eliminar_definitivo"];
  }
}

export interface UseWorkItemActionsOptions {
  /** Called after any successful mutation with the action performed. */
  onSuccess?: (action: WorkItemActionKey) => void;
  /** Called after a successful soft-delete to trigger the orphan-client flow. */
  onSoftDeleted?: (wi: WorkItemActionInput) => void;
}

export function useWorkItemActions(
  wi: WorkItemActionInput | null | undefined,
  options: UseWorkItemActionsOptions = {},
) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  // Lazy-load user id
  useState(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    return 0;
  });

  const state: LifecycleView = wi ? deriveLifecycleView(wi) : "ACTIVE";
  const available = actionsForState(state);

  const invalidate = useCallback(() => {
    INVALIDATE_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    if (wi?.id) {
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", wi.id] });
    }
  }, [queryClient, wi?.id]);

  const pausarMut = useMutation({
    mutationFn: async (reason?: string) => {
      if (!wi) throw new Error("Sin asunto");
      const { data: u } = await supabase.auth.getUser();
      const r = await setWorkItemLifecycle(supabase, {
        workItemId: wi.id,
        newState: "PAUSED",
        reason: reason ?? "USER_SUSPENDED",
        actor: "USER",
        actorUserId: u.user?.id ?? null,
      });
      if (!r.ok) throw new Error(r.error || "No se pudo pausar");
    },
    onSuccess: () => {
      toast.success("Monitoreo pausado");
      invalidate();
      options.onSuccess?.("pausar");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reactivarMut = useMutation({
    mutationFn: async () => {
      if (!wi) throw new Error("Sin asunto");
      const { data: u } = await supabase.auth.getUser();
      const r = await setWorkItemLifecycle(supabase, {
        workItemId: wi.id,
        newState: "ACTIVE",
        reason: "USER_REACTIVATE",
        actor: "USER",
        actorUserId: u.user?.id ?? null,
      });
      if (!r.ok) throw new Error(r.error || "No se pudo reactivar");
    },
    onSuccess: () => {
      toast.success("Monitoreo reactivado");
      invalidate();
      options.onSuccess?.("reactivar");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cerrarMut = useMutation({
    mutationFn: async (reason?: string) => {
      if (!wi) throw new Error("Sin asunto");
      const { data: u } = await supabase.auth.getUser();
      const r = await setWorkItemLifecycle(supabase, {
        workItemId: wi.id,
        newState: "CLOSED",
        reason: reason ?? "USER_CLOSED",
        actor: "USER",
        actorUserId: u.user?.id ?? null,
      });
      if (!r.ok) throw new Error(r.error || "No se pudo cerrar");
      await supabase
        .from("work_items")
        .update({ stage: "CLOSED", updated_at: new Date().toISOString() })
        .eq("id", wi.id);
    },
    onSuccess: () => {
      toast.success("Radicado cerrado");
      invalidate();
      options.onSuccess?.("cerrar");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restore = useRestoreWorkItems({
    onSuccess: () => {
      invalidate();
      options.onSuccess?.("restaurar");
    },
  });

  const hardPurge = useHardPurgeWorkItems({
    onSuccess: () => {
      invalidate();
      options.onSuccess?.("eliminar_definitivo");
    },
  } as any);

  const eliminarMut = useMutation({
    mutationFn: async (reason?: string) => {
      if (!wi) throw new Error("Sin asunto");
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Sesión expirada, vuelve a iniciar sesión");
      const r = await softDeleteWorkItem(supabase, wi.id, uid, reason);
      if (!r.success) throw new Error(r.error || "No se pudo eliminar");
    },
    onSuccess: () => {
      const label = wi?.radicado || wi?.title || "Asunto";
      toast.success(`${label} enviado a la papelera`, {
        description: "Recuperable con Andro IA durante 10 días.",
        action: wi
          ? {
              label: "Deshacer",
              onClick: () => restore.restoreSingle(wi.id),
            }
          : undefined,
        duration: 30_000,
      });
      invalidate();
      if (wi) options.onSoftDeleted?.(wi);
      options.onSuccess?.("eliminar");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar"),
  });

  const isPending =
    pausarMut.isPending ||
    reactivarMut.isPending ||
    cerrarMut.isPending ||
    eliminarMut.isPending ||
    restore.isRestoring ||
    (hardPurge as any).isPending === true;

  return {
    state,
    available,
    isPending,
    actions: {
      pausar: (reason?: string) => pausarMut.mutateAsync(reason),
      reactivar: () => reactivarMut.mutateAsync(),
      cerrar: (reason?: string) => cerrarMut.mutateAsync(reason),
      eliminar: (reason?: string) => eliminarMut.mutateAsync(reason),
      restaurar: () => (wi ? restore.restoreSingle(wi.id) : Promise.resolve()),
      eliminarDefinitivo: () => (wi ? (hardPurge as any).purgeSingle?.(wi.id) : Promise.resolve()),
    },
  };
}

/** Query helper — is the given client_id still referenced by any live work_item? */
export async function checkClientOrphaned(
  clientId: string,
  excludeWorkItemId?: string,
): Promise<boolean> {
  let q = supabase
    .from("work_items")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (excludeWorkItemId) q = q.neq("id", excludeWorkItemId);
  const { count } = await q;
  return (count ?? 0) === 0;
}

export async function deleteClientById(clientId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("clients").delete().eq("id", clientId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}