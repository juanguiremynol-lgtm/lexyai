/**
 * scheduled-daily-digest — ONE consolidated daily email per recipient (HH1).
 *
 * ARCHITECTURAL DECISION (iteration HH): Supabase is the single source of truth
 * for what the lawyer is told. GCP is a scraper. This function is the only
 * place that composes the daily narrative.
 *
 * BINDING PRINCIPLE — a deleted matter appears in NOTHING. This is enforced
 * STRUCTURALLY, not by render-time filtering: the only entry point for matters
 * is `v_monitored_work_items`, which is defined as
 *   deleted_at IS NULL AND monitoring_enabled AND monitoring_suspended_at IS NULL.
 * Every child query (acts, publicaciones, hearings, deadlines) is constrained by
 * `IN (<ids from that view>)`. There is no code path that reads `work_items`.
 *
 * IDEMPOTENCY (HH1c): `daily_digest_runs` carries a unique index on
 * (recipient_user_id, digest_date). The insert is the lock: a second run on the
 * same Bogotá day loses the race and exits without enqueuing anything.
 *
 * EMPTY vs FAILED (HH1d): an empty day still writes a run row with status
 * EMPTY_NO_EMAIL and no email is sent. A crashed day either writes FAILED or
 * leaves no row at all — both are visibly different from EMPTY_NO_EMAIL, and
 * the job heartbeat records the run independently.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { finishHeartbeat, startHeartbeat } from "../_shared/platformJobHeartbeat.ts";
import { buildDigestHtml } from "./html.ts";
import { isNonJudicial } from "./types.ts";
import type {
  ActuacionRow,
  ConnectionIssueRow,
  DeadlineRow,
  DigestDocument,
  EstadoRow,
  HearingRow,
  SuspendedItemRow,
  WorkItemInfo,
} from "./types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_BASE_URL = "https://andromeda.legal";
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

/** HH3(b)/S8 — download links live 30 days, well beyond the 7-day floor. */
const LINK_EXPIRY_DAYS = 30;
const HEARING_HORIZON_DAYS = 7;
const DEADLINE_HORIZON_DAYS = 7;
const DEFAULT_WINDOW_HOURS = 24;
const SILENCE_HOURS = 72;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Current calendar day in Bogotá (UTC-5, no DST). */
function bogotaDate(now = new Date()): string {
  return new Date(now.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isHttp(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v.trim());
}

interface TokenSpec {
  token: string;
  recipient_user_id: string;
  organization_id: string | null;
  work_item_id: string;
  kind: "ESTADO" | "ACTUACION";
  publicacion_id: string | null;
  act_id: string | null;
  doc_url: string | null;
  doc_label: string;
  expires_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body?.dry_run === true;
  /** Dry-run only: return the rendered HTML instead of enqueuing it. */
  const previews: string[] = [];
  const onlyUser = typeof body?.user_id === "string" ? body.user_id : null;
  const digestDate = typeof body?.digest_date === "string" ? body.digest_date : bogotaDate();
  const hb = await startHeartbeat(supabase, "scheduled-daily-digest", String(body?.source ?? "cron"), {
    digest_date: digestDate,
    dry_run: dryRun,
  });

  const summary = {
    digest_date: digestDate,
    recipients: 0,
    sent: 0,
    empty: 0,
    skipped_already_ran: 0,
    skipped_opted_out: 0,
    failed: 0,
    documents_linked: 0,
    errors: [] as string[],
  };

  try {
    // ── STRUCTURAL SOURCE: the canonical monitored view. Nothing else. ──
    const { data: monitored, error: monErr } = await supabase
      .from("v_monitored_work_items")
      .select(
        "id, owner_id, organization_id, title, radicado, authority_name, demandantes, demandados, workflow_type, last_successful_sync_at",
      );
    if (monErr) throw monErr;

    const byOwner = new Map<string, WorkItemInfo[]>();
    const orgOf = new Map<string, string | null>();
    for (const wi of monitored ?? []) {
      if (!wi.owner_id) continue;
      if (onlyUser && wi.owner_id !== onlyUser) continue;
      const list = byOwner.get(wi.owner_id) ?? [];
      list.push(wi as unknown as WorkItemInfo);
      byOwner.set(wi.owner_id, list);
      if (!orgOf.has(wi.owner_id)) orgOf.set(wi.owner_id, wi.organization_id ?? null);
    }
    summary.recipients = byOwner.size;

    const nowIso = new Date().toISOString();

    for (const [ownerId, items] of byOwner) {
      try {
        // ── Idempotency lock: the unique index does the work. ──
        const { data: claimed, error: claimErr } = await supabase
          .from("daily_digest_runs")
          .insert({
            digest_date: digestDate,
            recipient_user_id: ownerId,
            organization_id: orgOf.get(ownerId) ?? null,
            status: "RUNNING",
            window_to: nowIso,
          })
          .select("id")
          .maybeSingle();

        if (claimErr) {
          // 23505 = a digest for this recipient/day already exists.
          if ((claimErr as { code?: string }).code === "23505") {
            summary.skipped_already_ran++;
            continue;
          }
          throw claimErr;
        }
        const runId = claimed?.id as string | undefined;
        if (!runId) { summary.skipped_already_ran++; continue; }

        const fail = async (msg: string) => {
          summary.failed++;
          summary.errors.push(`${ownerId}: ${msg}`);
          await supabase.from("daily_digest_runs")
            .update({ status: "FAILED", error_summary: msg.slice(0, 500), finished_at: new Date().toISOString() })
            .eq("id", runId);
        };

        // Recipient + preferences.
        const [{ data: profile }, { data: prefs }] = await Promise.all([
          supabase.from("profiles").select("default_alert_email, email, full_name").eq("id", ownerId).maybeSingle(),
          supabase.from("alert_preferences").select("preferences").eq("user_id", ownerId).maybeSingle(),
        ]);
        const email = profile?.default_alert_email || profile?.email || null;
        const prefsObj = (prefs?.preferences ?? {}) as Record<string, unknown>;
        if (prefsObj.email_enabled === false) {
          summary.skipped_opted_out++;
          await supabase.from("daily_digest_runs")
            .update({ status: "SKIPPED_OPTED_OUT", finished_at: new Date().toISOString() })
            .eq("id", runId);
          continue;
        }
        if (!email) { await fail("no_recipient_email"); continue; }

        // Window: from the end of the previous digest, else last 24h.
        const { data: prevRun } = await supabase
          .from("daily_digest_runs")
          .select("window_to")
          .eq("recipient_user_id", ownerId)
          .in("status", ["SENT", "EMPTY_NO_EMAIL"])
          .lt("digest_date", digestDate)
          .order("digest_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        // `window_from` in the request body is a dry-run/backfill aid only.
        const windowFrom = (typeof body?.window_from === "string" ? body.window_from : null) ??
          prevRun?.window_to ??
          new Date(Date.now() - DEFAULT_WINDOW_HOURS * 3600_000).toISOString();

        const ids = items.map((i) => i.id);
        const wiMap = new Map<string, WorkItemInfo>(items.map((i) => [i.id, i]));
        // JJ3 — PETICION / GOV_PROCEDURE are not judicial: no provider ever
        // reads them, so they are never queried against provider tables and
        // never counted with the judicial portfolio.
        const judicialItems = items.filter((i) => !isNonJudicial(i.workflow_type));
        const nonJudicialItems = items.filter((i) => isNonJudicial(i.workflow_type));
        const judicialIds = judicialItems.map((i) => i.id);
        const nonJudicialIds = new Set(nonJudicialItems.map((i) => i.id));

        // ── Novedades: actuaciones (acts in the expediente) ──
        const { data: rawActs, error: actErr } = await supabase
          .from("work_item_acts")
          .select("id, work_item_id, source, act_date, detected_at, description, act_type, event_summary, despacho, documentos, organization_id")
          .in("work_item_id", judicialIds)
          .eq("is_archived", false)
          .gt("detected_at", windowFrom)
          .lte("detected_at", nowIso)
          .order("detected_at", { ascending: false })
          .limit(400);
        if (actErr) { await fail(`acts: ${actErr.message}`); continue; }

        // ── Novedades: estados (publications fixed on the list) ──
        const { data: rawPubs, error: pubErr } = await supabase
          .from("work_item_publicaciones")
          .select("id, work_item_id, source, title, annotation, fecha_fijacion, fecha_providencia, detected_at, pdf_url, pdf_storage_path, pdf_available, organization_id")
          .in("work_item_id", judicialIds)
          .eq("is_archived", false)
          .gt("detected_at", windowFrom)
          .lte("detected_at", nowIso)
          .order("detected_at", { ascending: false })
          .limit(400);
        if (pubErr) { await fail(`publicaciones: ${pubErr.message}`); continue; }

        // ── Próximas audiencias (7 días) ──
        const horizon = new Date(Date.now() + HEARING_HORIZON_DAYS * 86_400_000).toISOString();
        const { data: rawHearings } = await supabase
          .from("hearings")
          .select("id, work_item_id, title, scheduled_at, location, is_virtual, virtual_link")
          .in("work_item_id", ids)
          .is("deleted_at", null)
          .gte("scheduled_at", nowIso)
          .lte("scheduled_at", horizon)
          .order("scheduled_at", { ascending: true });

        // ── Términos: vencidos + por vencer (7 días) ──
        const today = bogotaDate();
        const dueBy = new Date(Date.now() + DEADLINE_HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);
        const { data: rawDeadlines } = await supabase
          .from("work_item_deadlines")
          .select("id, work_item_id, label, deadline_type, deadline_date, status")
          .in("work_item_id", ids)
          .eq("status", "PENDING")
          .lte("deadline_date", dueBy)
          .order("deadline_date", { ascending: true });

        // ── HH3: build download tokens ──
        const tokens: TokenSpec[] = [];
        const expiresAt = new Date(Date.now() + LINK_EXPIRY_DAYS * 86_400_000).toISOString();

        const actuaciones: ActuacionRow[] = (rawActs ?? []).map((a) => {
          const docs: DigestDocument[] = [];
          const list = Array.isArray(a.documentos) ? a.documentos : [];
          for (const d of list as Record<string, unknown>[]) {
            const url = [d?.gcs_url, d?.url, d?.url_origen].find(isHttp) as string | undefined;
            if (!url) continue; // announced but unlinked → treated as "sin documento"
            const label = String(d?.nombre ?? d?.tipo ?? "Documento");
            const token = newToken();
            tokens.push({
              token, recipient_user_id: ownerId, organization_id: a.organization_id ?? null,
              work_item_id: a.work_item_id, kind: "ACTUACION", publicacion_id: null, act_id: a.id,
              doc_url: url, doc_label: label, expires_at: expiresAt,
            });
            docs.push({ label, url: `${FUNCTIONS_BASE}/digest-document?t=${token}` });
          }
          return {
            id: a.id, work_item_id: a.work_item_id, source: a.source,
            act_date: a.act_date, detected_at: a.detected_at,
            description: a.description, act_type: a.act_type,
            annotation: a.event_summary ?? null, despacho: a.despacho,
            documents: docs,
          };
        });

        const estados: EstadoRow[] = (rawPubs ?? []).map((p) => {
          const docs: DigestDocument[] = [];
          if (p.pdf_storage_path || isHttp(p.pdf_url) || p.pdf_available) {
            const token = newToken();
            tokens.push({
              token, recipient_user_id: ownerId, organization_id: p.organization_id ?? null,
              work_item_id: p.work_item_id, kind: "ESTADO", publicacion_id: p.id, act_id: null,
              doc_url: null, doc_label: "Documento del estado", expires_at: expiresAt,
            });
            docs.push({ label: "Descargar PDF", url: `${FUNCTIONS_BASE}/digest-document?t=${token}` });
          }
          return {
            id: p.id, work_item_id: p.work_item_id, source: p.source,
            title: p.title, fecha_fijacion: p.fecha_fijacion,
            fecha_actuacion: p.fecha_providencia ?? null,
            detected_at: p.detected_at, observacion: p.annotation,
            documents: docs,
          };
        });

        const hearings: HearingRow[] = (rawHearings ?? []) as unknown as HearingRow[];
        const deadlines: DeadlineRow[] = (rawDeadlines ?? []).map((d) => {
          const days = Math.round(
            (new Date(`${d.deadline_date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000,
          );
          return { ...d, overdue: days < 0, days_left: days } as DeadlineRow;
        });

        const hasContent =
          actuaciones.length + estados.length + hearings.length + deadlines.length > 0;

        if (!hasContent) {
          summary.empty++;
          await supabase.from("daily_digest_runs").update({
            status: "EMPTY_NO_EMAIL",
            window_from: windowFrom,
            monitored_count: items.length,
            recipient_email: email,
            finished_at: new Date().toISOString(),
          }).eq("id", runId);
          continue;
        }

        const silentCount = items.filter((i) =>
          !i.last_successful_sync_at ||
          Date.now() - new Date(i.last_successful_sync_at).getTime() > SILENCE_HOURS * 3600_000
        ).length;

        const html = buildDigestHtml({
          recipientName: profile?.full_name ?? null,
          windowFrom, windowTo: nowIso,
          monitoredCount: items.length,
          silentCount,
          actuaciones, estados, hearings, deadlines,
          workItems: wiMap,
          appBaseUrl: APP_BASE_URL,
          linkExpiryDays: LINK_EXPIRY_DAYS,
        });

        const novedades = actuaciones.length + estados.length;
        const subject = novedades > 0
          ? `Andromeda — ${novedades} novedad${novedades === 1 ? "" : "es"} (${estados.length} estados · ${actuaciones.length} actuaciones)`
          : `Andromeda — Resumen diario: audiencias y términos`;

        if (dryRun) {
          if (body?.preview === true) previews.push(html);
          await supabase.from("daily_digest_runs").update({
            status: "EMPTY_NO_EMAIL",
            error_summary: "dry_run",
            window_from: windowFrom,
            monitored_count: items.length,
            actuaciones_count: actuaciones.length,
            estados_count: estados.length,
            hearings_count: hearings.length,
            deadlines_count: deadlines.length,
            documents_linked: tokens.length,
            recipient_email: email,
            finished_at: new Date().toISOString(),
          }).eq("id", runId);
          summary.documents_linked += tokens.length;
          continue;
        }

        if (tokens.length > 0) {
          const { error: tokErr } = await supabase.from("digest_document_tokens").insert(tokens);
          if (tokErr) { await fail(`tokens: ${tokErr.message}`); continue; }
        }

        const { data: outbox, error: outErr } = await supabase.from("email_outbox").insert({
          organization_id: orgOf.get(ownerId) ?? "00000000-0000-0000-0000-000000000000",
          to_email: email,
          to_user_id: ownerId,
          subject,
          html,
          status: "PENDING",
          next_attempt_at: new Date().toISOString(),
          trigger_reason: "DAILY_CONSOLIDATED_DIGEST",
          trigger_event: "scheduled-daily-digest",
          dedupe_key: `daily-digest-${ownerId}-${digestDate}`,
        }).select("id").maybeSingle();

        if (outErr) { await fail(`outbox: ${outErr.message}`); continue; }

        summary.sent++;
        summary.documents_linked += tokens.length;
        await supabase.from("daily_digest_runs").update({
          status: "SENT",
          window_from: windowFrom,
          monitored_count: items.length,
          actuaciones_count: actuaciones.length,
          estados_count: estados.length,
          hearings_count: hearings.length,
          deadlines_count: deadlines.length,
          documents_linked: tokens.length,
          recipient_email: email,
          email_outbox_id: outbox?.id ?? null,
          finished_at: new Date().toISOString(),
        }).eq("id", runId);
      } catch (ownerErr) {
        summary.failed++;
        summary.errors.push(`${ownerId}: ${String(ownerErr)}`);
      }
    }

    if (!dryRun && summary.sent > 0) {
      await fetch(`${FUNCTIONS_BASE}/process-email-outbox`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ triggered_by: "scheduled-daily-digest" }),
      }).catch((e) => console.warn("[scheduled-daily-digest] outbox kick failed", e));
    }

    await finishHeartbeat(supabase, hb, summary.failed > 0 ? "ERROR" : "OK", {
      errorMessage: summary.errors.slice(0, 3).join("; ") || undefined,
      metadata: summary as unknown as Record<string, unknown>,
    });
    return json({ ok: true, ...summary, previews: previews.length ? previews : undefined });
  } catch (err) {
    console.error("[scheduled-daily-digest] fatal", err);
    await finishHeartbeat(supabase, hb, "ERROR", { errorMessage: String(err) });
    return json({ ok: false, error: String(err), ...summary }, 500);
  }
});
