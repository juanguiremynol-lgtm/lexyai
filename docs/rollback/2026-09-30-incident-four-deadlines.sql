-- Rollback for the 30/09/2026 digest incident (four deadlines only).
-- Restores each deadline ONLY if it has not been modified since the repair
-- (updated_at still equals applied_updated_at). Later human edits are never
-- overwritten. Alerts are restored only if still DISMISSED with the incident reason.
BEGIN;
UPDATE public.work_item_deadlines w
   SET status = b.snapshot->>'status',
       requires_manual_review = (b.snapshot->>'requires_manual_review')::boolean,
       label = b.snapshot->>'label',
       deadline_date = (b.snapshot->>'deadline_date')::date,
       business_days_count = (b.snapshot->>'business_days_count')::int,
       calculation_meta = b.snapshot->'calculation_meta',
       updated_at = now()
  FROM public.deadline_incident_backup_20260930 b
 WHERE w.id = b.deadline_id AND w.updated_at = b.applied_updated_at;

UPDATE public.alert_instances a
   SET status = x->>'status', dismissal_reason = x->>'dismissal_reason'
  FROM public.deadline_incident_backup_20260930 b,
       jsonb_array_elements(b.snapshot->'_open_alerts') x
 WHERE a.id = (x->>'id')::uuid AND a.status = 'DISMISSED'
   AND a.dismissal_reason = 'INCIDENTE_2026_09_30_TERMINO_EN_REVISION_MANUAL';
COMMIT;
-- Function/rule changes: re-apply definitions from /tmp dumps are not kept;
-- previous definitions are in drizzle/migrations prior to 0020 and in
-- docs/rollback/2026-09-25-deadline-trigger.sql.
