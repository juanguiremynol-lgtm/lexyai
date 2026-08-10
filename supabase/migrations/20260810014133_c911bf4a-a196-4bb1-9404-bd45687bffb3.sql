ALTER TABLE public.work_item_deadlines
  ADD COLUMN IF NOT EXISTS bound_party_role text,
  ADD COLUMN IF NOT EXISTS is_judge_side boolean NOT NULL DEFAULT false;

ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS client_party_represents text;

ALTER TABLE public.work_items
  DROP CONSTRAINT IF EXISTS work_items_client_party_represents_check;
ALTER TABLE public.work_items
  ADD CONSTRAINT work_items_client_party_represents_check
  CHECK (client_party_represents IS NULL OR client_party_represents IN ('DEMANDANTE','DEMANDADO'));

-- Populate from the ratified rule catalogue (deadline_type is the catalogue key).
UPDATE public.work_item_deadlines d
SET bound_party_role = r.bound_party_role,
    is_judge_side = COALESCE(r.is_judge_side, false)
FROM public.workflow_deadline_rules r
WHERE r.deadline_type = d.deadline_type
  AND r.status = 'RATIFIED'
  AND r.bound_party_role IS NOT NULL
  AND (d.bound_party_role IS DISTINCT FROM r.bound_party_role
       OR d.is_judge_side IS DISTINCT FROM COALESCE(r.is_judge_side, false));

-- Everything with no resolvable rule is explicitly unattributed, never assumed own.
UPDATE public.work_item_deadlines
SET bound_party_role = 'DESCONOCIDO'
WHERE bound_party_role IS NULL;

ALTER TABLE public.work_item_deadlines
  ALTER COLUMN bound_party_role SET DEFAULT 'DESCONOCIDO';

CREATE INDEX IF NOT EXISTS idx_work_item_deadlines_bound_party
  ON public.work_item_deadlines (bound_party_role);