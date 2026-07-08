
DELETE FROM public.work_item_hearings
WHERE work_item_id = '7b038fac-f82a-4619-8c10-fe1fe22b8d57'
  AND scheduled_at = '2026-07-08 14:00:00+00'::timestamptz
  AND auto_detected = true;
