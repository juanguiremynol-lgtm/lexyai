
ALTER TABLE public.alert_instances DROP CONSTRAINT IF EXISTS alert_instances_entity_type_check;
ALTER TABLE public.alert_instances
  ADD CONSTRAINT alert_instances_entity_type_check
  CHECK (entity_type = ANY (ARRAY['WORK_ITEM','CLIENT','USER','SYSTEM','HEARING']));
