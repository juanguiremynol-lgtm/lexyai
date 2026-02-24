/**
 * Client-side mirror of the canonical Cron Registry.
 * Keep in sync with supabase/functions/_shared/cronRegistry.ts
 */

export interface CronRegistryEntry {
  jobname: string;
  label: string;
  schedule_utc: string;
  schedule_cot: string;
  edge_function: string;
  role: "SYNC" | "AI" | "OBSERVABILITY" | "EMAIL" | "MAINTENANCE" | "ALERTS" | "ONBOARDING";
  critical: boolean;
  expected_active: boolean;
  notes?: string;
}

export const CRON_REGISTRY: CronRegistryEntry[] = [
  // SYNC PIPELINE
  { jobname: "publicaciones-monitor-6am-cot", label: "Monitor de Publicaciones", schedule_utc: "0 11 * * *", schedule_cot: "06:00 COT", edge_function: "scheduled-publicaciones-monitor", role: "SYNC", critical: true, expected_active: true },
  { jobname: "daily-sync-7am-cot", label: "Sync Diario Principal", schedule_utc: "0 12 * * *", schedule_cot: "07:00 COT", edge_function: "scheduled-daily-sync", role: "SYNC", critical: true, expected_active: true },
  { jobname: "daily-sync-705am-cot", label: "Sync Diario Wave 2", schedule_utc: "5 12 * * *", schedule_cot: "07:05 COT", edge_function: "scheduled-daily-sync", role: "SYNC", critical: true, expected_active: true },
  { jobname: "daily-sync-710am-cot", label: "Sync Diario Wave 3", schedule_utc: "10 12 * * *", schedule_cot: "07:10 COT", edge_function: "scheduled-daily-sync", role: "SYNC", critical: true, expected_active: true },
  { jobname: "process-retry-queue-every-2min", label: "Procesador de Reintentos", schedule_utc: "*/2 * * * *", schedule_cot: "Cada 2 min", edge_function: "process-retry-queue", role: "SYNC", critical: true, expected_active: true },
  // AI
  { jobname: "atenia-ai-supervisor-daily", label: "Supervisor AI (Post-Sync)", schedule_utc: "30 12 * * *", schedule_cot: "07:30 COT", edge_function: "atenia-ai-supervisor", role: "AI", critical: true, expected_active: true },
  { jobname: "lexy-daily-message-generation", label: "Generación Mensajes Lexy", schedule_utc: "45 12 * * *", schedule_cot: "07:45 COT", edge_function: "lexy-daily-message", role: "AI", critical: false, expected_active: true },
  // OBSERVABILITY
  { jobname: "atenia-cron-watchdog", label: "Watchdog Auto-Sanación", schedule_utc: "*/10 * * * *", schedule_cot: "Cada 10 min", edge_function: "atenia-cron-watchdog", role: "OBSERVABILITY", critical: true, expected_active: true },
  { jobname: "atenia-server-heartbeat", label: "Heartbeat de Servidor", schedule_utc: "*/30 * * * *", schedule_cot: "Cada 30 min", edge_function: "atenia-ai-supervisor", role: "OBSERVABILITY", critical: true, expected_active: true },
  { jobname: "atenia-self-health", label: "Auto-Diagnóstico", schedule_utc: "*/15 * * * *", schedule_cot: "Cada 15 min", edge_function: "atenia-ai-supervisor", role: "OBSERVABILITY", critical: false, expected_active: true },
  { jobname: "atenia-platform-sweep", label: "Barrido de Plataforma", schedule_utc: "0 13 * * *", schedule_cot: "08:00 COT", edge_function: "atenia-ai-supervisor", role: "OBSERVABILITY", critical: false, expected_active: true },
  { jobname: "atenia-daily-ops-report", label: "Reporte Operativo Diario", schedule_utc: "30 13 * * *", schedule_cot: "08:30 COT", edge_function: "atenia-daily-report", role: "OBSERVABILITY", critical: false, expected_active: true },
  // EMAIL & ALERTS
  { jobname: "dispatch-update-emails-5min", label: "Despacho de Emails", schedule_utc: "*/5 * * * *", schedule_cot: "Cada 5 min", edge_function: "dispatch-update-emails", role: "EMAIL", critical: true, expected_active: true },
  { jobname: "scheduled-alert-evaluator", label: "Evaluador de Alertas", schedule_utc: "*/30 * * * *", schedule_cot: "Cada 30 min", edge_function: "scheduled-alert-evaluator", role: "ALERTS", critical: true, expected_active: true },
  // MAINTENANCE
  { jobname: "cleanup-rate-limits-hourly", label: "Limpieza Rate Limits", schedule_utc: "0 * * * *", schedule_cot: "Cada hora", edge_function: "cleanup-rate-limits", role: "MAINTENANCE", critical: false, expected_active: true },
  { jobname: "purge-trashed-emails-daily", label: "Purga Emails Papelera", schedule_utc: "0 3 * * *", schedule_cot: "22:00 COT", edge_function: "purge-trashed-emails", role: "MAINTENANCE", critical: false, expected_active: true },
  // ONBOARDING
  { jobname: "scheduled-daily-welcome", label: "Welcome Diario", schedule_utc: "0 12 * * *", schedule_cot: "07:00 COT", edge_function: "scheduled-daily-welcome", role: "ONBOARDING", critical: false, expected_active: true },
  { jobname: "notify-waitlist-on-launch", label: "Notificación Waitlist", schedule_utc: "*/30 * * * *", schedule_cot: "Cada 30 min", edge_function: "notify-waitlist-on-launch", role: "ONBOARDING", critical: false, expected_active: false, notes: "Desactivar post-launch" },
];

export const CRON_REGISTRY_MAP = new Map(CRON_REGISTRY.map(e => [e.jobname, e]));

export const ROLE_LABELS: Record<string, string> = {
  SYNC: "Sincronización",
  AI: "IA",
  OBSERVABILITY: "Observabilidad",
  EMAIL: "Correo",
  MAINTENANCE: "Mantenimiento",
  ALERTS: "Alertas",
  ONBOARDING: "Onboarding",
};

export const ROLE_COLORS: Record<string, string> = {
  SYNC: "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-950",
  AI: "text-purple-600 bg-purple-100 dark:text-purple-400 dark:bg-purple-950",
  OBSERVABILITY: "text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-950",
  EMAIL: "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-950",
  MAINTENANCE: "text-muted-foreground bg-muted",
  ALERTS: "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-950",
  ONBOARDING: "text-cyan-600 bg-cyan-100 dark:text-cyan-400 dark:bg-cyan-950",
};
