-- ============================================================
-- ITERATION 10 — DRAIN + REGENERATE (reversible)
-- ============================================================

CREATE TABLE IF NOT EXISTS public._iter10_alert_purge_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase text NOT NULL,
  alert_type text,
  severity text,
  count int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public._iter10_alert_purge_report TO authenticated;
GRANT ALL ON public._iter10_alert_purge_report TO service_role;
ALTER TABLE public._iter10_alert_purge_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Platform admins read iter10 purge report" ON public._iter10_alert_purge_report;
CREATE POLICY "Platform admins read iter10 purge report"
  ON public._iter10_alert_purge_report FOR SELECT TO authenticated
  USING (public.is_platform_admin_check(auth.uid()));

-- BEFORE snapshot
INSERT INTO public._iter10_alert_purge_report (phase, alert_type, severity, count)
SELECT 'BEFORE', alert_type, severity, count(*)
  FROM public.alert_instances
 WHERE status IN ('PENDING','SENT','ACKNOWLEDGED')
 GROUP BY alert_type, severity;

-- 1. Promote genuinely adverse recent actuación alerts to the doctrine type
UPDATE public.alert_instances
   SET alert_type = 'ACTUACION_CRITICA'
 WHERE status IN ('PENDING','SENT','ACKNOWLEDGED')
   AND alert_type IN ('ACTUACION_NUEVA','ACTUACION_MODIFIED','SYSTEM_UNTYPED')
   AND severity IN ('WARNING','CRITICAL')
   AND fired_at > now() - interval '15 days'
   AND public.is_adverse_or_term_opening_text(
         COALESCE(title,'') || ' ' || COALESCE(message,'') || ' '
         || COALESCE(payload->>'description',''));

-- 2. Drain everything that is not doctrine-actionable and live
UPDATE public.alert_instances a
   SET status = 'DISMISSED',
       dismissed_at = now(),
       read_at = COALESCE(read_at, now()),
       seen_at = COALESCE(seen_at, now()),
       dismissal_reason = 'PURGA_ITER10'
 WHERE a.status IN ('PENDING','SENT','ACKNOWLEDGED')
   AND NOT (
     a.alert_type IN ('TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO',
                      'ACTUACION_RETROACTIVA','ACTUACION_CRITICA',
                      'HEARING_TODAY','HEARING_UPCOMING',
                      'MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR',
                      'SUGERENCIA_PENDIENTE','LEXY_DAILY','INGESTA_MASIVA')
     AND a.fired_at > now() - interval '15 days'
     AND CASE
       WHEN a.alert_type IN ('TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO') THEN
         a.payload->>'deadline_id' IS NULL OR EXISTS (
           SELECT 1 FROM public.work_item_deadlines d
            WHERE d.id = (a.payload->>'deadline_id')::uuid AND d.status = 'PENDING')
       WHEN a.alert_type IN ('HEARING_TODAY','HEARING_UPCOMING') THEN
         EXISTS (SELECT 1 FROM public.hearings h
                  WHERE h.id = NULLIF(a.payload->>'hearing_id','')::uuid
                    AND h.deleted_at IS NULL
                    AND h.scheduled_at >= date_trunc('day', now() AT TIME ZONE 'America/Bogota'))
       WHEN a.alert_type = 'SUGERENCIA_PENDIENTE' THEN
         EXISTS (SELECT 1 FROM public.work_item_stage_suggestions s
                  WHERE s.work_item_id = a.entity_id AND s.status = 'PENDING')
       ELSE true
     END
   );

-- 3. Rebuild the board from current reality
SELECT public.alert_lifecycle_maintenance();
SELECT public.regenerate_doctrine_alerts();

-- AFTER snapshot
INSERT INTO public._iter10_alert_purge_report (phase, alert_type, severity, count)
SELECT 'AFTER', alert_type, severity, count(*)
  FROM public.alert_instances
 WHERE status IN ('PENDING','SENT','ACKNOWLEDGED')
 GROUP BY alert_type, severity;