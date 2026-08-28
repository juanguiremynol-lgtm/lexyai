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
 * A dry run (`dry_run: true`) takes the same lock while it composes and then
 * DELETES it. A preview leaves no row: it neither consumes the day's slot nor
 * advances `window_to`, so the real 06:30 digest still goes out with the whole
 * window intact.
 *
 * EMPTY vs FAILED (HH1d): an empty day still writes a run row with status
 * EMPTY_NO_EMAIL and no email is sent. A crashed day either writes FAILED or
 * leaves no row at all — both are visibly different from EMPTY_NO_EMAIL, and
 * the job heartbeat records the run independently.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { finishHeartbeat, startHeartbeat } from "../_shared/platformJobHeartbeat.ts";
import {
  type LedgerEntry,
  notYetDispatched,
  recordDispatch,
} from "../_shared/notificationChannel.ts";
import { buildDigestHtml } from "./html.ts";
import { isNonJudicial } from "./types.ts";
import {
  classifySourceRunQuality,
  mayAssertAuthoritativeNoNovedades,
  SOURCE_LABEL,
} from "../_shared/sourceRunQuality.ts";
import type {
  ActuacionRow,
  ConnectionIssueRow,
  DeadlineRow,
  DigestDocument,
  EstadoRow,
  HearingRow,
  NeverReadRow,
  ReconciliationNoticeRow,
  SourceQualityRow,
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

  // ── ZZ2 — THE WINDOW IS A CALENDAR DAY IN BOGOTÁ, NOT A ROLLING 24h ──────
  // A lawyer reasons in judicial days: the estados of one day are one list, and
  // a rolling window cut at generation time splits that list across two emails
  // (which is exactly how 26-ago's act landed in the 27-ago mail here and in
  // the 28-ago mail at GCP). The window therefore closes at 00:00 COT of the
  // digest date and opens where the previous digest closed — so a missed day
  // widens the window instead of dropping it.
  const bogotaDayStart = (d: string) => `${d}T05:00:00.000Z`;
  const prevBogotaDate = (d: string) =>
    new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  /** Closing boundary: 00:00 COT of `digestDate`. */
  const windowTo = typeof body?.window_to === "string" ? body.window_to : bogotaDayStart(digestDate);
  /** Default opening boundary: 00:00 COT of the previous calendar day. */
  const calendarFrom = bogotaDayStart(prevBogotaDate(digestDate));
  /** ZZ2(b) — the same window said in words the reader can check. */
  const windowLabel = new Date(`${prevBogotaDate(digestDate)}T12:00:00Z`).toLocaleDateString(
    "es-CO",
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" },
  );
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
        "id, owner_id, organization_id, title, radicado, authority_name, demandantes, demandados, workflow_type, clase_proceso, last_successful_sync_at, last_attempted_sync_at, last_error_code, created_at",
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

    // ── TT6 — COLLECTION QUALITY BEFORE ANY ZERO-NOVEDADES CLAIM ────────────
    // Zero ingested rows is not evidence of judicial silence unless the source
    // that would have carried the movement actually read the portfolio. This
    // block is computed once per invocation (source health is firm-independent)
    // and travels into every recipient's payload.
    const sourceWindowFrom = new Date(Date.now() - DEFAULT_WINDOW_HOURS * 3600_000).toISOString();
    const sourceQuality: SourceQualityRow[] = [];
    for (const src of ["cpnu", "publicaciones", "samai", "samai_estados"]) {
      const { data: q, error: qErr } = await supabase.rpc("source_collection_quality", {
        _source: src,
        _from: sourceWindowFrom,
        _to: nowIso,
      });
      if (qErr) {
        console.warn("[scheduled-daily-digest] source_collection_quality failed", src, qErr.message);
        continue;
      }
      const row = (Array.isArray(q) ? q[0] : q) as Record<string, unknown> | null;
      if (!row) continue;
      const counts = {
        source: src,
        expected_count: Number(row.expected_count ?? 0),
        attempted_count: Number(row.attempted_count ?? 0),
        usable_confirmed_count: Number(row.usable_confirmed_count ?? 0),
        success_count: Number(row.success_count ?? 0),
        success_empty_count: Number(row.success_empty_count ?? 0),
        not_found_count: Number(row.not_found_count ?? 0),
        restricted_count: Number(row.restricted_count ?? 0),
        pending_upstream_count: Number(row.pending_upstream_count ?? 0),
        error_count: Number(row.error_count ?? 0),
      };
      // The SQL classifier is authoritative; the TS mirror is the fallback and
      // the guard against a stale/absent DB verdict.
      const state = (typeof row.source_quality_state === "string"
        ? row.source_quality_state
        : classifySourceRunQuality(counts)) as SourceQualityRow["state"];
      sourceQuality.push({
        ...counts,
        state,
        label: SOURCE_LABEL[src] ?? src,
        authoritative: mayAssertAuthoritativeNoNovedades(state),
        // YY1(e) — the profiles' effect on the denominator, always disclosed.
        expected_before_profile: Number(row.expected_before_profile ?? counts.expected_count),
        excluded_by_profile: Number(row.excluded_by_profile ?? 0),
      });
    }
    const coverageIncomplete = sourceQuality.some((s) => !s.authoritative);


    for (const [ownerId, items] of byOwner) {
      let claimedRunId: string | null = null;
      try {
        // ── Idempotency lock: the unique index does the work. ──
        const { data: claimed, error: claimErr } = await supabase
          .from("daily_digest_runs")
          .insert({
            digest_date: digestDate,
            recipient_user_id: ownerId,
            organization_id: orgOf.get(ownerId) ?? null,
            status: "RUNNING",
            window_to: windowTo,
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
        claimedRunId = runId;

        // A preview must never consume the day. The claim row exists only to
        // hold the unique index while the run composes; on a dry run it is
        // released, so the real 06:30 digest still runs and its window still
        // starts where the last SENT digest ended.
        const releaseClaim = async () => {
          await supabase.from("daily_digest_runs").delete().eq("id", runId);
        };

        const fail = async (msg: string) => {
          summary.failed++;
          summary.errors.push(`${ownerId}: ${msg}`);
          if (dryRun) { await releaseClaim(); return; }
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
          calendarFrom;

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
        // D3 — `is_notifiable` is the DB's own verdict on "novedad real vs
        // importación inicial" (handle_actuacion_notifiability): false while
        // the matter has no `acts_initial_sync_completed_at`, or when the act
        // predates the matter. The digest MUST honour it; counting by
        // `detected_at` alone turns a reactivated expediente's whole history
        // into today's news.
        const { data: rawActsAll, error: actErr } = await supabase
          .from("work_item_acts")
          .select("id, work_item_id, source, act_date, detected_at, description, act_type, event_summary, despacho, documentos, documentos_observados_en, organization_id, is_notifiable")
          .in("work_item_id", judicialIds)
          .eq("is_archived", false)
          .gt("detected_at", windowFrom)
          .lte("detected_at", windowTo)
          .order("detected_at", { ascending: false })
          .limit(400);
        if (actErr) { await fail(`acts: ${actErr.message}`); continue; }

        // ── Novedades: estados (publications fixed on the list) ──
        const { data: rawPubsAll, error: pubErr } = await supabase
          .from("work_item_publicaciones")
          .select("id, work_item_id, source, title, annotation, fecha_fijacion, fecha_providencia, detected_at, pdf_url, pdf_storage_path, pdf_available, organization_id, is_notifiable")
          .in("work_item_id", judicialIds)
          .eq("is_archived", false)
          .gt("detected_at", windowFrom)
          .lte("detected_at", windowTo)
          .order("detected_at", { ascending: false })
          .limit(400);
        if (pubErr) { await fail(`publicaciones: ${pubErr.message}`); continue; }

        // D3 — historial importado: everything detected in the window that the
        // DB does not consider a novedad. Reported apart, never counted.
        const historyActs = (rawActsAll ?? []).filter((a) => a.is_notifiable !== true);
        const historyPubs = (rawPubsAll ?? []).filter((p) => p.is_notifiable !== true);

        // D1 — a movement already mailed by the per-event channel is not
        // repeated here. The ledger is the shared record of both channels.
        const notifiableActs = (rawActsAll ?? []).filter((a) => a.is_notifiable === true);
        const notifiablePubs = (rawPubsAll ?? []).filter((p) => p.is_notifiable === true);
        const [pendingActIds, pendingPubIds] = await Promise.all([
          notYetDispatched(supabase, ownerId, "ACT", notifiableActs.map((a) => a.id)),
          notYetDispatched(supabase, ownerId, "PUB", notifiablePubs.map((p) => p.id)),
        ]);
        const rawActs = notifiableActs.filter((a) => pendingActIds.has(a.id));
        const rawPubs = notifiablePubs.filter((p) => pendingPubIds.has(p.id));


        // ── Próximas audiencias (7 días) ──
        const horizon = new Date(Date.now() + HEARING_HORIZON_DAYS * 86_400_000).toISOString();
        // AD1(d) — the firm's calendar lives in `work_item_hearings`. The old
        // `hearings` table is empty, which is why an auto-detected audiencia
        // never reached this mail. Both queries below read the live table.
        const { data: rawHearings } = await supabase
          .from("work_item_hearings")
          .select("id, work_item_id, custom_name, scheduled_at, location, modality, meeting_link, status")
          .in("work_item_id", ids)
          .gte("scheduled_at", nowIso)
          .lte("scheduled_at", horizon)
          .neq("status", "CANCELLED")
          .order("scheduled_at", { ascending: true });

        // ── AD1(d) — audiencias MÁS ALLÁ del horizonte de 7 días ────────────
        // Una audiencia fijada en agosto para noviembre no puede ser invisible
        // hasta finales de octubre. Se listan aparte, sin mezclarse con la
        // agenda inmediata y sin contarse como novedad.
        const farHorizon = new Date(Date.now() + 180 * 86_400_000).toISOString();
        const { data: rawHearingsBeyond } = await supabase
          .from("work_item_hearings")
          .select("id, work_item_id, custom_name, scheduled_at, location, modality, meeting_link, status")
          .in("work_item_id", ids)
          .gt("scheduled_at", horizon)
          .lte("scheduled_at", farHorizon)
          .neq("status", "CANCELLED")
          .order("scheduled_at", { ascending: true })
          .limit(50);

        const toHearingRow = (h: Record<string, unknown>): HearingRow => ({
          id: h.id as string,
          work_item_id: h.work_item_id as string,
          title: (h.custom_name as string | null) ?? null,
          scheduled_at: h.scheduled_at as string,
          location: (h.location as string | null) ?? null,
          is_virtual: String(h.modality ?? "").toUpperCase() === "VIRTUAL",
          virtual_link: (h.meeting_link as string | null) ?? null,
        });

        // ── Términos: vencidos (dentro de la gracia) + por vencer (7 días) ──
        // NN1(b): a term that expired more than 3 business days ago has been
        // drained to VENCIDO_SIN_ACTUACION and is no longer PENDING, so it
        // leaves this section on its own. NN2: attribution comes from the
        // shared view; his terms and the counterparty's are never mixed.
        const today = bogotaDate();
        const dueBy = new Date(Date.now() + DEADLINE_HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);
        const { data: rawDeadlines } = await supabase
          .from("v_deadline_attribution")
          .select("deadline_id, work_item_id, label, deadline_type, deadline_date, status, attribution, bound_party_role")
          .in("work_item_id", ids)
          .eq("status", "PENDING")
          .lte("deadline_date", dueBy)
          .order("deadline_date", { ascending: true });

        // ── JJ1(c): estado del canal de correo de la firma ──
        const { data: rawConns } = await supabase
          .from("user_email_connections")
          .select("ms_account_email, status, token_expires_at, failure_code, last_sync_at, revoked_at")
          .eq("user_id", ownerId);

        const connectionIssues: ConnectionIssueRow[] = [];
        for (const c of rawConns ?? []) {
          const expires = c.token_expires_at ? new Date(c.token_expires_at).getTime() : null;
          const expired = expires !== null && expires < Date.now();
          const expiringSoon = expires !== null && !expired && expires < Date.now() + 7 * 86_400_000;
          if (c.status === "ERROR" || c.status === "REVOKED" || c.revoked_at) {
            connectionIssues.push({
              mailbox: c.ms_account_email ?? null,
              status: c.revoked_at ? "REVOCADA" : String(c.status),
              severity: "CRITICAL",
              headline: "La conexión con su buzón está caída",
              detail:
                "Ningún correo del despacho se está vinculando a los expedientes. La evidencia de lo que hizo la firma no se está capturando desde que la conexión falló.",
              since: c.token_expires_at ?? c.last_sync_at ?? null,
            });
          } else if (expired) {
            connectionIssues.push({
              mailbox: c.ms_account_email ?? null,
              status: "PERMISO CADUCADO",
              severity: "CRITICAL",
              headline: "El permiso del buzón caducó",
              detail: "La vinculación de correspondencia está detenida hasta que reconecte el buzón.",
              since: c.token_expires_at ?? null,
            });
          } else if (expiringSoon) {
            // JJ1(d): avisar ANTES del vencimiento.
            connectionIssues.push({
              mailbox: c.ms_account_email ?? null,
              status: "POR VENCER",
              severity: "WARNING",
              headline: "El permiso del buzón vence en menos de 7 días",
              detail: "Reconéctelo antes de esa fecha para no perder correspondencia del despacho.",
              since: c.token_expires_at ?? null,
            });
          }
        }

        // ── OO1: asuntos ocultos del resumen (monitoring_suspended_at) ──
        // monitoring_suspended_at gates VISIBILITY only; lifecycle_state gates
        // INGESTION. A hidden matter with lifecycle ACTIVE is still being read.
        const { data: rawSuspended } = await supabase
          .from("work_items")
          .select("id, radicado, title, workflow_type, lifecycle_state, monitoring_suspended_at, monitoring_suspended_reason")
          .eq("owner_id", ownerId)
          .is("deleted_at", null)
          .eq("monitoring_enabled", true)
          .not("monitoring_suspended_at", "is", null)
          .order("monitoring_suspended_at", { ascending: true });

        const suspended: SuspendedItemRow[] = [];
        for (const s of rawSuspended ?? []) {
          const sinceDate = (s.monitoring_suspended_at ?? "").slice(0, 10);
          let acts_since = 0;
          let estados_since = 0;
          let last_movement_at: string | null = null;

          if (sinceDate) {
            const { data: actRows } = await supabase
              .from("work_item_acts")
              .select("event_date")
              .eq("work_item_id", s.id)
              .gt("event_date", sinceDate);
            const { data: pubRows } = await supabase
              .from("work_item_publicaciones")
              .select("fecha_fijacion, published_at")
              .eq("work_item_id", s.id);

            const dates: string[] = [];
            for (const a of actRows ?? []) {
              if (!a.event_date) continue;
              acts_since++;
              dates.push(String(a.event_date).slice(0, 10));
            }
            for (const p of pubRows ?? []) {
              const d = String(p.fecha_fijacion ?? p.published_at ?? "").slice(0, 10);
              if (!d || d <= sinceDate) continue;
              estados_since++;
              dates.push(d);
            }
            dates.sort();
            last_movement_at = dates.length ? dates[dates.length - 1] : null;
          }

          suspended.push({
            id: s.id,
            radicado: s.radicado,
            title: s.title,
            workflow_type: s.workflow_type,
            suspended_at: s.monitoring_suspended_at,
            reason: s.monitoring_suspended_reason,
            lifecycle_state: s.lifecycle_state ?? null,
            reading_active: s.lifecycle_state === "ACTIVE",
            acts_since,
            estados_since,
            last_movement_at,
          });
        }


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
            // KK3(a) — the provider always returns a list; only
            // `documentos_observados_en` proves it was ever consulted.
            document_availability: docs.length
              ? "DISPONIBLE"
              : (a as { documentos_observados_en?: string | null }).documentos_observados_en
              ? "SIN_DOCUMENTO"
              : "NO_CONSULTADO",
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
            // For estados, `pdf_available IS NULL` is the unasked state:
            // an explicit `false` is the provider answering "no PDF".
            document_availability: docs.length
              ? "DISPONIBLE"
              : p.pdf_available === null || p.pdf_available === undefined
              ? "NO_CONSULTADO"
              : "SIN_DOCUMENTO",
          };
        });


        // ── ZZ1 — THE SAME PROVIDENCIA REACHING US THROUGH TWO CHANNELS ──────
        // A providencia is registered by the clerk (actuación) and published on
        // the list (estado). Both are kept, both are rendered in their own
        // table, with their own dates and their own provider label: this is a
        // CROSS-REFERENCE, never a merge (HH2 stands).
        //
        // MATCHING KEY (ZZ1c) — `public.v_providencia_cross_ref`:
        //   work_item_id + estado.fecha_providencia = actuación.act_date,
        //   restricted to providencia-bearing acts (fijaciones de estado are
        //   excluded, they are the vehicle and not the act), and corroborated
        //   by lexical overlap between the estado's annotation and the act's
        //   description. A link is emitted ONLY when the candidate is unique.
        //   Rejected keys: the "Providencia 2026-00082" number is the matter's
        //   consecutive, not a per-providencia identifier, so it discriminates
        //   nothing; a PDF content hash is unusable because the act side
        //   frequently carries no file at all — which is the very defect here.
        const actById = new Map(actuaciones.map((a) => [a.id, a]));
        const pubById = new Map(estados.map((e) => [e.id, e]));
        if (actById.size || pubById.size) {
          const orParts = [
            actById.size ? `act_id.in.(${[...actById.keys()].join(",")})` : null,
            pubById.size ? `pub_id.in.(${[...pubById.keys()].join(",")})` : null,
          ].filter(Boolean).join(",");
          const { data: xrefs, error: xErr } = await supabase
            .from("v_providencia_cross_ref")
            .select("pub_id, act_id, work_item_id, act_date, fecha_fijacion, confidence, match_basis")
            .or(orParts);
          if (xErr) console.warn("[scheduled-daily-digest] cross-ref failed", xErr.message);

          // Documents to borrow: only for acts that carry none of their own,
          // and only when the link is ALTA. AB1(b) — a MEDIA link rests on the
          // date alone (or on too little text to separate same-day
          // candidates); lending it a PDF would invite reliance on a document
          // that may belong to a different providencia of the same day.
          const needPub = [...new Set((xrefs ?? [])
            .filter((x) => x.confidence === "ALTA")
            .filter((x) => (actById.get(x.act_id)?.documents.length ?? 1) === 0)
            .map((x) => x.pub_id))];
          const pubSource = new Map<string, Record<string, unknown>>();
          if (needPub.length) {
            const { data: pubRows } = await supabase
              .from("work_item_publicaciones")
              .select("id, organization_id, pdf_url, pdf_storage_path, pdf_available")
              .in("id", needPub);
            for (const r of pubRows ?? []) pubSource.set(r.id as string, r);
          }

          for (const x of xrefs ?? []) {
            const est = pubById.get(x.pub_id);
            if (est) {
              est.crossRef = {
                counterpart_id: x.act_id, act_date: x.act_date,
                fecha_fijacion: x.fecha_fijacion, confidence: x.confidence,
                match_basis: x.match_basis,
              };
            }
            const act = actById.get(x.act_id);
            if (!act) continue;
            let borrowed = false;
            if (x.confidence === "ALTA" && act.documents.length === 0) {
              const src = pubSource.get(x.pub_id);
              if (src && (src.pdf_storage_path || isHttp(src.pdf_url) || src.pdf_available)) {
                const token = newToken();
                tokens.push({
                  token, recipient_user_id: ownerId,
                  organization_id: (src.organization_id as string | null) ?? null,
                  work_item_id: act.work_item_id, kind: "ESTADO",
                  publicacion_id: x.pub_id, act_id: null,
                  doc_url: null, doc_label: "Documento del estado",
                  expires_at: expiresAt,
                });
                act.documents.push({
                  label: "Descargar PDF (publicado en el estado)",
                  url: `${FUNCTIONS_BASE}/digest-document?t=${token}`,
                });
                borrowed = true;
              }
            }
            // `document_availability` is deliberately NOT rewritten: on the
            // actuación channel the provider still attached nothing, and the
            // borrowed link says where it actually comes from.
            act.crossRef = {
              counterpart_id: x.pub_id, act_date: x.act_date,
              fecha_fijacion: x.fecha_fijacion, confidence: x.confidence,
              match_basis: x.match_basis, documents_borrowed: borrowed,
            };
          }
        }

        // ── AD1(a) — CONTEXTO: LAS ACTUACIONES INMEDIATAMENTE ANTERIORES ────
        // Cada novedad se acompaña de los 3 actos que la preceden en el mismo
        // expediente. Es contexto de lectura, no novedad: no se cuenta, no
        // entra al ledger, no lleva documento y no altera ninguna cifra.
        const contextIds = [...new Set([
          ...actuaciones.map((a) => a.work_item_id),
          ...estados.map((e) => e.work_item_id),
        ])];
        if (contextIds.length) {
          const novedadActIds = new Set(actuaciones.map((a) => a.id));
          const { data: histRows } = await supabase
            .from("work_item_acts")
            .select("id, work_item_id, act_date, description, act_type, event_summary")
            .in("work_item_id", contextIds)
            .eq("is_archived", false)
            .order("act_date", { ascending: false })
            .limit(2000);
          const byItem = new Map<string, Record<string, unknown>[]>();
          for (const r of histRows ?? []) {
            const list = byItem.get(r.work_item_id as string) ?? [];
            list.push(r as Record<string, unknown>);
            byItem.set(r.work_item_id as string, list);
          }
          const priorTo = (wid: string, cutoff: string | null, excludeId?: string) =>
            (byItem.get(wid) ?? [])
              .filter((r) => r.id !== excludeId && !novedadActIds.has(r.id as string))
              .filter((r) => !cutoff || String(r.act_date ?? "") < String(cutoff).slice(0, 10))
              .slice(0, 3)
              .map((r) => ({
                act_date: (r.act_date as string | null) ?? null,
                description: (r.description as string | null) ?? (r.act_type as string | null) ?? null,
                annotation: (r.event_summary as string | null) ?? null,
              }));
          for (const a of actuaciones) a.precedingActs = priorTo(a.work_item_id, a.act_date, a.id);
          for (const e of estados) {
            e.precedingActs = priorTo(e.work_item_id, e.fecha_actuacion ?? e.fecha_fijacion);
          }
        }

        // ── ZZ2(d) — SUSCRITOS Y NUNCA CONSULTADOS ───────────────────────────
        // No successful read has ever happened AND nothing was ever stored.
        // This is the signal GCP's mail carries today; it must survive here.
        const neverReadCandidates = judicialItems.filter((i) => !i.last_successful_sync_at);
        const neverRead: NeverReadRow[] = [];
        if (neverReadCandidates.length) {
          const candIds = neverReadCandidates.map((i) => i.id);
          const [{ data: anyActs }, { data: anyPubs }] = await Promise.all([
            supabase.from("work_item_acts").select("work_item_id").in("work_item_id", candIds).limit(2000),
            supabase.from("work_item_publicaciones").select("work_item_id").in("work_item_id", candIds).limit(2000),
          ]);
          const withData = new Set<string>([
            ...(anyActs ?? []).map((r) => r.work_item_id as string),
            ...(anyPubs ?? []).map((r) => r.work_item_id as string),
          ]);
          for (const i of neverReadCandidates) {
            if (withData.has(i.id)) continue;
            const raw = i as unknown as Record<string, string | null>;
            const created = raw.created_at ?? null;
            neverRead.push({
              id: i.id, radicado: i.radicado, title: i.title,
              workflow_type: i.workflow_type,
              created_at: created,
              days_since_alta: created
                ? Math.floor((Date.now() - Date.parse(created)) / 86_400_000)
                : null,
              last_attempted_sync_at: raw.last_attempted_sync_at ?? null,
              last_error_code: raw.last_error_code ?? null,
            });
          }
          neverRead.sort((a, b) => (b.days_since_alta ?? 0) - (a.days_since_alta ?? 0));
        }

        const hearings: HearingRow[] = (rawHearings ?? []).map((h) => toHearingRow(h as Record<string, unknown>));
        const hearingsBeyond: HearingRow[] = (rawHearingsBeyond ?? []).map((h) => toHearingRow(h as Record<string, unknown>));
        const allDeadlines: DeadlineRow[] = (rawDeadlines ?? []).map((d: Record<string, unknown>) => {
          const days = Math.round(
            (new Date(`${d.deadline_date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000,
          );
          return { ...d, id: d.deadline_id, overdue: days < 0, days_left: days } as unknown as DeadlineRow;
        });
        // JJ3(b) — non-judicial deadlines are rendered apart, never merged.
        const deadlines = allDeadlines.filter((d) => !nonJudicialIds.has(d.work_item_id));
        const nonJudicialDeadlines = allDeadlines.filter((d) => nonJudicialIds.has(d.work_item_id));

        // D3 — «historial importado»: one line per matter, with the span of
        // the imported rows. A reactivated expediente produces ONE fact — that
        // it was reactivated — plus its history; never N novedades.
        const historyByItem = new Map<string, { acts: number; estados: number; years: number[] }>();
        const bumpHistory = (wid: string, kind: "acts" | "estados", date: string | null) => {
          const entry = historyByItem.get(wid) ?? { acts: 0, estados: 0, years: [] };
          entry[kind]++;
          const y = date ? Number(String(date).slice(0, 4)) : NaN;
          if (Number.isFinite(y)) entry.years.push(y);
          historyByItem.set(wid, entry);
        };
        for (const a of historyActs) bumpHistory(a.work_item_id, "acts", a.act_date);
        for (const p of historyPubs) bumpHistory(p.work_item_id, "estados", p.fecha_fijacion);
        const importedHistory = [...historyByItem.entries()].map(([wid, e]) => ({
          work_item_id: wid,
          rows: e.acts + e.estados,
          acts: e.acts,
          estados: e.estados,
          from_year: e.years.length ? Math.min(...e.years) : null,
          to_year: e.years.length ? Math.max(...e.years) : null,
        }));

        // ── YY3 — one-time reconciliation notices still undelivered. They are
        // content on their own: a recovered finding must reach the lawyer even
        // on a day with no novedades.
        const { data: rawNotices } = await supabase
          .from("digest_reconciliation_notices")
          .select("id, work_item_id, headline, detail, rows_count, from_date, to_date")
          .eq("owner_id", ownerId)
          .is("delivered_at", null)
          .limit(50);
        const reconciliations: ReconciliationNoticeRow[] =
          (rawNotices ?? []) as unknown as ReconciliationNoticeRow[];

        // TT6.1 — degraded coverage is itself content. A day with no rows and a
        // source that never delivered authoritative detail is NOT an empty day:
        // staying silent would let the lawyer read our silence as judicial
        // silence. That is precisely the misrepresentation of 2026-07-27.
        const hasContent =
          actuaciones.length + estados.length + hearings.length + allDeadlines.length +
            connectionIssues.length + importedHistory.length + reconciliations.length +
            neverRead.length > 0 ||
          coverageIncomplete;


        if (!hasContent) {
          summary.empty++;
          if (dryRun) { await releaseClaim(); continue; }
          await supabase.from("daily_digest_runs").update({
            status: "EMPTY_NO_EMAIL",
            window_from: windowFrom,
            monitored_count: judicialItems.length,
            recipient_email: email,
            finished_at: new Date().toISOString(),
          }).eq("id", runId);
          continue;
        }

        // ── LL1(b): per-provider act/estado tallies for the matters that show
        // novedades. Computed from Supabase's own rows (live, non-archived);
        // this is the authoritative figure for the recipient.
        const novedadIds = [...new Set([
          ...actuaciones.map((a) => a.work_item_id),
          ...estados.map((e) => e.work_item_id),
        ])];
        const providerCounts = new Map<string, { acts: Record<string, number>; estados: Record<string, number> }>();
        if (novedadIds.length) {
          const [{ data: actSrc }, { data: pubSrc }] = await Promise.all([
            supabase.from("work_item_acts").select("work_item_id, source")
              .in("work_item_id", novedadIds).eq("is_archived", false).limit(5000),
            supabase.from("work_item_publicaciones").select("work_item_id, source")
              .in("work_item_id", novedadIds).eq("is_archived", false).limit(5000),
          ]);
          const bump = (id: string, kind: "acts" | "estados", src: string | null) => {
            const entry = providerCounts.get(id) ?? { acts: {}, estados: {} };
            const key = src ?? "sin fuente";
            entry[kind][key] = (entry[kind][key] ?? 0) + 1;
            providerCounts.set(id, entry);
          };
          for (const r of actSrc ?? []) bump(r.work_item_id, "acts", r.source);
          for (const r of pubSrc ?? []) bump(r.work_item_id, "estados", r.source);
        }
        for (const [id, counts] of providerCounts) {
          const wi = wiMap.get(id);
          if (wi) wiMap.set(id, { ...wi, providerCounts: counts });
        }

        // ── YY2 — how this court behaves, in one sentence. Derived by the DB
        // from observed reads only; NULL while the evidence is insufficient,
        // and in that case nothing is said at all.
        const behaviourByCode = new Map<string, string | null>();
        for (const id of novedadIds) {
          const wi = wiMap.get(id);
          const code = (wi?.radicado ?? "").replace(/\D/g, "").slice(0, 12);
          if (!code || code.length < 12) continue;
          if (!behaviourByCode.has(code)) {
            const { data: stmt } = await supabase.rpc("despacho_behavior_statement", {
              p_radicado: wi?.radicado ?? "",
            });
            behaviourByCode.set(code, typeof stmt === "string" && stmt.length ? stmt : null);
          }
          const sentence = behaviourByCode.get(code) ?? null;
          if (wi && sentence) wiMap.set(id, { ...wiMap.get(id)!, courtBehavior: sentence });
        }

        const silentCount = judicialItems.filter((i) =>
          !i.last_successful_sync_at ||
          Date.now() - new Date(i.last_successful_sync_at).getTime() > SILENCE_HOURS * 3600_000
        ).length;

        const html = buildDigestHtml({
          recipientName: profile?.full_name ?? null,
          windowFrom, windowTo,
          windowLabel,
          coverageWindowFrom: sourceWindowFrom, coverageWindowTo: nowIso,
          neverRead,
          monitoredCount: judicialItems.length,
          nonJudicialCount: nonJudicialItems.length,
          silentCount,
          actuaciones, estados, hearings, deadlines,
          hearingsBeyond,
          stats: {
            procesosConNovedad: novedadIds.length,
            publicaciones: estados.filter((e) => (e.source ?? "").toLowerCase().includes("publicaciones")).length,
            cpnu: actuaciones.filter((a) => (a.source ?? "").toLowerCase().includes("cpnu")).length,
            samai: [...actuaciones, ...estados].filter((r) => (r.source ?? "").toLowerCase().includes("samai")).length,
            erroresFuente: sourceQuality.reduce((n, s) => n + s.error_count, 0),
          },
          importedHistory,
          reconciliations,

          nonJudicialDeadlines,
          connectionIssues,
          suspended,
          sourceQuality,
          coverageIncomplete,
          workItems: wiMap,
          appBaseUrl: APP_BASE_URL,
          linkExpiryDays: LINK_EXPIRY_DAYS,
        });

        const novedades = actuaciones.length + estados.length;
        const critical = connectionIssues.some((c) => c.severity === "CRITICAL");
        const subject = critical
          ? `Andromeda — ⚠ Conexión de correo caída · ${novedades} novedad${novedades === 1 ? "" : "es"}`
          : novedades > 0
          ? `Andromeda — ${novedades} novedad${novedades === 1 ? "" : "es"} (${estados.length} estados · ${actuaciones.length} actuaciones)`
          // TT6 — never promise a clean day when a source did not cover the portfolio.
          : coverageIncomplete
          ? `Andromeda — Resumen diario · cobertura incompleta de fuentes`
          : `Andromeda — Resumen diario: audiencias y términos`;

        if (dryRun) {
          if (body?.preview === true) previews.push(html);
          // No ledger row, no window advance, no consumed slot: the preview is
          // read-only with respect to the day's real digest.
          await releaseClaim();
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

        // D1 — record every movement this digest carried, so the per-event
        // channel never mails it again.
        const ledgerRows: LedgerEntry[] = [
          ...actuaciones.map((a) => ({
            recipient_user_id: ownerId,
            organization_id: orgOf.get(ownerId) ?? null,
            work_item_id: a.work_item_id,
            entity_kind: "ACT" as const,
            entity_id: a.id,
            channel: "DIGEST" as const,
          })),
          ...estados.map((e) => ({
            recipient_user_id: ownerId,
            organization_id: orgOf.get(ownerId) ?? null,
            work_item_id: e.work_item_id,
            entity_kind: "PUB" as const,
            entity_id: e.id,
            channel: "DIGEST" as const,
          })),
        ];
        await recordDispatch(supabase, ledgerRows);

        // YY3 — a reconciliation notice is consumed only by a real send. A dry
        // run returned long before this point, so a preview never burns it.
        if (reconciliations.length > 0) {
          await supabase
            .from("digest_reconciliation_notices")
            .update({ delivered_at: new Date().toISOString() })
            .in("id", reconciliations.map((r) => r.id));
        }


        await supabase.from("daily_digest_runs").update({
          status: "SENT",
          window_from: windowFrom,
          monitored_count: judicialItems.length,
          actuaciones_count: actuaciones.length,
          estados_count: estados.length,
          hearings_count: hearings.length,
          deadlines_count: allDeadlines.length,
          documents_linked: tokens.length,
          recipient_email: email,
          email_outbox_id: outbox?.id ?? null,
          finished_at: new Date().toISOString(),
        }).eq("id", runId);
      } catch (ownerErr) {
        summary.failed++;
        summary.errors.push(`${ownerId}: ${String(ownerErr)}`);
        // A preview that crashed must not leave a RUNNING row holding the
        // day's unique slot against the real digest.
        if (dryRun && claimedRunId) {
          await supabase.from("daily_digest_runs").delete().eq("id", claimedRunId);
        }
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
