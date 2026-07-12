INSERT INTO public.sync_retry_queue (work_item_id, organization_id, radicado, workflow_type, kind, provider, attempt, max_attempts, next_run_at)
SELECT wi.id, wi.organization_id, wi.radicado, wi.workflow_type, k.kind, k.provider, 0, 3, now() - interval '1 minute'
FROM public.work_items wi
CROSS JOIN (VALUES ('ACT_SCRAPE_RETRY','cpnu'), ('PUB_RETRY','publicaciones')) AS k(kind, provider)
WHERE wi.id IN ('b7a54f5a-87d7-46f2-b23c-50e941699bff','b6f5f649-f659-4ab5-b99f-ec3ad26cdb3b');