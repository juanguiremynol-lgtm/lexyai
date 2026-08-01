-- 1. Nuevo estado terminal para detecciones que ya existen en la cartera.
ALTER TABLE public.detected_processes DROP CONSTRAINT IF EXISTS detected_processes_status_check;
ALTER TABLE public.detected_processes
  ADD CONSTRAINT detected_processes_status_check
  CHECK (status = ANY (ARRAY['PENDING'::text, 'DISMISSED'::text, 'CREATED'::text, 'MATCHED_EXISTING'::text]));

-- Reconciliación por BASE de 21 dígitos (modelo 4.2: la instancia es metadato).
CREATE OR REPLACE FUNCTION public.reconcile_detected_processes(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH matched AS (
    SELECT d.id AS detection_id, w.id AS work_item_id
    FROM public.detected_processes d
    JOIN LATERAL (
      SELECT w.id
      FROM public.work_items w
      WHERE w.deleted_at IS NULL
        AND (
          w.owner_id = d.user_id
          OR (d.organization_id IS NOT NULL AND w.organization_id = d.organization_id)
        )
        AND left(regexp_replace(coalesce(w.radicado, ''), '\D', '', 'g'), 21)
            = left(regexp_replace(d.radicado, '\D', '', 'g'), 21)
        AND length(regexp_replace(coalesce(w.radicado, ''), '\D', '', 'g')) >= 21
      ORDER BY w.created_at ASC
      LIMIT 1
    ) w ON TRUE
    WHERE d.status = 'PENDING'
      AND (p_user_id IS NULL OR d.user_id = p_user_id)
  ), upd AS (
    UPDATE public.detected_processes d
    SET status = 'MATCHED_EXISTING',
        created_work_item_id = m.work_item_id,
        updated_at = now()
    FROM matched m
    WHERE d.id = m.detection_id
    RETURNING d.id
  )
  SELECT count(*)::integer INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_detected_processes(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reconcile_detected_processes(uuid) TO authenticated, service_role;

-- 2. Resúmenes persistidos de barridos (el gateway HTTP corta a los 150 s).
CREATE TABLE IF NOT EXISTS public.sync_full_sweep_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid,
  connection_id uuid,
  full_sweep boolean NOT NULL DEFAULT true,
  lookback_months integer,
  status text NOT NULL DEFAULT 'SUCCESS',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  messages_scanned integer NOT NULL DEFAULT 0,
  folders jsonb NOT NULL DEFAULT '{}'::jsonb,
  earliest_message_at timestamptz,
  detected_new integer NOT NULL DEFAULT 0,
  detected_updated integer NOT NULL DEFAULT 0,
  detected_skipped integer NOT NULL DEFAULT 0,
  reconciled integer NOT NULL DEFAULT 0,
  links_created integer NOT NULL DEFAULT 0,
  suggestions_created integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sync_full_sweep_runs TO authenticated;
GRANT ALL ON public.sync_full_sweep_runs TO service_role;

ALTER TABLE public.sync_full_sweep_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sweep_runs_select_own"
  ON public.sync_full_sweep_runs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_sweep_runs_user_started
  ON public.sync_full_sweep_runs (user_id, started_at DESC);

-- 3. Reconciliación única de los datos actuales.
SELECT public.reconcile_detected_processes(NULL);