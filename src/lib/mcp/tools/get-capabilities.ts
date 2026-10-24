import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

const MANAGE_TOOLS = [
  "add_note", "add_hearing", "update_work_item", "manage_deadline", "manage_task", "whatsapp_prepare",
  "create_work_item", "change_work_item_lifecycle", "move_work_item_stage", "resolve_stage_suggestion",
  "resolve_alert", "set_notification_state", "resolve_email_question", "add_email_association",
  "resolve_detected_process",
  "assign_work_item_radicado",
];

export default defineTool({
  name: "get_capabilities",
  title: "Permisos efectivos de esta conexión",
  description:
    "Read-only. Returns this connection's effective access level (read or manage) as decided by Andromeda's database for the verified user and OAuth client. Call before proposing any change.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    const [{ data: level, error: e1 }, { data: caller, error: e2 }, { data: availability, error: e3 }] = await Promise.all([
      sb.rpc("mcp_access_level"),
      sb.rpc("mcp_caller_context"),
      sb.rpc("mcp_mutation_availability"),
    ]);
    if (e1 || e2 || e3) return errorResult("No se pudo verificar la disponibilidad de esta conexión. Vuelve a conectarla o reintenta la consulta.");
    const c = (caller ?? {}) as Record<string, unknown>;
    const a = availability as { verified?: boolean; tools?: Record<string, { available?: boolean; execution_available?: boolean }> } | null;
    if (a?.verified !== true || !a.tools) return errorResult("Disponibilidad no verificada; no se autoriza proponer cambios.");
    const verified = level !== "none" && c.authenticated === true;
    const hasGrant = verified && (level === "manage" || level === "first_party");
    const available = MANAGE_TOOLS.filter((name) => hasGrant && a.tools?.[name]?.available === true);
    const canManage = available.length > 0;
    return textResult(
      !verified
        ? "La sesión de esta conexión no pudo verificarse. Vuelve a conectar el asistente e inicia sesión en Andromeda."
        : canManage
        ? "Esta conexión puede gestionar la cartera del usuario (siempre con su instrucción explícita)."
        : "Esta conexión es de solo lectura. Para gestionar, el usuario debe activar «Permitir gestionar» en Andromeda → Conectar IA.",
      {
        access_level: level,
        surface: c.surface ?? null,
        oauth_client_id: c.oauth_client_id ?? null,
        can_manage: canManage,
        has_manage_grant: hasGrant,
        manage_tools: available,
        tool_availability: a.tools,
        access_verified: verified,
        reason: !verified ? "SESSION_UNVERIFIED" : hasGrant && !canManage ? "EXECUTION_UNAVAILABLE" : !hasGrant ? "READ_ONLY" : null,
        unavailable_manage_tools: MANAGE_TOOLS.filter((name) => !available.includes(name)),
        never_available: [
          "borrado definitivo (purga)",
          "administración de cuentas, contraseñas o roles",
          "envío de correos o mensajes",
          "dar por cumplido un término al descartar un correo, alerta o notificación (solo manage_deadline con instrucción explícita del usuario cierra un término)",
        ],
        how_to_enable: !verified ? "Reconecta el asistente e inicia sesión en Andromeda; no compartas credenciales ni tokens." : "Andromeda → Configuración → Conexiones (/app/settings/connections) → Permitir gestionar. Revocable en cualquier momento; la ejecución también debe estar disponible.",
      },
    );
  },
});
