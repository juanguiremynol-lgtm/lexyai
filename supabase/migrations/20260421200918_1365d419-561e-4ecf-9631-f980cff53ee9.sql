-- Normalize existing rows to uppercase
UPDATE public.alert_instances
SET entity_type = UPPER(entity_type)
WHERE entity_type IS NOT NULL
  AND entity_type != UPPER(entity_type);

-- Drop existing constraint if present, then add canonical CHECK
ALTER TABLE public.alert_instances
  DROP CONSTRAINT IF EXISTS alert_instances_entity_type_check;

ALTER TABLE public.alert_instances
  ADD CONSTRAINT alert_instances_entity_type_check
  CHECK (entity_type IN ('WORK_ITEM','CLIENT','USER','SYSTEM'));