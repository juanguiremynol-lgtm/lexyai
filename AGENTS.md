# Architecture rules

- evaluate-deadline-alerts is the only producer of TERMINO_* alerts: one live row per deadline, escalation in payload.escalation_history — avoids daily duplicate alerts.
- Hearing alerts come only from hearing-reminders reading work_item_hearings — the legacy `hearings` table is deprecated.
- Calendar export logic lives in `_shared/calendarExport.ts`, mirrored in `src/lib/calendar-export.ts` — same eligibility (PENDING+date, live hearing+scheduled_at) everywhere.
- Email calendar links use opaque tokens in `calendar_event_tokens` (service-role only) — never reuse digest_document_tokens.
- Alert preferences contract lives in `_shared/alertPreferences.ts` (mirrored in `src/lib/alert-preferences.ts`); missing row = defaults.
- Term milestones (8/3/1/0/overdue) use public.business_days_between_sql via RPC; manual reviews alert only as INFO TERMINO_REVISION_MANUAL — no JS holiday calendar, no provisional urgency.
- hearing-reminders milestones come from profiles.hearing_reminder_days (default [1,3,7]), Bogotá dates, one live HEARING_REMINDER per hearing (fingerprint hearing_REM_<id>); legacy alerts table not written.

- PENDING dated terms with attribution DESCONOCIDO/AMBAS get one INFO TERMINO_ATRIBUCION_PENDIENTE (gated by manual_review_info, default on); JUEZ/CONTRAPARTE never alert — never imply an unconfirmed burden.
