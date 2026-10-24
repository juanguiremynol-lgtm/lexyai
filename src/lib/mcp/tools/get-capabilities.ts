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
    const [{ data: level, error: e1 }, { data: caller, error: e2 }] = await Promise.all([
      sb.rpc("mcp_access_level"),
      sb.rpc("mcp_caller_context"),
    ]);
    if (e1 || e2) return errorResult((e1 ?? e2)?.message ?? "Error");
    const c = (caller ?? {}) as Record<string, unknown>;
    const canManage = level === "manage" || level === "first_party";
    return textResult(
      canManage
        ? "Esta conexión puede gestionar la cartera del usuario (siempre con su instrucción explícita)."
        : "Esta conexión es de solo lectura. Para gestionar, el usuario debe activar «Permitir gestionar» en Andromeda → Conectar IA.",
      {
        access_level: level,
        surface: c.surface ?? null,
        oauth_client_id: c.oauth_client_id ?? null,
        can_manage: canManage,
        manage_tools: MANAGE_TOOLS,
        release_gate: "Las nueve RPC nuevas de gestión y assign_work_item_radicado mantienen EXECUTE bloqueado hasta revisión; un grant de gestión no elimina ese bloqueo.",
        never_available: [
          "borrado definitivo (purga)",
          "administración de cuentas, contraseñas o roles",
          "envío de correos o mensajes",
          "dar por cumplido un término al descartar un correo, alerta o notificación (solo manage_deadline con instrucción explícita del usuario cierra un término)",
        ],
        how_to_enable: "Andromeda → Conectar IA → Conexiones autorizadas → Permitir gestionar. Revocable en cualquier momento.",
      },
    );
  },
});
