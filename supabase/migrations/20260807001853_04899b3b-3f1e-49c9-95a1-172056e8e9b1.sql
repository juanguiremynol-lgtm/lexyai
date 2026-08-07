ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS clase_proceso_last_read_case text,
  ADD COLUMN IF NOT EXISTS clase_proceso_last_attempt_at timestamptz;

COMMENT ON COLUMN public.work_items.clase_proceso_last_read_case IS
  'ITER42 — last GUARD A outcome for the provider clase contract: PRESENT | DECLINED | INCONCLUSIVE. Never null once a sync has run.';
COMMENT ON COLUMN public.work_items.clase_proceso_last_attempt_at IS
  'ITER42 — when the clase contract was last attempted, independent of outcome.';

ALTER TABLE public.work_items
  DROP CONSTRAINT IF EXISTS work_items_clase_read_case_chk;
ALTER TABLE public.work_items
  ADD CONSTRAINT work_items_clase_read_case_chk
  CHECK (clase_proceso_last_read_case IS NULL
         OR clase_proceso_last_read_case IN ('PRESENT','DECLINED','INCONCLUSIVE'));