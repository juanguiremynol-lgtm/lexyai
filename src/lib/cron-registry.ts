/**
 * Client-side mirror of the canonical Cron Registry.
 * Keep in sync with supabase/functions/_shared/cronRegistry.ts
 */

export interface CronWiring {
  /** Orchestrator phase triggered, if any */
  orchestrator_phase: string | null;
  /** Whether this job calls the sync orchestrator */
  is_orchestrator_job: boolean;
  /** External providers impacted by this job */
  providers_impacted: string[];
  /** Downstream effects */
  downstream: string[];
}

export interface CronRegistryEntry {
  jobname: string;
  label: string;
  edge_function: string;
  role: "SYNC" | "AI" | "OBSERVABILITY" | "EMAIL" | "MAINTENANCE" | "ALERTS" | "ONBOARDING";
  critical: boolean;
  expected_active: boolean;
  notes?: string;
  wiring: CronWiring;
}

export const CRON_REGISTRY: CronRegistryEntry[] = [
  // ── SYNC PIPELINE ──
  {
    jobname: "publicaciones-monitor",
    label: "Monitor de Publicaciones",
    edge_function: "scheduled-publicaciones-monitor",
    role: "SYNC",
    critical: true,
    expected_active: true,
    wiring: {
      orchestrator_phase: "PUBLICACIONES_MONITOR",
      is_orchestrator_job: false,
      providers_impacted: ["publicaciones"],
      downstream: ["alert_instances", "notifications"],
    },
  },
  {
    jobname: "daily-sync",
    label: "Sync Diario Principal",
    edge_function: "scheduled-daily-sync",
    role: "SYNC",
    critical: true,
    expected_active: true,
    wiring: {
      orchestrator_phase: "DAILY_ENQUEUE",
      is_orchestrator_job: true,
      providers_impacted: ["cpnu", "samai", "publicaciones", "samai_estados"],
      downstream: ["auto_sync_daily_ledger", "external_sync_runs", "sync-by-work-item"],
    },
  },
  {
    jobname: "daily-sync-705am-cot",
    label: "Sync Diario Wave 2",
    edge_function: "scheduled-daily-sync",
    role: "SYNC",
    critical: true,
    expected_active: true,
    wiring: {
      orchestrator_phase: "DAILY_ENQUEUE",
      is_orchestrator_job: true,
      providers_impacted: ["cpnu", "samai", "publicaciones", "samai_estados"],
      downstream: ["auto_sync_daily_ledger", "external_sync_runs", "sync-by-work-item"],
    },
  },
  {
    jobname: "daily-sync-710am-cot",
    label: "Sync Diario Wave 3",
    edge_function: "scheduled-daily-sync",
    role: "SYNC",
    critical: true,
    expected_active: true,
    wiring: {
      orchestrator_phase: "DAILY_ENQUEUE",
      is_orchestrator_job: true,
      providers_impacted: ["cpnu", "samai", "publicaciones", "samai_estados"],
      downstream: ["auto_sync_daily_ledger", "external_sync_runs", "sync-by-work-item"],
    },
  },
  {
    jobname: "process-retry-queue",
    label: "Procesador de Reintentos",
    edge_function: "process-retry-queue",
    role: "SYNC",
    critical: true,
    expected_active: true,
    wiring: {
      orchestrator_phase: "PROCESS_QUEUE",
      is_orchestrator_job: false,
      providers_impacted: ["cpnu", "samai", "publicaciones"],
      downstream: ["atenia_ai_remediation_queue", "external_sync_runs"],
    },
  },
  {
    // Second entry ONLY because cron cannot express "0 5-13 plus 18" in one
    // expression. Same edge function as process-retry-queue.
    jobname: "process-retry-queue-night-net",
    label: "Procesador de Reintentos — pasada nocturna",
    edge_function: "process-retry-queue",
    role: "SYNC",
    critical: false,
    expected_active: true,
    wiring: {
      orchestrator_phase: "PROCESS_QUEUE",
      is_orchestrator_job: false,
      providers_impacted: ["cpnu", "samai", "publicaciones"],
      downstream: ["atenia_ai_remediation_queue", "external_sync_runs"],
    },
  },

  {
    jobname: "cpnu-job-poller",
    label: "Poller Jobs CPNU",
    edge_function: "cpnu-job-poller",
    role: "SYNC",
    critical: false,
    expected_active: true,
    notes: "Poll async /resultado/{jobId} de CPNU para work_items con scrape_status=IN_PROGRESS. Reemplaza polling inline que causaba timeouts >60s en Edge Functions.",
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: ["cpnu"],
      downstream: ["work_items", "work_item_acts"],
    },
  },

  // ── AI & ANALYSIS ──
  {
    jobname: "atenia-ai-supervisor",
    label: "Supervisor AI (Post-Sync)",
    edge_function: "atenia-ai-supervisor",
    role: "AI",
    critical: true,
    expected_active: true,
    wiring: {
      orchestrator_phase: "POST_DAILY_SYNC",
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["atenia_ai_actions", "atenia_ai_reports", "atenia_deep_dives"],
    },
  },
  {
    jobname: "lexy-daily-message-generation",
    label: "Generación Mensajes Lexy",
    edge_function: "lexy-daily-message",
    role: "AI",
    critical: false,
    expected_active: true,
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["lexy_daily_messages"],
    },
  },

  // ── OBSERVABILITY ──
  {
    jobname: "atenia-cron-watchdog",
    label: "Watchdog Auto-Sanación",
    edge_function: "atenia-cron-watchdog",
    role: "OBSERVABILITY",
    critical: true,
    expected_active: true,
    wiring: {
      orchestrator_phase: "WATCHDOG",
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["atenia_cron_runs", "platform_job_heartbeats"],
    },
  },
  {
    jobname: "atenia-server-heartbeat",
    label: "Heartbeat de Servidor",
    edge_function: "atenia-ai-supervisor",
    role: "OBSERVABILITY",
    critical: true,
    expected_active: true,
    wiring: {
      orchestrator_phase: "HEARTBEAT",
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["atenia_cron_runs"],
    },
  },
  {
    jobname: "atenia-self-health",
    label: "Auto-Diagnóstico",
    edge_function: "atenia-ai-supervisor",
    role: "OBSERVABILITY",
    critical: false,
    expected_active: true,
    wiring: {
      orchestrator_phase: "SELF_HEALTH",
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["atenia_cron_runs"],
    },
  },
  {
    jobname: "atenia-platform-sweep",
    label: "Barrido de Plataforma",
    edge_function: "atenia-ai-supervisor",
    role: "OBSERVABILITY",
    critical: false,
    expected_active: true,
    wiring: {
      orchestrator_phase: "PLATFORM_SWEEP",
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["atenia_ai_actions"],
    },
  },
  {
    jobname: "atenia-daily-ops-report",
    label: "Reporte Operativo Diario",
    edge_function: "atenia-daily-report",
    role: "OBSERVABILITY",
    critical: false,
    expected_active: true,
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["atenia_daily_ops_reports"],
    },
  },

  // ── EMAIL & ALERTS ──
  {
    jobname: "dispatch-update-emails",
    label: "Despacho de Emails",
    edge_function: "dispatch-update-emails",
    role: "EMAIL",
    critical: true,
    expected_active: true,
    wiring: {
      orchestrator_phase: "EMAIL_DISPATCH",
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["email_outbox", "alert_instances"],
    },
  },
  {
    jobname: "process-email-outbox",
    label: "Worker Cola de Emails",
    edge_function: "process-email-outbox",
    role: "EMAIL",
    critical: true,
    expected_active: true,
    notes: "Drena email_outbox con claim atómico + reaper",
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["email_outbox"],
    },
  },
  {
    jobname: "hearing-reminders",
    label: "Recordatorios de Audiencias",
    edge_function: "hearing-reminders",
    role: "ALERTS",
    critical: true,
    expected_active: true,
    notes: "DRY-RUN inicial; apagar flag tras verificar",
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["email_outbox", "alerts"],
    },
  },
  {
    jobname: "peticion-reminders",
    label: "Recordatorios de Peticiones",
    edge_function: "peticion-reminders",
    role: "ALERTS",
    critical: true,
    expected_active: true,
    notes: "DRY-RUN inicial; apagar flag tras verificar",
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["email_outbox", "peticion_alerts"],
    },
  },
  {
    jobname: "scheduled-alert-evaluator",
    label: "Evaluador de Alertas",
    edge_function: "scheduled-alert-evaluator",
    role: "ALERTS",
    critical: true,
    expected_active: true,
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["alert_instances", "alert_rules"],
    },
  },
  {
    jobname: "sync-terminos-alertas-daily",
    label: "Sync Términos → Alertas",
    edge_function: "sync-terminos-alertas",
    role: "ALERTS",
    critical: false,
    expected_active: false,
    notes:
      "DEPRECATED (2026-07-14). Andromeda /terminos audit: catalog empty, calendar-day arithmetic, scrape-timestamp anchor. Local engine (work_item_deadlines) is the sole source of truth.",
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: ["andromeda_terminos"],
      downstream: ["alert_instances", "email_outbox"],
    },
  },

  // ── MAINTENANCE ──
  {
    jobname: "cleanup-rate-limits",
    label: "Limpieza Rate Limits",
    edge_function: "cleanup-rate-limits",
    role: "MAINTENANCE",
    critical: false,
    expected_active: true,
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: [],
    },
  },
  {
    jobname: "purge-trashed-emails",
    label: "Purga Emails Papelera",
    edge_function: "purge-trashed-emails",
    role: "MAINTENANCE",
    critical: false,
    expected_active: true,
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: ["email_outbox"],
    },
  },

  // ── ONBOARDING ──
  {
    jobname: "scheduled-daily-welcome",
    label: "Welcome Diario",
    edge_function: "scheduled-daily-welcome",
    role: "ONBOARDING",
    critical: false,
    expected_active: true,
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: [],
    },
  },
  {
    jobname: "notify-waitlist-on-launch",
    label: "Notificación Waitlist",
    edge_function: "notify-waitlist-on-launch",
    role: "ONBOARDING",
    critical: false,
    expected_active: false,
    notes: "Desactivar post-launch",
    wiring: {
      orchestrator_phase: null,
      is_orchestrator_job: false,
      providers_impacted: [],
      downstream: [],
    },
  },
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

/** Provider display labels */
export const PROVIDER_LABELS: Record<string, string> = {
  cpnu: "CPNU (Rama Judicial)",
  samai: "SAMAI",
  publicaciones: "Publicaciones (Estados)",
  samai_estados: "SAMAI Estados API",
  tutelas: "Tutelas",
};
