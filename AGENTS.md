# Architecture rules

- Legal acceptance uses canonical database documents and the server current-version check; never accept fallback or title-only text, and never let a stale profile flag override a confirmed acceptance — preserves the displayed-text audit contract.

- evaluate-deadline-alerts is the only producer of TERMINO_* alerts: one live row per deadline, escalation in payload.escalation_history — avoids daily duplicate alerts.
- Hearing alerts come only from hearing-reminders reading work_item_hearings — the legacy `hearings` table is deprecated.
- Calendar export logic lives in `_shared/calendarExport.ts`, mirrored in `src/lib/calendar-export.ts` — same eligibility (PENDING+date, live hearing+scheduled_at) everywhere.
- Email calendar links use opaque tokens in `calendar_event_tokens` (service-role only) — never reuse digest_document_tokens.
- Alert preferences contract lives in `_shared/alertPreferences.ts` (mirrored in `src/lib/alert-preferences.ts`); missing row = defaults.
- Term milestones (8/3/1/0/overdue) use public.business_days_between_sql via RPC; manual reviews alert only as INFO TERMINO_REVISION_MANUAL — no JS holiday calendar, no provisional urgency.
- hearing-reminders milestones come from profiles.hearing_reminder_days (default [1,3,7]), Bogotá dates, one live HEARING_REMINDER per hearing (fingerprint hearing_REM_<id>); legacy alerts table not written.

- PENDING dated terms with attribution DESCONOCIDO/AMBAS get one INFO TERMINO_ATRIBUCION_PENDIENTE (gated by manual_review_info, default on); JUEZ/CONTRAPARTE never alert — never imply an unconfirmed burden.
- Generic deadline rules that must not yield a dated judicial deadline are vetoed centrally in public.deadline_rule_override (used by both compute_deadline_for_* functions) — one place, auditable reason in calculation_meta.

- Automatic AI enrichment (supervisor diagnosis) is capped at one provider call per org per Bogotá day via atomic reservation in public.atenia_ai_daily_ai_usage (RPC atenia_ai_reserve_daily_ai) made BEFORE the provider call; respects atenia_ai_config.gemini_enabled and reuses the same-day report diagnosis.
- aiClassifyEmail counts every real provider attempt (including retries) against AI_CALLS_PER_RUN; exhaustion degrades to regex-only, never drops or misclassifies mail.
- pg_cron job 80 (email-semantics-backfill) is gated by an EXISTS predicate identical to the function eligibility filter (CONFIRMED+received+ai_classified_at null+opaque subtype).

- atenia-self-health AI check is PASSIVE only: it reads the AI_VERIFY_LINK heartbeat left by real verifications and never fires a paid gateway probe; no recent usage is reported as "not verified", never as an outage. aiVerifyLinkProbe exists only for explicit authorized manual smoke tests.
- atenia-cron-watchdog HEARTBEAT_MAX_GAP_MINUTES=420 matches the 6h heartbeat cron cadence plus 60min slack (aligned with platformJobHeartbeat 420min); a tighter threshold would force hourly heartbeats.
- Act identity is resolved in supabase/functions/_shared/actOriginIdentity.ts by origin-component EQUIVALENCE (indice / solicitud No. / radicación timestamp) over all rows sharing the v1 prefix or semantic key; stored fingerprints are never re-keyed and <v1>_o<hash> is minted only on insert of a different origin. Attachment states come from evidence only (no evidence = desconocido); 'disponible'/'parcial' require verified PDF bytes from an allow-listed Andromeda bucket.
- Historical contamination repair in sync is off by default (HISTORICAL_REPAIR_SCOPE=null); it may run only for explicitly approved SAMAI act ids after a backup — normal sync must never rewrite history.
- After a confirmed act write, sync must abort on a failed or missing read-back before processing another act — an incomplete candidate set can reuse an already committed fingerprint.
- The generated MCP bundle (supabase/functions/mcp/index.ts) is type-stripped JS: type-check its source with tsconfig.mcp.json and validate the artifact with scripts/check-mcp-artifact.ts — never hand-edit or suppress the artifact.
- A CPNU snapshot flagged stale whose live re-read was deferred never counts as a successful sync (no SUCCESS, no last_synced_at advance; last_error_code CPNU_SNAPSHOT_STALE_DEFERRED) — prevents silent coverage gaps.
- Official Rama portal documents (publicacionesprocesales get_file) are recovered only via the attachment queue with raw_data.recuperacion_oficial {url, sha256, article_id, id_despacho, fecha}; worker and finish_estado_attachment_download both require exact URL+SHA match — never title/date matching.
- Central publishers (e.g. Centros de Servicios) publish multi-providencia estado packages under their own despacho code: resolve candidates by author despacho, then municipality + articleNamesAuthorDespacho, and bind a case only to the pages located by `_shared/publisherResolution.ts` (declared `paquete.paginas_caso`) — never bind a whole package to all cases.
- trg_preserve_official_publication_recovery: stale responses never erase official evidence.
- Read subdir AGENTS.md.
- MCP writes are gated by an explicit per-user, per-OAuth-client manage grant (public.mcp_client_grants, bound to the current auth.oauth_consents row/granted_at), granted only from first-party sessions; public.mcp_write_allowed() backs restrictive RLS policies and is injected into SECURITY DEFINER write RPCs — OIDC scopes and tool arguments never prove consent.
- Every mcp_* write RPC runs _mcp_begin/_mcp_finish (idempotency per user+client+action+key with request hash, atomic audit in mcp_action_audit) — retries replay the committed result instead of re-applying.
- MCP list_updates selects changes by row revision (updated_at), dedupes by kind:id:revision and reads freshness only from RLS-visible work_item_sync_timeline (success-only counts) — detected_at is immutable and cannot reveal corrections.
- set_work_item_lifecycle is owner-only for user callers (verified session + MCP manage gate inside the function); only public._mcp_is_trusted_backend() (service_role JWT or no-JWT backend login, never current_user) may act on others' rows or fan out sibling DELETED events — business/platform admins only read work_items per ROLE_AND_SUBSCRIPTION_SPEC §5.
