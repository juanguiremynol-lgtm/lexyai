export interface BubbleDef {
  id: string;
  text: string;
  prefillPrompt?: string;
  contexts: BubbleContext[];
  priority: number;
  requiresRole?: string[];
  onlyAfterAction?: string;
  cooldownMinutes?: number;
}

export type BubbleContext =
  | "GLOBAL"
  | "DASHBOARD"
  | "WORK_ITEM_DETAIL"
  | "HOY"
  | "SETTINGS"
  | "SUPERVISOR"
  | "AFTER_DELETE"
  | "AFTER_ADD"
  | "FIRST_SESSION"
  | "SYNC_ISSUES"
  | "PAYMENT_DUE";

export const BUBBLE_DEFINITIONS: BubbleDef[] = [
  // === GLOBAL ===
  {
    id: "help_navigate",
    text: "¿Necesitas ayuda para navegar? Pregúntame.",
    contexts: ["GLOBAL"],
    priority: 3,
  },
  {
    id: "explain_screen",
    text: "¿Quieres que te explique lo que ves en esta pantalla?",
    prefillPrompt: "Explícame qué estoy viendo en esta pantalla",
    contexts: ["GLOBAL"],
    priority: 2,
  },
  {
    id: "what_can_i_do",
    text: "¡Hola! Soy Atenia. Puedo ayudarte con sync, trazas, alertas y más.",
    contexts: ["FIRST_SESSION"],
    priority: 10,
    cooldownMinutes: 1440,
  },
  {
    id: "destructive_warning",
    text: "Las acciones destructivas siempre requieren tu confirmación explícita. 🔒",
    contexts: ["GLOBAL"],
    priority: 1,
  },

  // === DASHBOARD ===
  {
    id: "dashboard_overview",
    text: "¿Quieres un resumen de tu pipeline? Puedo analizar el estado de tus asuntos.",
    prefillPrompt: "Dame un resumen del estado de mis asuntos",
    contexts: ["DASHBOARD"],
    priority: 4,
  },
  {
    id: "dashboard_sync",
    text: "Tus asuntos se sincronizan automáticamente. ¿Quieres saber el estado del sync?",
    prefillPrompt: "¿Cuál es el estado de sincronización de mis asuntos?",
    contexts: ["DASHBOARD"],
    priority: 3,
  },

  // === WORK ITEM DETAIL ===
  {
    id: "summarize_item",
    text: "¿Quieres que resuma este asunto? Puedo explicarte las últimas actuaciones.",
    prefillPrompt: "Resume este asunto y sus últimas actuaciones",
    contexts: ["WORK_ITEM_DETAIL"],
    priority: 5,
  },
  {
    id: "explain_trace",
    text: "Puedo explicarte las trazas de sincronización de este asunto.",
    prefillPrompt: "Explícame las trazas de sync de este asunto",
    contexts: ["WORK_ITEM_DETAIL"],
    priority: 3,
  },
  {
    id: "explain_stages",
    text: "¿No entiendes una etapa o estado? Pregúntame y te explico.",
    prefillPrompt: "Explícame las etapas y estados de este tipo de proceso",
    contexts: ["WORK_ITEM_DETAIL"],
    priority: 2,
  },

  // === AFTER SOFT DELETE ===
  {
    id: "post_delete_recovery",
    text: "¿Eliminaste algo por error? Puedo recuperarlo dentro de 10 días.",
    prefillPrompt: "Quiero recuperar el asunto que acabo de eliminar",
    contexts: ["AFTER_DELETE"],
    priority: 10,
    cooldownMinutes: 5,
  },

  // === AFTER ADD ===
  {
    id: "post_add_explain",
    text: "¡Asunto creado! La primera sincronización puede tomar unos minutos.",
    contexts: ["AFTER_ADD"],
    priority: 8,
    cooldownMinutes: 30,
  },

  // === SYNC ISSUES ===
  {
    id: "sync_degraded",
    text: "Detecto problemas de sincronización. ¿Quieres que te explique qué está pasando?",
    prefillPrompt: "¿Hay problemas de sincronización con mis asuntos?",
    contexts: ["SYNC_ISSUES"],
    priority: 7,
  },

  // === HOY ===
  {
    id: "hoy_summary",
    text: "¿Quieres un resumen de la actividad judicial de hoy?",
    prefillPrompt: "Resume la actividad judicial de hoy",
    contexts: ["HOY"],
    priority: 4,
  },

  // === PAYMENT / SETTINGS ===
  {
    id: "payment_help",
    text: "¿Necesitas ayuda con tu suscripción o facturación? Pregúntame.",
    prefillPrompt: "¿Cuál es el estado de mi suscripción?",
    contexts: ["PAYMENT_DUE", "SETTINGS"],
    priority: 5,
  },

  // === ADMIN-ONLY ===
  {
    id: "admin_health",
    text: "¿Quieres una auditoría de salud de la plataforma?",
    prefillPrompt: "Hazme una auditoría de salud de la plataforma",
    contexts: ["SUPERVISOR"],
    priority: 5,
    requiresRole: ["platform_admin"],
  },

  // === PAPELERA ===
  {
    id: "trash_reminder",
    text: "Tienes asuntos en la papelera. ¿Quieres ver cuáles o recuperar alguno?",
    prefillPrompt: "¿Qué asuntos tengo en la papelera?",
    contexts: ["DASHBOARD"],
    priority: 4,
    cooldownMinutes: 1440,
  },
];
