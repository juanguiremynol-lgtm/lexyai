// Email Linking Entity Types
export type EmailEntityType = 
  | "CLIENT" 
  | "CGP_CASE" 
  | "TUTELA" 
  | "HABEAS_CORPUS" 
  | "PROCESO_ADMINISTRATIVO";

export type EmailLinkStatus = 
  | "AUTO_LINKED" 
  | "LINK_SUGGESTED" 
  | "MANUALLY_LINKED" 
  | "DISMISSED";

export type EmailProcessingStatus = 
  | "RECEIVED" 
  | "NORMALIZED" 
  | "LINKED" 
  | "FAILED";

export const ENTITY_TYPE_LABELS: Record<EmailEntityType, string> = {
  CLIENT: "Cliente",
  CGP_CASE: "Proceso CGP",
  TUTELA: "Tutela",
  HABEAS_CORPUS: "Habeas Corpus",
  PROCESO_ADMINISTRATIVO: "Proceso Administrativo",
};

export const ENTITY_TYPE_COLORS: Record<EmailEntityType, string> = {
  CLIENT: "bg-blue-500",
  CGP_CASE: "bg-green-500",
  TUTELA: "bg-purple-500",
  HABEAS_CORPUS: "bg-red-500",
  PROCESO_ADMINISTRATIVO: "bg-orange-500",
};

export const LINK_STATUS_LABELS: Record<EmailLinkStatus, string> = {
  AUTO_LINKED: "Vinculado automáticamente",
  LINK_SUGGESTED: "Sugerido",
  MANUALLY_LINKED: "Vinculado manualmente",
  DISMISSED: "Descartado",
};

export const LINK_STATUS_COLORS: Record<EmailLinkStatus, string> = {
  AUTO_LINKED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  LINK_SUGGESTED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  MANUALLY_LINKED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  DISMISSED: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
};

export const PROCESSING_STATUS_LABELS: Record<EmailProcessingStatus, string> = {
  RECEIVED: "Recibido",
  NORMALIZED: "Procesado",
  LINKED: "Vinculado",
  FAILED: "Error",
};

// Inbox filter tabs
export type InboxTab = "needs_review" | "linked" | "all";

export const INBOX_TABS: Array<{ value: InboxTab; label: string }> = [
  { value: "needs_review", label: "Pendientes" },
  { value: "linked", label: "Vinculados" },
  { value: "all", label: "Todos" },
];
