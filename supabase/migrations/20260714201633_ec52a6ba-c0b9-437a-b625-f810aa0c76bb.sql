
ALTER TABLE public.work_item_deadlines
  DROP CONSTRAINT IF EXISTS work_item_deadlines_status_check;

ALTER TABLE public.work_item_deadlines
  ADD CONSTRAINT work_item_deadlines_status_check
  CHECK (status = ANY (ARRAY[
    'PENDING'::text,'MET'::text,'MISSED'::text,'CANCELLED'::text,
    'REQUIERE_REVISION_MANUAL'::text,'HISTORICAL_BACKFILL'::text,'PENDING_REVIEW'::text
  ]));

UPDATE public.work_item_deadlines
SET status = 'HISTORICAL_BACKFILL',
    calculation_meta = COALESCE(calculation_meta, '{}'::jsonb) || jsonb_build_object(
      'closure_reason', 'PRE_ENGINE_BACKFILL',
      'closed_at', now(),
      'note', 'Vencido antes de la activación del motor local (2026-07-14). Registro histórico, fuera del fan-out de alertas.'
    )
WHERE status = 'PENDING'
  AND deadline_date < CURRENT_DATE - INTERVAL '30 days';

UPDATE public.work_item_deadlines
SET status = 'PENDING_REVIEW',
    calculation_meta = COALESCE(calculation_meta, '{}'::jsonb) || jsonb_build_object(
      'review_reason', 'BACKFILL_OVERDUE_LAST_30_DAYS',
      'flagged_at', now(),
      'note', 'Vencido en los últimos 30 días detectado por backfill inicial. Puede haber precluido sin alerta previa; requiere revisión manual.'
    )
WHERE status = 'PENDING'
  AND deadline_date <  CURRENT_DATE
  AND deadline_date >= CURRENT_DATE - INTERVAL '30 days';

INSERT INTO public.alert_instances (
  owner_id, organization_id,
  entity_id, entity_type,
  severity, alert_type, alert_source, status,
  title, message,
  fingerprint,
  payload, actions,
  fired_at
)
SELECT
  agg.owner_id, agg.organization_id,
  agg.owner_id, 'USER',
  'WARNING', 'TERMINO_CRITICO', 'DEADLINE_ENGINE', 'PENDING',
  'Revisión de términos vencidos recientes (' || agg.n || ')',
  'El motor de términos se activó hoy y detectó ' || agg.n ||
    ' término(s) vencido(s) en los últimos 30 días que no fueron alertados en su momento. ' ||
    'Revísalos en la sección "Términos vencidos sin alerta (revisión requerida)".',
  'terminos_review_backfill_' || agg.owner_id::text || '_2026-07-14',
  jsonb_build_object(
    'kind', 'CONSOLIDATED_BACKFILL_REVIEW',
    'count', agg.n,
    'deadline_ids', agg.ids,
    'window_days', 30,
    'engine', 'LOCAL',
    'activation_date', '2026-07-14'
  ),
  jsonb_build_array(
    jsonb_build_object('label','Ver términos en revisión','action','navigate',
                       'params', jsonb_build_object('path','/app/terminos?status=PENDING_REVIEW'))
  ),
  now()
FROM (
  SELECT owner_id, organization_id,
         COUNT(*) AS n,
         jsonb_agg(id ORDER BY deadline_date DESC) AS ids
  FROM public.work_item_deadlines
  WHERE status = 'PENDING_REVIEW'
  GROUP BY owner_id, organization_id
) agg
ON CONFLICT (fingerprint) DO NOTHING;

DO $$
DECLARE v_h INT; v_r INT; v_p INT; v_a INT;
BEGIN
  SELECT COUNT(*) INTO v_h FROM public.work_item_deadlines WHERE status='HISTORICAL_BACKFILL';
  SELECT COUNT(*) INTO v_r FROM public.work_item_deadlines WHERE status='PENDING_REVIEW';
  SELECT COUNT(*) INTO v_p FROM public.work_item_deadlines WHERE status='PENDING';
  SELECT COUNT(*) INTO v_a FROM public.alert_instances WHERE fingerprint LIKE 'terminos_review_backfill_%';
  RAISE NOTICE '[anti-avalancha] historical=% review=% pending=% consolidated_alerts=%', v_h, v_r, v_p, v_a;
END $$;
