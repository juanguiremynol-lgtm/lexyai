/**
 * CPNU Sync Service — Fire-and-forget calls to Google Cloud SQL
 *
 * Mirrors management actions (pause, reactivate, delete) to the CPNU API
 * so the external monitoring database stays in sync with Supabase.
 * Errors are logged but never block the UI flow.
 */

import { CPNU_API_BASE } from "@/lib/api-urls";

async function patchCpnu(path: string, body?: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(`${CPNU_API_BASE}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      console.warn(`[cpnu-sync] ${path} responded ${res.status}`);
    }
  } catch (err) {
    console.warn(`[cpnu-sync] ${path} failed:`, err);
  }
}

/** Pause monitoring in Google Cloud SQL */
export function syncCpnuPausar(workItemId: string, razon?: string): Promise<void> {
  return patchCpnu(`/work-items/${workItemId}/pausar`, { razon: razon || "Suspendido desde UI" });
}

/** Reactivate monitoring in Google Cloud SQL */
export function syncCpnuReactivar(workItemId: string): Promise<void> {
  return patchCpnu(`/work-items/${workItemId}/reactivar`);
}

/** Close (cerrar) radicado in Google Cloud SQL */
export function syncCpnuCerrar(workItemId: string, razon?: string): Promise<void> {
  return patchCpnu(`/work-items/${workItemId}/cerrar`, { razon: razon || "Cerrado desde UI" });
}

/** Soft-delete in Google Cloud SQL */
export function syncCpnuEliminar(workItemId: string, razon?: string): Promise<void> {
  return patchCpnu(`/work-items/${workItemId}/eliminar`, { razon: razon || "Eliminado desde UI" });
}
