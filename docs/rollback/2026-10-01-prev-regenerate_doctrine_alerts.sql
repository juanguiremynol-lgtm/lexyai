-- Rollback for 2026-10-01 alert-saturation fix.
-- 1) Restore previous regenerate_doctrine_alerts (it inserted one TERMINO_* row per term per day).
CREATE OR REPLACE FUNCTION public.regenerate_doctrine_alerts()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_terms int := 0; v_hearings int := 0; v_sugg jsonb;
BEGIN
  PERFORM set_config('app.alert_bypass_breaker', 'on', true);
  WITH cand AS (
    SELECT d.id, d.owner_id, d.organization_id, d.work_item_id, d.label, d.deadline_date, w.radicado,
           public.business_days_between_sql((now() AT TIME ZONE 'America/Bogota')::date, d.deadline_date) AS bd
      FROM public.work_item_deadlines d
      JOIN public.v_live_work_items w ON w.id = d.work_item_id
     WHERE d.status = 'PENDING' AND d.deadline_date IS NOT NULL
       AND COALESCE(w.lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED')
  ), ins AS (
    INSERT INTO public.alert_instances (owner_id, organization_id, entity_id, entity_type, severity, alert_type, status, title, message, payload, alert_source)
    SELECT c.owner_id, c.organization_id, c.work_item_id, 'WORK_ITEM',
      CASE WHEN c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date THEN 'CRITICAL' WHEN c.bd <= 3 THEN 'CRITICAL' ELSE 'WARNING' END,
      CASE WHEN c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date THEN 'TERMINO_VENCIDO' WHEN c.bd <= 3 THEN 'TERMINO_CRITICO' ELSE 'TERMINO_POR_VENCER' END,
      'PENDING',
      CASE WHEN c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date THEN 'Término vencido: ' || c.label
           ELSE 'Término por vencer (' || c.bd || ' días hábiles): ' || c.label END,
      'Radicado ' || COALESCE(c.radicado,'—') || ' — vence ' || to_char(c.deadline_date,'DD/MM/YYYY'),
      jsonb_build_object('deadline_id', c.id, 'radicado', c.radicado, 'deadline_date', c.deadline_date, 'business_days', c.bd),
      'DEADLINE_ENGINE'
      FROM cand c
     WHERE c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date OR c.bd <= 8
    ON CONFLICT (fingerprint) DO NOTHING RETURNING 1)
  SELECT count(*) INTO v_terms FROM ins;

  WITH ins AS (
    INSERT INTO public.alert_instances (owner_id, organization_id, entity_id, entity_type, severity, alert_type, status, title, message, payload, alert_source)
    SELECT h.owner_id, h.organization_id, COALESCE(h.work_item_id, h.id), 'WORK_ITEM',
      CASE WHEN (h.scheduled_at AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date THEN 'CRITICAL' ELSE 'WARNING' END,
      CASE WHEN (h.scheduled_at AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date THEN 'HEARING_TODAY' ELSE 'HEARING_UPCOMING' END,
      'PENDING',
      CASE WHEN (h.scheduled_at AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date
           THEN 'Audiencia hoy: ' || COALESCE(h.title,'sin título') ELSE 'Audiencia próxima: ' || COALESCE(h.title,'sin título') END,
      'Radicado ' || COALESCE(w.radicado,'—') || ' — ' || to_char(h.scheduled_at AT TIME ZONE 'America/Bogota','DD/MM/YYYY HH24:MI'),
      jsonb_build_object('hearing_id', h.id, 'radicado', w.radicado, 'scheduled_at', h.scheduled_at),
      'HEARINGS'
      FROM public.hearings h
      LEFT JOIN public.v_live_work_items w ON w.id = h.work_item_id
     WHERE h.deleted_at IS NULL
       AND COALESCE(h.status,'SCHEDULED') NOT IN ('CANCELLED','COMPLETED')
       AND h.scheduled_at >= date_trunc('day', now() AT TIME ZONE 'America/Bogota')
       AND h.scheduled_at < date_trunc('day', now() AT TIME ZONE 'America/Bogota') + interval '8 days'
       AND h.owner_id IS NOT NULL
       AND (h.work_item_id IS NULL OR w.id IS NOT NULL)
    ON CONFLICT (fingerprint) DO NOTHING RETURNING 1)
  SELECT count(*) INTO v_hearings FROM ins;

  v_sugg := public.sync_suggestion_alerts();
  PERFORM set_config('app.alert_bypass_breaker', 'off', true);
  RETURN jsonb_build_object('terminos', v_terms, 'audiencias', v_hearings, 'sugerencias', v_sugg);
END
$function$;

-- 2) Undo manual-review sync (restores only rows not edited since the backfill).
DROP TRIGGER IF EXISTS trg_sync_manual_review_flag ON public.work_item_deadlines;
DROP FUNCTION IF EXISTS public.sync_manual_review_flag();
UPDATE public.work_item_deadlines d
   SET requires_manual_review = b.prev_requires_manual_review
  FROM public.deadline_manual_review_backup_20261001 b
 WHERE d.id = b.deadline_id
   AND d.updated_at = b.applied_updated_at;
