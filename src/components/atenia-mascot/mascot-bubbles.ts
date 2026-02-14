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
    text: "¡Hola! Soy Andro IA. Puedo ayudarte con sync, trazas, alertas y más.",
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

  // === RECOVERY HIGHLIGHT ===
  {
    id: "recovery_highlight",
    text: "¿Sabías que puedo recuperar asuntos eliminados? Pídeme que lo haga.",
    prefillPrompt: "Quiero recuperar un asunto eliminado",
    contexts: ["GLOBAL"],
    priority: 2,
    cooldownMinutes: 1440,
  },

  // === PURGE HIGHLIGHT ===
  {
    id: "purge_highlight",
    text: "¿Necesitas eliminar datos permanentemente? Puedo habilitar la sección de purga.",
    prefillPrompt: "Quiero habilitar la sección de purga en configuración",
    contexts: ["SETTINGS"],
    priority: 3,
    cooldownMinutes: 1440,
  },

  // === TROUBLESHOOTING HIGHLIGHT ===
  {
    id: "troubleshoot_highlight",
    text: "¿Algo no funciona como esperabas? Pregúntame y diagnostico el problema.",
    prefillPrompt: "Diagnostica por qué mi asunto no se actualiza",
    contexts: ["WORK_ITEM_DETAIL"],
    priority: 3,
    cooldownMinutes: 720,
  },

  // === SETTINGS / TICKER ===
  {
    id: "ticker_toggle_hint",
    text: "¿Quieres activar o desactivar el ticker de estados? Puedo hacerlo por ti.",
    prefillPrompt: "Quiero cambiar la configuración del ticker de estados",
    contexts: ["SETTINGS"],
    priority: 4,
    cooldownMinutes: 1440,
  },
  {
    id: "settings_via_chat",
    text: "Puedo gestionar configuraciones como el ticker y la suscripción directamente por aquí.",
    prefillPrompt: "¿Qué configuraciones puedo cambiar desde aquí?",
    contexts: ["SETTINGS"],
    priority: 3,
    cooldownMinutes: 1440,
  },
  {
    id: "billing_check",
    text: "¿Necesitas información sobre tu suscripción o facturación? Pregúntame.",
    prefillPrompt: "¿Cuál es el estado de mi suscripción?",
    contexts: ["SETTINGS", "PAYMENT_DUE"],
    priority: 4,
    cooldownMinutes: 1440,
  },

  // === PRIVACY & SECURITY AWARENESS ===
  {
    id: "privacy_no_llm",
    text: "No recopilamos, almacenamos ni utilizamos información de nuestros usuarios para alimentar, entrenar o mejorar modelos de IA (LLM). 🔒",
    contexts: ["GLOBAL", "SETTINGS"],
    priority: 2,
    cooldownMinutes: 1440,
  },
  {
    id: "privacy_guaranteed",
    text: "Protección Garantizada: los administradores de plataforma NO pueden ver información personal, datos de clientes, ni actuaciones.",
    contexts: ["GLOBAL", "SETTINGS"],
    priority: 2,
    cooldownMinutes: 1440,
  },
  {
    id: "privacy_redacted",
    text: "Toda información de soporte se entrega redactada: nombres, radicados y datos sensibles permanecen ocultos. 🛡️",
    contexts: ["GLOBAL", "SETTINGS"],
    priority: 2,
    cooldownMinutes: 1440,
  },
  {
    id: "privacy_encryption",
    text: "El cifrado AES-256-GCM protege el 100% de campos sensibles en la plataforma.",
    contexts: ["GLOBAL", "SETTINGS"],
    priority: 2,
    cooldownMinutes: 1440,
  },
  {
    id: "privacy_org_isolation",
    text: "Los miembros de organización solo ven su propia información personal. Tu privacidad es nuestra prioridad.",
    contexts: ["GLOBAL", "SETTINGS"],
    priority: 2,
    cooldownMinutes: 1440,
  },
  {
    id: "privacy_no_third_party",
    text: "Sus datos, documentos, procesos y conversaciones nunca se envían a terceros para entrenamiento de IA.",
    contexts: ["GLOBAL", "SETTINGS"],
    priority: 2,
    cooldownMinutes: 1440,
  },
  {
    id: "privacy_ephemeral_ai",
    text: "Las funcionalidades de IA integradas procesan su información de forma efímera y sin retención. 🤖",
    contexts: ["GLOBAL", "SETTINGS"],
    priority: 2,
    cooldownMinutes: 1440,
  },
  {
    id: "privacy_no_generative_input",
    text: "Ningún dato personal o profesional es utilizado como insumo para modelos generativos.",
    contexts: ["GLOBAL", "SETTINGS"],
    priority: 2,
    cooldownMinutes: 1440,
  },

  // === ANALYTICS AWARENESS ===
  {
    id: "analytics_privacy",
    text: "Las analíticas de uso nunca incluyen datos legales, nombres ni documentos. Solo metadatos seguros y hasheados. 📊",
    contexts: ["SETTINGS"],
    priority: 2,
    cooldownMinutes: 1440,
  },
  {
    id: "analytics_opt_out",
    text: "¿Sabías que tu organización puede optar por no participar en analíticas de uso? Pregúntame cómo.",
    prefillPrompt: "¿Cómo puedo desactivar las analíticas de uso para mi organización?",
    contexts: ["SETTINGS"],
    priority: 2,
    cooldownMinutes: 1440,
  },
];
