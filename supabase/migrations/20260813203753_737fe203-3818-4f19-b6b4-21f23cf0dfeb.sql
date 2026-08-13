DROP INDEX IF EXISTS public.work_item_successions_hop_uidx;
ALTER TABLE public.work_item_successions
  ADD CONSTRAINT work_item_successions_hop_uniq
  UNIQUE (origin_work_item_id, relation_type, trigger_act_id);