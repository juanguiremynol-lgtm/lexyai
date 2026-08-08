-- ITERATION 47.1 — the CHECK was the stale side, not the write.
--
-- Two constraints coexisted: `work_items_detail_exposure_chk` (iteration 45's
-- neutral vocabulary: DESCONOCIDO / DETALLE_EXPUESTO / DETALLE_NO_EXPUESTO) and
-- `work_items_provider_detail_exposure_chk` (iteration 46's provider-stated
-- vocabulary: DESCONOCIDO / DETALLE_EXPUESTO / PROCESO_PRIVADO). Their
-- INTERSECTION admitted neither of the two private terms, so every private
-- matter was unwritable.
--
-- The ruling: iteration 46 superseded iteration 45's naming, on the evidence
-- that the portal names the condition itself ("--- [ PROCESO PRIVADO ] ---").
-- The older guard therefore encodes a decision that a later one replaced. This
-- is a RETIREMENT of a superseded vocabulary, not a widening of a guard: the
-- set of admissible values does not grow, it moves. DETALLE_NO_EXPUESTO is
-- retired OUTRIGHT — not writable and not readable — because no row holds it.

-- 1. Migrate any row still on the retired term (expected: 0).
UPDATE public.work_items
   SET provider_detail_exposure = 'PROCESO_PRIVADO'
 WHERE provider_detail_exposure = 'DETALLE_NO_EXPUESTO';

-- 2. Drop the superseded guard. The iteration-46 guard remains and is the only
--    one, so the admissible set stays exactly three values.
ALTER TABLE public.work_items DROP CONSTRAINT IF EXISTS work_items_detail_exposure_chk;

-- 3. Fix the writer.
--    (a) `desde` marks when the CURRENT state began. Entering a state stamps
--        it; a re-verification refreshes `ultima_verificacion` and leaves
--        `desde` untouched. Previously DETALLE_EXPUESTO force-nulled it, which
--        is why the column was null on every row.
--    (b) the history insert named columns that DO NOT EXIST
--        (estado_anterior / estado_nuevo / observado_en). Every state change
--        would have raised an error the moment private matters became
--        writable — a latent failure hidden behind the constraint.
CREATE OR REPLACE FUNCTION public.apply_detalle_exposicion(
  p_work_item_id uuid,
  p_expuesto boolean,
  p_concluyente boolean DEFAULT true,
  p_motivo text DEFAULT NULL::text,
  p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_ultima_verificacion timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_ttl_days integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  w public.work_items%ROWTYPE;
  v_new text;
  v_changed boolean;
  v_desde timestamptz;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'work_item_not_found');
  END IF;

  -- A non-conclusive read may never assert a state: a failed read is not an answer.
  IF NOT p_concluyente THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lectura_no_concluyente',
                              'state', w.provider_detail_exposure);
  END IF;

  v_new := CASE WHEN p_expuesto THEN 'DETALLE_EXPUESTO' ELSE 'PROCESO_PRIVADO' END;
  v_changed := COALESCE(w.provider_detail_exposure, 'DESCONOCIDO') <> v_new;

  -- Only a CHANGE moves `desde`. On a change we prefer the provider's own start
  -- date when it gives one, falling back to now(). On a re-verification we keep
  -- what we already hold — including NULL, which honestly means "we know it is
  -- in this state but not since when".
  IF v_changed THEN
    v_desde := COALESCE(p_desde, now());
  ELSE
    v_desde := COALESCE(w.provider_detail_desde, p_desde);
  END IF;

  UPDATE public.work_items
     SET provider_detail_exposure = v_new,
         provider_detail_reason = CASE WHEN v_new = 'PROCESO_PRIVADO'
                                       THEN COALESCE(p_motivo, 'PROCESO_PRIVADO') ELSE NULL END,
         provider_detail_observed_at = now(),
         provider_detail_desde = v_desde,
         provider_detail_ultima_verificacion = COALESCE(p_ultima_verificacion, now()),
         provider_detail_ttl_days = COALESCE(p_ttl_days, w.provider_detail_ttl_days, 1)
   WHERE id = p_work_item_id;

  IF v_changed THEN
    INSERT INTO public.work_item_detalle_exposicion_historial
      (work_item_id, organization_id, radicado, evento, motivo, ocurrido_en, procedencia)
    VALUES (
      p_work_item_id,
      w.organization_id,
      w.radicado,
      v_new,
      p_motivo,
      COALESCE(v_desde, now()),
      jsonb_build_object(
        'estado_anterior', COALESCE(w.provider_detail_exposure, 'DESCONOCIDO'),
        'estado_nuevo', v_new,
        'fuente', 'apply_detalle_exposicion'
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', v_new, 'changed', v_changed,
                            'desde', v_desde);
END;
$function$;

-- 4. Record refused bulk flips. A single provider read that would flip a large
--    fraction of the portfolio is a contract misunderstanding until proven
--    otherwise, and the refusal must be visible rather than silent.
CREATE TABLE IF NOT EXISTS public.provider_bulk_flip_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_key text NOT NULL,
  field text NOT NULL,
  target_state text NOT NULL,
  affected_rows integer NOT NULL,
  total_rows integer NOT NULL,
  fraction numeric NOT NULL,
  threshold numeric NOT NULL,
  sample jsonb,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_bulk_flip_blocks TO authenticated;
GRANT ALL ON public.provider_bulk_flip_blocks TO service_role;

ALTER TABLE public.provider_bulk_flip_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read bulk flip blocks"
  ON public.provider_bulk_flip_blocks
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

CREATE TRIGGER update_provider_bulk_flip_blocks_updated_at
  BEFORE UPDATE ON public.provider_bulk_flip_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();