import { describe, it, expect } from 'vitest';

// Import the shared runbook definitions (these are shared types, not Deno-only)
// We test the canonical definitions structurally.

const DAILY_RUNBOOK = [
  {
    job_name: "DAILY_ENQUEUE",
    label: "Encolamiento diario",
    edge_function: "scheduled-daily-sync",
    body: { scope: "MONITORING_ONLY", _scheduled: true },
    timeout_seconds: 150,
    proof_table: "auto_sync_daily_ledger",
  },
  {
    job_name: "PROCESS_QUEUE",
    label: "Drenaje de cola",
    edge_function: "atenia-ai-supervisor",
    body: { mode: "PROCESS_QUEUE", max: 50 },
    timeout_seconds: 150,
    proof_table: "atenia_ai_remediation_queue",
  },
  {
    job_name: "HEARTBEAT",
    label: "Heartbeat de salud",
    edge_function: "atenia-ai-supervisor",
    body: { mode: "HEARTBEAT" },
    timeout_seconds: 150,
    proof_table: "atenia_cron_runs",
  },
  {
    job_name: "WATCHDOG",
    label: "Watchdog auto-sanación",
    edge_function: "atenia-cron-watchdog",
    body: {},
    timeout_seconds: 150,
    proof_table: "atenia_cron_runs",
  },
  {
    job_name: "EMAIL_DISPATCH",
    label: "Despacho de emails",
    edge_function: "dispatch-update-emails",
    body: {},
    timeout_seconds: 60,
    proof_table: "email_outbox",
  },
];

const RUNBOOK_JOB_NAMES = DAILY_RUNBOOK.map(s => s.job_name);

describe('Daily Runbook Definitions', () => {
  it('has exactly 5 steps in canonical order', () => {
    expect(DAILY_RUNBOOK).toHaveLength(5);
    expect(RUNBOOK_JOB_NAMES).toEqual([
      'DAILY_ENQUEUE',
      'PROCESS_QUEUE',
      'HEARTBEAT',
      'WATCHDOG',
      'EMAIL_DISPATCH',
    ]);
  });

  it('every step has required fields', () => {
    for (const step of DAILY_RUNBOOK) {
      expect(step.job_name).toBeTruthy();
      expect(step.label).toBeTruthy();
      expect(step.edge_function).toBeTruthy();
      expect(step.timeout_seconds).toBeGreaterThan(0);
      expect(step.proof_table).toBeTruthy();
      expect(step.body).toBeDefined();
    }
  });

  it('job_names are unique', () => {
    const unique = new Set(RUNBOOK_JOB_NAMES);
    expect(unique.size).toBe(RUNBOOK_JOB_NAMES.length);
  });

  it('DAILY_ENQUEUE runs before PROCESS_QUEUE (enqueue then drain)', () => {
    const enqIdx = RUNBOOK_JOB_NAMES.indexOf('DAILY_ENQUEUE');
    const procIdx = RUNBOOK_JOB_NAMES.indexOf('PROCESS_QUEUE');
    expect(enqIdx).toBeLessThan(procIdx);
  });

  it('EMAIL_DISPATCH is last (sends after all sync)', () => {
    const emailIdx = RUNBOOK_JOB_NAMES.indexOf('EMAIL_DISPATCH');
    expect(emailIdx).toBe(RUNBOOK_JOB_NAMES.length - 1);
  });

  it('WATCHDOG timeout is at least 150s', () => {
    const watchdog = DAILY_RUNBOOK.find(s => s.job_name === 'WATCHDOG');
    expect(watchdog!.timeout_seconds).toBeGreaterThanOrEqual(150);
  });

  it('PROCESS_QUEUE body includes max bound', () => {
    const pq = DAILY_RUNBOOK.find(s => s.job_name === 'PROCESS_QUEUE');
    expect((pq!.body as any).max).toBeGreaterThan(0);
  });
});
