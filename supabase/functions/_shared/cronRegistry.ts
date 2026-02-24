/**
 * Cron Registry — Canonical source of truth for ALL pg_cron jobs expected in production.
 *
 * This file defines every cron job the platform needs, with its schedule,
 * edge function target, and operational metadata. Used by:
 *   - Admin Cron Governance panel (diff vs pg_cron reality)
 *   - Watchdog (health checks)
 *   - Daily ops reports
 */

export interface CronRegistryEntry {
  /** pg_cron jobname (must match cron.job.jobname exactly) */
  jobname: string;
  /** Human-readable label */
  label: string;
  /** Cron schedule expression (UTC) */
  schedule_utc: string;
  /** Equivalent time in COT for daily jobs, or description */
  schedule_cot: string;
  /** Edge function invoked */
  edge_function: string;
  /** Functional role */
  role: "SYNC" | "AI" | "OBSERVABILITY" | "EMAIL" | "MAINTENANCE" | "ALERTS" | "ONBOARDING";
  /** Is this job critical to data freshness? */
  critical: boolean;
  /** Request body sent to edge function */
  body?: Record<string, unknown>;
  /** Should this job be active? */
  expected_active: boolean;
  /** Notes */
  notes?: string;
}

/**
 * All 18 production pg_cron jobs, in logical groupings.
 */
export const CRON_REGISTRY: CronRegistryEntry[] = [
  // ── SYNC PIPELINE ──
  {
    jobname: "publicaciones-monitor-6am-cot",
    label: "Monitor de Publicaciones",
    schedule_utc: "0 11 * * *",
    schedule_cot: "06:00 COT",
    edge_function: "scheduled-publicaciones-monitor",
    role: "SYNC",
    critical: true,
    expected_active: true,
    notes: "Pre-sync: scans all monitored items for new court notifications",
  },
  {
    jobname: "daily-sync-7am-cot",
    label: "Sync Diario Principal",
    schedule_utc: "0 12 * * *",
    schedule_cot: "07:00 COT",
    edge_function: "scheduled-daily-sync",
    role: "SYNC",
    critical: true,
    expected_active: true,
    notes: "Main orchestrator sync — wave 1",
  },
  {
    jobname: "daily-sync-705am-cot",
    label: "Sync Diario Wave 2",
    schedule_utc: "5 12 * * *",
    schedule_cot: "07:05 COT",
    edge_function: "scheduled-daily-sync",
    role: "SYNC",
    critical: true,
    expected_active: true,
    notes: "Staggered wave 2 — catches orgs missed by wave 1",
  },
  {
    jobname: "daily-sync-710am-cot",
    label: "Sync Diario Wave 3",
    schedule_utc: "10 12 * * *",
    schedule_cot: "07:10 COT",
    edge_function: "scheduled-daily-sync",
    role: "SYNC",
    critical: true,
    expected_active: true,
    notes: "Staggered wave 3 — final catch-up",
  },
  {
    jobname: "process-retry-queue-every-2min",
    label: "Procesador de Reintentos",
    schedule_utc: "*/2 * * * *",
    schedule_cot: "Cada 2 min",
    edge_function: "process-retry-queue",
    role: "SYNC",
    critical: true,
    expected_active: true,
    notes: "Drains sync retry queue (PUB_RETRY, ACT_RETRY)",
  },

  // ── AI & ANALYSIS ──
  {
    jobname: "atenia-ai-supervisor-daily",
    label: "Supervisor AI (Post-Sync)",
    schedule_utc: "30 12 * * *",
    schedule_cot: "07:30 COT",
    edge_function: "atenia-ai-supervisor",
    role: "AI",
    critical: true,
    body: { mode: "POST_DAILY_SYNC" },
    expected_active: true,
    notes: "Post-sync: diagnostics, remediation, ghost detection, Gemini analysis",
  },
  {
    jobname: "lexy-daily-message-generation",
    label: "Generación Mensajes Lexy",
    schedule_utc: "45 12 * * *",
    schedule_cot: "07:45 COT",
    edge_function: "lexy-daily-message",
    role: "AI",
    critical: false,
    body: { mode: "GENERATE_ALL" },
    expected_active: true,
    notes: "Generates personalized AI daily messages for all users",
  },

  // ── OBSERVABILITY ──
  {
    jobname: "atenia-cron-watchdog",
    label: "Watchdog Auto-Sanación",
    schedule_utc: "*/10 * * * *",
    schedule_cot: "Cada 10 min",
    edge_function: "atenia-cron-watchdog",
    role: "OBSERVABILITY",
    critical: true,
    expected_active: true,
    notes: "Self-healing: checks sync coverage, queue backlog, heartbeat, stale runs",
  },
  {
    jobname: "atenia-server-heartbeat",
    label: "Heartbeat de Servidor",
    schedule_utc: "*/30 * * * *",
    schedule_cot: "Cada 30 min",
    edge_function: "atenia-ai-supervisor",
    role: "OBSERVABILITY",
    critical: true,
    body: { mode: "HEARTBEAT" },
    expected_active: true,
    notes: "Platform heartbeat via AI supervisor",
  },
  {
    jobname: "atenia-self-health",
    label: "Auto-Diagnóstico",
    schedule_utc: "*/15 * * * *",
    schedule_cot: "Cada 15 min",
    edge_function: "atenia-ai-supervisor",
    role: "OBSERVABILITY",
    critical: false,
    body: { mode: "SELF_HEALTH" },
    expected_active: true,
    notes: "Lightweight self-health check",
  },
  {
    jobname: "atenia-platform-sweep",
    label: "Barrido de Plataforma",
    schedule_utc: "0 13 * * *",
    schedule_cot: "08:00 COT",
    edge_function: "atenia-ai-supervisor",
    role: "OBSERVABILITY",
    critical: false,
    body: { mode: "PLATFORM_SWEEP" },
    expected_active: true,
    notes: "Daily platform-wide audit sweep",
  },
  {
    jobname: "atenia-daily-ops-report",
    label: "Reporte Operativo Diario",
    schedule_utc: "30 13 * * *",
    schedule_cot: "08:30 COT",
    edge_function: "atenia-daily-report",
    role: "OBSERVABILITY",
    critical: false,
    expected_active: true,
    notes: "Generates comprehensive TXT report with diagnostics and KPIs",
  },

  // ── EMAIL & ALERTS ──
  {
    jobname: "dispatch-update-emails-5min",
    label: "Despacho de Emails",
    schedule_utc: "*/5 * * * *",
    schedule_cot: "Cada 5 min",
    edge_function: "dispatch-update-emails",
    role: "EMAIL",
    critical: true,
    expected_active: true,
    notes: "Processes unsent alert_instances, creates email_outbox entries",
  },
  {
    jobname: "scheduled-alert-evaluator",
    label: "Evaluador de Alertas",
    schedule_utc: "*/30 * * * *",
    schedule_cot: "Cada 30 min",
    edge_function: "scheduled-alert-evaluator",
    role: "ALERTS",
    critical: true,
    expected_active: true,
    notes: "Evaluates alert rules and fires due alerts",
  },

  // ── MAINTENANCE ──
  {
    jobname: "cleanup-rate-limits-hourly",
    label: "Limpieza Rate Limits",
    schedule_utc: "0 * * * *",
    schedule_cot: "Cada hora",
    edge_function: "cleanup-rate-limits",
    role: "MAINTENANCE",
    critical: false,
    expected_active: true,
    notes: "Removes expired rate limit entries",
  },
  {
    jobname: "purge-trashed-emails-daily",
    label: "Purga Emails Papelera",
    schedule_utc: "0 3 * * *",
    schedule_cot: "22:00 COT",
    edge_function: "purge-trashed-emails",
    role: "MAINTENANCE",
    critical: false,
    expected_active: true,
    notes: "Deletes permanently trashed emails older than retention period",
  },

  // ── ONBOARDING ──
  {
    jobname: "scheduled-daily-welcome",
    label: "Welcome Diario",
    schedule_utc: "0 12 * * *",
    schedule_cot: "07:00 COT",
    edge_function: "scheduled-daily-welcome",
    role: "ONBOARDING",
    critical: false,
    expected_active: true,
    notes: "Sends welcome emails to new users",
  },
  {
    jobname: "notify-waitlist-on-launch",
    label: "Notificación Waitlist",
    schedule_utc: "*/30 * * * *",
    schedule_cot: "Cada 30 min",
    edge_function: "notify-waitlist-on-launch",
    role: "ONBOARDING",
    critical: false,
    expected_active: false,
    notes: "POST-LAUNCH: Should be disabled once launch is complete. Feature flag: launch_completed",
  },
];

/** Map by jobname for quick lookup */
export const CRON_REGISTRY_MAP = new Map(CRON_REGISTRY.map(e => [e.jobname, e]));

/** All registered jobnames */
export const CRON_REGISTRY_JOBNAMES = CRON_REGISTRY.map(e => e.jobname);

/** Role display labels */
export const ROLE_LABELS: Record<string, string> = {
  SYNC: "Sincronización",
  AI: "Inteligencia Artificial",
  OBSERVABILITY: "Observabilidad",
  EMAIL: "Correo",
  MAINTENANCE: "Mantenimiento",
  ALERTS: "Alertas",
  ONBOARDING: "Onboarding",
};

/** Role colors for UI */
export const ROLE_COLORS: Record<string, string> = {
  SYNC: "text-blue-600 bg-blue-100",
  AI: "text-purple-600 bg-purple-100",
  OBSERVABILITY: "text-amber-600 bg-amber-100",
  EMAIL: "text-green-600 bg-green-100",
  MAINTENANCE: "text-muted-foreground bg-muted",
  ALERTS: "text-red-600 bg-red-100",
  ONBOARDING: "text-cyan-600 bg-cyan-100",
};
