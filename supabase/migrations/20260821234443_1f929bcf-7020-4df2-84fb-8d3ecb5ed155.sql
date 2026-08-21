
ALTER TABLE public.alert_instances DROP CONSTRAINT IF EXISTS alert_instances_status_check;
ALTER TABLE public.alert_instances
  ADD CONSTRAINT alert_instances_status_check
  CHECK (status = ANY (ARRAY['PENDING','SENT','ACKNOWLEDGED','FIRED','RESOLVED','CANCELLED','DISMISSED','SUPERSEDED']));

COMMENT ON CONSTRAINT alert_instances_status_check ON public.alert_instances IS
 'SUPERSEDED (EE1): duplicate alert collapsed into the live one for the same deadline. Not resolved, not dismissed.';

DROP INDEX IF EXISTS public.idx_alert_instances_active;
CREATE INDEX idx_alert_instances_active ON public.alert_instances
  USING btree (organization_id, status)
  WHERE (status <> ALL (ARRAY['DISMISSED'::text,'RESOLVED'::text,'CANCELLED'::text,'SUPERSEDED'::text]));
