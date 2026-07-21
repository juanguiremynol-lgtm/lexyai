INSERT INTO public.atenia_ai_observations (organization_id, kind, severity, title, payload, links)
SELECT
  wi.organization_id,
  'DATA_QUALITY',
  'WARNING'::observation_severity,
  'Clasificación LABORAL heredada — verifica manualmente',
  jsonb_build_object(
    'work_item_id', wi.id,
    'radicado', wi.radicado,
    'legacy_rule', 'corp_40_42_to_laboral',
    'new_rule', 'esp_04_05_only',
    'authority_name', wi.authority_name
  ),
  jsonb_build_array(jsonb_build_object('type','WORK_ITEM','id', wi.id))
FROM public.work_items wi
WHERE wi.workflow_type = 'LABORAL'
  AND wi.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.atenia_ai_observations o
    WHERE o.kind = 'DATA_QUALITY'
      AND o.payload->>'work_item_id' = wi.id::text
      AND o.payload->>'legacy_rule' = 'corp_40_42_to_laboral'
  );