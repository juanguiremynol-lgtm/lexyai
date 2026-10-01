# Architecture rules

- evaluate-deadline-alerts is the only producer of TERMINO_* alerts: one live row per deadline, escalation in payload.escalation_history — avoids daily duplicate alerts.
- Hearing alerts come only from hearing-reminders reading work_item_hearings — the legacy `hearings` table is deprecated.
- Calendar export logic lives in `_shared/calendarExport.ts`, mirrored in `src/lib/calendar-export.ts` — same eligibility (PENDING+date, live hearing+scheduled_at) everywhere.
- Email calendar links use opaque tokens in `calendar_event_tokens` (service-role only) — never reuse digest_document_tokens.
- Alert preferences contract lives in `_shared/alertPreferences.ts` (mirrored in `src/lib/alert-preferences.ts`); missing row = defaults.
