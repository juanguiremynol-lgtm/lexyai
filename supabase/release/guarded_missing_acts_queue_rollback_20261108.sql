-- Stop future additions and remove only untouched tasks created by this
-- release. Claimed or subsequently changed tasks stay in the normal queue.
BEGIN;
SELECT cron.unschedule(jobid) FROM cron.job
WHERE jobname='guarded-missing-acts-queue-v1';
DELETE FROM public.sync_retry_queue q
USING public.guarded_acts_queue_audit_20261108 a
WHERE q.id=a.queue_id AND q.work_item_id=a.work_item_id
  AND q.organization_id=a.organization_id AND q.kind='ACT_SCRAPE_RETRY'
  AND q.attempt=0 AND q.claimed_at IS NULL AND q.lease_token IS NULL
  AND q.created_at=a.created_at AND q.updated_at=a.created_at;
DROP FUNCTION IF EXISTS public.enqueue_guarded_missing_acts_20261108(boolean,integer);
-- Retain the audit table for accountability.
COMMIT;
