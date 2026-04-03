/**
 * CPNU Sync Service — Proxied through edge function to avoid CORS
 *
 * Mirrors management actions (pause, reactivate, close, delete) to the CPNU API
 * so the external monitoring database stays in sync with Supabase.
 * Errors are logged but never block the UI flow.
 */

import { supabase } from "@/integrations/supabase/client";

type CpnuAction = "pausar" | "reactivar" | "cerrar" | "eliminar";

async function invokeCpnuSync(action: CpnuAction, workItemId: string, razon?: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("cpnu-sync", {
      body: { action, workItemId, razon },
    });
    if (error) {
      console.warn(`[cpnu-sync] ${action} failed:`, error);
    }
  } catch (err) {
    console.warn(`[cpnu-sync] ${action} failed:`, err);
  }
}

/** Pause monitoring in Google Cloud SQL */
export function syncCpnuPausar(workItemId: string, razon?: string): Promise<void> {
  return invokeCpnuSync("pausar", workItemId, razon || "Suspendido desde UI");
}

/** Reactivate monitoring in Google Cloud SQL */
export function syncCpnuReactivar(workItemId: string): Promise<void> {
  return invokeCpnuSync("reactivar", workItemId);
}

/** Close (cerrar) radicado in Google Cloud SQL */
export function syncCpnuCerrar(workItemId: string, razon?: string): Promise<void> {
  return invokeCpnuSync("cerrar", workItemId, razon || "Cerrado desde UI");
}

/** Soft-delete in Google Cloud SQL */
export function syncCpnuEliminar(workItemId: string, razon?: string): Promise<void> {
  return invokeCpnuSync("eliminar", workItemId, razon || "Eliminado desde UI");
}
