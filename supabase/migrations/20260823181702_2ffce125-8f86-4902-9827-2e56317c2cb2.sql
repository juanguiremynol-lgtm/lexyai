CREATE TABLE IF NOT EXISTS public.work_item_lifecycle_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL,
  radicado text,
  workflow_type text,
  from_state text,
  to_state text NOT NULL,
  actor text NOT NULL DEFAULT 'SYSTEM',
  actor_user_id uuid,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  record_origin text NOT NULL DEFAULT 'OBSERVED',
  emitted_to_gcp boolean NOT NULL DEFAULT false,
  gcp_outbox_id uuid,
  gcp_acknowledged_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_item_lifecycle_ledger_origin_chk
    CHECK (record_origin IN ('OBSERVED','BACKFILL_GCP_OUTBOX'))
);

COMMENT ON TABLE public.work_item_lifecycle_ledger IS
  'PP3 — append-only constancia of every work_item lifecycle transition. Not control, not surfaced. record_origin=BACKFILL_GCP_OUTBOX rows are reconstructions from the outbox, never presented as observed.';

CREATE INDEX IF NOT EXISTS idx_wi_lifecycle_ledger_item ON public.work_item_lifecycle_ledger(work_item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_wi_lifecycle_ledger_rad ON public.work_item_lifecycle_ledger(radicado);

GRANT SELECT ON public.work_item_lifecycle_ledger TO authenticated;
GRANT ALL ON public.work_item_lifecycle_ledger TO service_role;

ALTER TABLE public.work_item_lifecycle_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lifecycle ledger readable by platform admins" ON public.work_item_lifecycle_ledger;
CREATE POLICY "lifecycle ledger readable by platform admins"
  ON public.work_item_lifecycle_ledger FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.record_lifecycle_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_outbox_id uuid;
BEGIN
  IF NEW.lifecycle_state IS NOT DISTINCT FROM OLD.lifecycle_state THEN
    RETURN NEW;
  END IF;

  SELECT o.id INTO v_outbox_id
  FROM public.gcp_lifecycle_outbox o
  WHERE o.work_item_id = NEW.id
    AND o.new_state::text = NEW.lifecycle_state::text
  ORDER BY o.occurred_at DESC
  LIMIT 1;

  INSERT INTO public.work_item_lifecycle_ledger (
    work_item_id, radicado, workflow_type, from_state, to_state,
    actor, actor_user_id, reason, occurred_at, record_origin,
    emitted_to_gcp, gcp_outbox_id, metadata
  ) VALUES (
    NEW.id,
    regexp_replace(COALESCE(NEW.radicado_digits, NEW.radicado, ''), '\D', '', 'g'),
    NEW.workflow_type::text,
    OLD.lifecycle_state::text,
    NEW.lifecycle_state::text,
    COALESCE(NEW.lifecycle_actor, 'SYSTEM'),
    NEW.lifecycle_actor_user,
    NEW.lifecycle_reason,
    COALESCE(NEW.lifecycle_changed_at, now()),
    'OBSERVED',
    v_outbox_id IS NOT NULL,
    v_outbox_id,
    jsonb_build_object('via_rpc', COALESCE(current_setting('andromeda.via_lifecycle_rpc', true), 'off'))
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_record_lifecycle_transition ON public.work_items;
CREATE TRIGGER trg_record_lifecycle_transition
AFTER UPDATE OF lifecycle_state ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.record_lifecycle_transition();

CREATE OR REPLACE FUNCTION public.wi_lifecycle_soft_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_via_rpc text := current_setting('andromeda.via_lifecycle_rpc', true);
  v_rad23 text;
BEGIN
  IF v_via_rpc = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    IF NEW.lifecycle_state <> 'ACTIVE' THEN
      RAISE EXCEPTION
        'lifecycle_state -> % debe pasar por set_work_item_lifecycle (work_item %). La suspensión de visibilidad no es un estado de ciclo de vida.',
        NEW.lifecycle_state, NEW.id;
    END IF;

    v_rad23 := NULLIF(regexp_replace(COALESCE(NEW.radicado_digits, NEW.radicado, ''), '\D', '', 'g'), '');
    IF v_rad23 IS NOT NULL AND v_rad23 !~ '^\d{23}$' THEN
      v_rad23 := NULL;
    END IF;

    INSERT INTO public.gcp_lifecycle_outbox (
      work_item_id, radicado, workflow_type, prev_state, new_state,
      reason, actor, actor_user_id, metadata, occurred_at
    ) VALUES (
      NEW.id, v_rad23,
      COALESCE(NULLIF(NEW.workflow_type::text, ''), 'INDETERMINADO'),
      OLD.lifecycle_state, NEW.lifecycle_state,
      COALESCE(NEW.lifecycle_reason, 'REACTIVACION_ESCRITURA_DIRECTA'),
      COALESCE(NEW.lifecycle_actor, 'SYSTEM'), NEW.lifecycle_actor_user,
      jsonb_build_object('emitted_by', 'wi_lifecycle_soft_guard'), clock_timestamp()
    );
  END IF;

  IF (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
     OR (NEW.monitoring_enabled IS DISTINCT FROM OLD.monitoring_enabled)
     OR (NEW.scraping_enabled IS DISTINCT FROM OLD.scraping_enabled)
  THEN
    RAISE WARNING 'work_items lifecycle field mutated outside set_work_item_lifecycle RPC (id=%)', NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

INSERT INTO public.work_item_lifecycle_ledger (
  work_item_id, radicado, workflow_type, from_state, to_state,
  actor, actor_user_id, reason, occurred_at, record_origin,
  emitted_to_gcp, gcp_outbox_id, gcp_acknowledged_at, metadata
)
SELECT o.work_item_id,
       regexp_replace(COALESCE(o.radicado, ''), '\D', '', 'g'),
       o.workflow_type,
       o.prev_state::text,
       o.new_state::text,
       COALESCE(o.actor, 'SYSTEM'),
       o.actor_user_id,
       o.reason,
       o.occurred_at,
       'BACKFILL_GCP_OUTBOX',
       true,
       o.id,
       o.delivered_at,
       jsonb_build_object(
         'reconstruido_desde', 'gcp_lifecycle_outbox',
         'advertencia', 'Fila reconstruida: no es una transición observada en el momento en que ocurrió.'
       )
FROM public.gcp_lifecycle_outbox o
WHERE NOT EXISTS (
  SELECT 1 FROM public.work_item_lifecycle_ledger l WHERE l.gcp_outbox_id = o.id
);