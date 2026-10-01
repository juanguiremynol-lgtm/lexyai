-- P0.1: regenerate_doctrine_alerts no longer emits TERMINO_* alerts.
-- evaluate-deadline-alerts is the sole producer (stable fingerprint deadline_TERM_<id>).
CREATE OR REPLACE FUNCTION public.regenerate_doctrine_alerts()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_hearings int := 0; v_sugg jsonb;
BEGIN
  PERFORM set_config('app.alert_bypass_breaker', 'on', true);

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
  RETURN jsonb_build_object('terminos', 0, 'terminos_producer', 'evaluate-deadline-alerts',
                            'audiencias', v_hearings, 'sugerencias', v_sugg);
END
$function$;

-- P0.2: manual-review semantics. Backup, backfill, then keep in sync.
CREATE TABLE public.deadline_manual_review_backup_20261001 (
  deadline_id uuid PRIMARY KEY,
  prev_requires_manual_review boolean NOT NULL,
  prev_status text NOT NULL,
  applied_updated_at timestamptz,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.deadline_manual_review_backup_20261001 TO service_role;
ALTER TABLE public.deadline_manual_review_backup_20261001 ENABLE ROW LEVEL SECURITY;

INSERT INTO public.deadline_manual_review_backup_20261001 (deadline_id, prev_requires_manual_review, prev_status)
SELECT id, requires_manual_review, status FROM public.work_item_deadlines
 WHERE status = 'REQUIERE_REVISION_MANUAL' AND requires_manual_review IS DISTINCT FROM true;

WITH upd AS (
  UPDATE public.work_item_deadlines d SET requires_manual_review = true
    FROM public.deadline_manual_review_backup_20261001 b
   WHERE d.id = b.deadline_id
  RETURNING d.id, d.updated_at)
UPDATE public.deadline_manual_review_backup_20261001 b SET applied_updated_at = upd.updated_at
  FROM upd WHERE b.deadline_id = upd.id;

CREATE OR REPLACE FUNCTION public.sync_manual_review_flag()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'REQUIERE_REVISION_MANUAL' THEN
    NEW.requires_manual_review := true;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_sync_manual_review_flag
BEFORE INSERT OR UPDATE OF status, requires_manual_review ON public.work_item_deadlines
FOR EACH ROW EXECUTE FUNCTION public.sync_manual_review_flag();