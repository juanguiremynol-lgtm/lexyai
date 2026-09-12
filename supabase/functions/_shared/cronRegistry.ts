/**
 * Cron Registry — the NON-DERIVABLE metadata of each expected pg_cron job.
 *
 * LS2 / summary-column rule: the SCHEDULE IS NOT HERE. `cron.job.schedule` is
 * the fact and `public.cron_job_health()` already returns it together with
 * `active`. A hand-kept copy of a cadence drifts silently — it did, in three
 * places at once (job name, this file, the UI mirror) — so this registry now
 * declares only what pg_cron cannot tell us: label, role, criticality,
 * whether the job is expected to exist, and its wiring.
 *
 * Used by: admin Cron Governance panel, watchdog, daily ops reports.
 */

export interface CronRegistryEntry {
  /** pg_cron jobname (must match cron.job.jobname exactly) */
  jobname: string;
  /** Human-readable label */
  label: string;
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
    jobname: "publicaciones-monitor",
    label: "Monitor de Publicaciones",
    edge_function: "scheduled-publicaciones-monitor",
    role: "SYNC",
    critical: true,
    expected_active: true,
    notes: "Pre-sync: scans all monitored items for new court notifications",
  },
  {
    jobname: "daily-sync",
    label: "Sync Diario Principal",
    edge_function: "scheduled-daily-sync",
    role: "SYNC",
    critical: true,
    expected_active: true,
    notes: "Main orchestrator sync — wave 1",
  },
  {
    jobname: "daily-sync-705am-cot",
    label: "Sync Diario Wave 2",
    edge_function: "scheduled-daily-sync",
    role: "SYNC",
    critical: true,
    expected_active: true,
    notes: "Staggered wave 2 — catches orgs missed by wave 1",
  },
  {
    jobname: "daily-sync-710am-cot",
    label: "Sync Diario Wave 3",
    edge_function: "scheduled-daily-sync",
    role: "SYNC",
    critical: true,
    expected_active: true,
    notes: "Staggered wave 3 — final catch-up",
  },
  {
    jobname: "process-retry-queue",
    label: "Procesador de Reintentos",
    edge_function: "process-retry-queue",
    role: "SYNC",
    critical: true,
    expected_active: true,
    notes: "Drains sync retry queue (PUB_RETRY, ACT_RETRY). Concentrated on the window where providers publish; see process-retry-queue-night-net for the 18:00 UTC pass.",
  },
  {
    jobname: "process-retry-queue-night-net",
    label: "Procesador de Reintentos — pasada nocturna",
    edge_function: "process-retry-queue",
    role: "SYNC",
    critical: false,
    expected_active: true,
    notes: "Second entry ONLY because cron cannot express '0 5-13 plus 18'. Same function as process-retry-queue; change both together or neither.",
  },

  {
    jobname: "cpnu-job-poller",
    label: "Poller Jobs CPNU",
    edge_function: "cpnu-job-poller",
    role: "SYNC",
    critical: false,
    expected_active: true,
    notes: "Poll async /resultado/{jobId} de CPNU para work_items con scrape_status=IN_PROGRESS. Reemplaza polling inline que causaba timeouts >60s en Edge Functions.",
  },

  // ── AI & ANALYSIS ──
  {
    jobname: "atenia-ai-supervisor",
    label: "Supervisor AI (Post-Sync)",
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
    edge_function: "atenia-cron-watchdog",
    role: "OBSERVABILITY",
    critical: true,
    expected_active: true,
    notes: "Self-healing: checks sync coverage, queue backlog, heartbeat, stale runs",
  },
  {
    jobname: "atenia-server-heartbeat",
    label: "Heartbeat de Servidor",
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
    edge_function: "atenia-daily-report",
    role: "OBSERVABILITY",
    critical: false,
    expected_active: true,
    notes: "Generates comprehensive TXT report with diagnostics and KPIs",
  },

  // ── EMAIL & ALERTS ──
  {
    jobname: "dispatch-update-emails",
    label: "Despacho de Emails",
    edge_function: "dispatch-update-emails",
    role: "EMAIL",
    critical: true,
    expected_active: true,
    notes: "Processes unsent alert_instances, creates email_outbox entries",
  },
  {
    jobname: "process-email-outbox",
    label: "Worker Cola de Emails",
    edge_function: "process-email-outbox",
    role: "EMAIL",
    critical: true,
    expected_active: true,
    notes: "Drena email_outbox (PENDING/FAILED) con claim atómico y reaper de rows colgados >10 min",
  },
  {
    jobname: "hearing-reminders",
    label: "Recordatorios de Audiencias",
    edge_function: "hearing-reminders",
    role: "ALERTS",
    critical: true,
    body: { dry_run: true },
    expected_active: true,
    notes: "Encola recordatorios de audiencias (7/3/1/0 días). DRY-RUN inicial: apagar flag tras verificar logs.",
  },
  {
    jobname: "peticion-reminders",
    label: "Recordatorios de Peticiones",
    edge_function: "peticion-reminders",
    role: "ALERTS",
    critical: true,
    body: { dry_run: true },
    expected_active: true,
    notes: "Encola recordatorios de peticiones (7/5/3/1/0 días). DRY-RUN inicial: apagar flag tras verificar logs.",
  },
  {
    jobname: "scheduled-alert-evaluator",
    label: "Evaluador de Alertas",
    edge_function: "scheduled-alert-evaluator",
    role: "ALERTS",
    critical: true,
    expected_active: true,
    notes: "Evaluates alert rules and fires due alerts",
  },
  {
    jobname: "sync-terminos-alertas-daily",
    label: "Sync Términos → Alertas",
    edge_function: "sync-terminos-alertas",
    role: "ALERTS",
    critical: false,
    expected_active: false,
    notes:
      "DEPRECATED (2026-07-14). Andromeda /terminos audit found it unfit as oracle: empty catalog, calendar-day arithmetic (dias_habiles*1.5), scrape-timestamp anchor for CPNU/SAMAI. Local engine (work_item_deadlines) is the sole source of truth.",
  },

  // ── MAINTENANCE ──
  {
    jobname: "cleanup-rate-limits",
    label: "Limpieza Rate Limits",
    edge_function: "cleanup-rate-limits",
    role: "MAINTENANCE",
    critical: false,
    expected_active: true,
    notes: "Removes expired rate limit entries",
  },
  {
    jobname: "purge-trashed-emails",
    label: "Purga Emails Papelera",
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
    edge_function: "scheduled-daily-welcome",
    role: "ONBOARDING",
    critical: false,
    expected_active: true,
    notes: "Sends welcome emails to new users",
  },
  {
    jobname: "notify-waitlist-on-launch",
    label: "Notificación Waitlist",
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
