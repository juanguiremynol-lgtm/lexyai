import { supabase } from "@/integrations/supabase/client";

export type ConnectionPermission = "read" | "manage";
export type AuthorizationIdentity = { client_id: string; client_name: string; scope: string };
export const AI_CONNECTIONS_PATH = "/app/settings/connections#ai-connections";
export const MANAGEMENT_SCOPE = [
  "Crear y editar asuntos propios, asignar radicados y mover etapas.",
  "Resolver sugerencias, alertas y preguntas de asociación de correos; gestionar tareas y términos.",
  "Archivar, enviar a papelera y restaurar, con recuperación durante diez días.",
];
export const MANAGEMENT_BOUNDARY = "No permite purga directa, enviar mensajes ni administrar tu cuenta. Cada acción conserva tus permisos y debe estar disponible.";
export function managementScopeAllowed(scope: string): boolean {
  const scopes = scope.split(/\s+/);
  return !scopes.includes("andromeda:read") || scopes.includes("andromeda:manage");
}
export async function authorizationIdentity(id: string): Promise<AuthorizationIdentity> {
  const { data, error } = await supabase.rpc("mcp_native_authorization_identity", { p_authorization_id: id });
  if (error) throw new Error("No se pudo verificar esta solicitud. Puede haber vencido; vuelve a conectar desde tu asistente.");
  const value = data as unknown as { client?: { id?: string; name?: string | null }; scope?: string } | null;
  if (!value || typeof value.client?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.client.id) || (value.client.name != null && typeof value.client.name !== "string") || (value.scope != null && typeof value.scope !== "string")) {
    throw new Error("No se pudo identificar la herramienta que solicita acceso.");
  }
  return { client_id: value.client.id, client_name: value.client.name?.trim() || "Aplicación de IA", scope: value.scope ?? "" };
}
export async function saveConnectionPermission(clientId: string, permission: ConnectionPermission) {
  const { error } = permission === "manage"
    ? await supabase.rpc("grant_mcp_client_access", { p_oauth_client_id: clientId, p_access_level: "manage" })
    : await supabase.rpc("revoke_mcp_client_access", { p_oauth_client_id: clientId });
  if (error) throw new Error("No se pudo guardar el permiso. La conexión no ha continuado.");
  const { data, error: readError } = await supabase.rpc("list_my_mcp_connections");
  const rows = Array.isArray(data) ? data as unknown as Array<{ oauth_client_id?: string; access_level?: string }> : [];
  const matches = rows.filter(row => row.oauth_client_id === clientId);
  if (readError || matches.length !== 1 || matches[0].access_level !== permission) {
    throw new Error("No se pudo confirmar el permiso guardado. Reintenta antes de continuar.");
  }
}

// Callback codes remain exclusively in component memory; this function never stores them.
export function followAuthorizationCallback(target: string) {
  window.location.assign(target);
}
