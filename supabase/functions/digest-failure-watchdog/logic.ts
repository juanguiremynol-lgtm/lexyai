/**
 * digest-failure-watchdog / logic.ts — pure classification and rendering.
 *
 * Extracted so the three alert conditions (FAILED, MISSING, STUCK) can be
 * constructed and asserted in a test WITHOUT touching the database and WITHOUT
 * enqueuing or sending a real email. The edge function keeps all I/O; this file
 * keeps all judgement.
 */

export interface DigestRunRow {
  recipient_user_id: string;
  recipient_email?: string | null;
  status?: string | null;
  error_summary?: string | null;
  created_at?: string | null;
  finished_at?: string | null;
}

export interface WatchdogVerdict {
  failed: string[];
  stuck: string[];
  missing: string[];
  problems: number;
}

/** AF1(b) — an outbox row still PENDING after this many minutes is a backlog. */
export const OUTBOX_BACKLOG_MINUTES = 45;

export interface OutboxRow {
  id?: string | null;
  to_email?: string | null;
  subject?: string | null;
  status?: string | null;
  next_attempt_at?: string | null;
  created_at?: string | null;
}

export interface OutboxBacklogVerdict {
  stalled: number;
  oldestMinutes: number;
  samples: string[];
}

/**
 * AF1(b) — the outbox filling without draining. Neither GCP's Resend watcher
 * (it only sees what Resend accepted) nor the digest itself (it returns once
 * the row is enqueued) can see this condition.
 */
export function classifyOutboxBacklog(
  rows: OutboxRow[],
  now: Date = new Date(),
  backlogMinutes = OUTBOX_BACKLOG_MINUTES,
): OutboxBacklogVerdict {
  const cutoff = now.getTime() - backlogMinutes * 60_000;
  let oldestMinutes = 0;
  const samples: string[] = [];
  let stalled = 0;
  for (const r of rows) {
    if (String(r.status ?? "") !== "PENDING") continue;
    const due = Date.parse(String(r.next_attempt_at ?? r.created_at ?? ""));
    if (!Number.isFinite(due) || due >= cutoff) continue;
    stalled++;
    const mins = Math.floor((now.getTime() - due) / 60_000);
    if (mins > oldestMinutes) oldestMinutes = mins;
    if (samples.length < 10) {
      samples.push(`${r.to_email ?? "?"} — ${r.subject ?? "(sin asunto)"} (${mins} min)`);
    }
  }
  return { stalled, oldestMinutes, samples };
}

export function renderOutboxBacklogBlock(b: OutboxBacklogVerdict): string {
  if (b.stalled === 0) return "";
  return `<div style="margin-top:16px;"><b style="color:#f87171;">CORREO SIN SALIR (${b.stalled})</b>
    <div style="font-size:13px;color:#94a3b8;">Mensajes en la bandeja de salida vencidos y todavía PENDING; el más antiguo lleva ${b.oldestMinutes} min. El envío no está drenando.</div>
    <ul style="font-size:12px;line-height:1.6;">${b.samples.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`;
}

/** A run still RUNNING after this many minutes is considered stuck. */
export const STUCK_MINUTES = 30;

export function classifyDigestDay(
  expected: Iterable<string>,
  runs: DigestRunRow[],
  now: Date = new Date(),
  stuckMinutes = STUCK_MINUTES,
): WatchdogVerdict {
  const byUser = new Map<string, DigestRunRow>();
  for (const r of runs) byUser.set(r.recipient_user_id, r);

  const failed: string[] = [];
  const stuck: string[] = [];
  const missing: string[] = [];
  const stuckCutoff = now.getTime() - stuckMinutes * 60_000;

  for (const uid of expected) {
    const run = byUser.get(uid);
    // MISSING — the crash-before-claim: no row at all. The digest cannot
    // report this about itself, which is the whole reason this job exists.
    if (!run) { missing.push(uid); continue; }
    const status = String(run.status ?? "");
    if (status === "FAILED") {
      failed.push(`${run.recipient_email ?? uid}: ${run.error_summary ?? "sin detalle"}`);
    } else if (status === "RUNNING" && Date.parse(String(run.created_at ?? "")) < stuckCutoff) {
      stuck.push(String(run.recipient_email ?? uid));
    }
  }

  return { failed, stuck, missing, problems: failed.length + stuck.length + missing.length };
}

export function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderWatchdogSubject(digestDate: string, v: WatchdogVerdict): string {
  return `Andromeda — ⚠ resumen diario incompleto (${digestDate}): ${v.failed.length} fallidos · ${v.missing.length} sin corrida`;
}

export function renderWatchdogHtml(
  digestDate: string,
  expectedCount: number,
  v: WatchdogVerdict,
  backlog: OutboxBacklogVerdict = { stalled: 0, oldestMinutes: 0, samples: [] },
): string {
  const { failed, missing, stuck } = v;
  return `<!doctype html><html lang="es"><body style="margin:0;background:#0f172a;">
      <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#e2e8f0;">
        <div style="font-size:18px;font-weight:800;color:#f87171;">Andromeda — el resumen diario NO salió completo</div>
        <div style="font-size:13px;color:#94a3b8;margin-top:6px;">
          Día ${esc(digestDate)} (hora de Bogotá). Destinatarios esperados: ${expectedCount}.
          Esta alerta la envía un vigilante independiente del resumen: si el resumen se cae, este correo sigue saliendo.
        </div>
        ${failed.length ? `<div style="margin-top:16px;"><b style="color:#f87171;">FALLIDOS (${failed.length})</b>
          <ul style="font-size:13px;line-height:1.6;">${failed.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
        ${missing.length ? `<div style="margin-top:16px;"><b style="color:#fbbf24;">SIN CORRIDA (${missing.length})</b>
          <div style="font-size:13px;color:#94a3b8;">Destinatarios con asuntos monitoreados y ninguna fila en daily_digest_runs: el resumen no llegó a ejecutarse para ellos.</div>
          <ul style="font-size:12px;line-height:1.6;">${missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
        ${renderOutboxBacklogBlock(backlog)}
        ${stuck.length ? `<div style="margin-top:16px;"><b style="color:#fbbf24;">ATASCADOS (${stuck.length})</b>
          <ul style="font-size:13px;line-height:1.6;">${stuck.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
        <div style="margin-top:18px;font-size:12px;color:#94a3b8;">
          Acción: reejecutar <code>scheduled-daily-digest</code> para la fecha indicada. La ventana no se pierde:
          el próximo resumen abre donde cerró el último enviado.
        </div>
      </div></body></html>`;
}
