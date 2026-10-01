-- Hearing alerts are produced by the hearing-reminders function from the canonical
-- work_item_hearings table (status scheduled/planned, scheduled_at >= today).
-- The legacy branch here read the deprecated, empty `hearings` table: removed as duplicate.
CREATE OR REPLACE FUNCTION public.regenerate_doctrine_alerts()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sugg jsonb;
BEGIN
  PERFORM set_config('app.alert_bypass_breaker', 'on', true);
  v_sugg := public.sync_suggestion_alerts();
  PERFORM set_config('app.alert_bypass_breaker', 'off', true);
  RETURN jsonb_build_object(
    'terminos', 0, 'terminos_producer', 'evaluate-deadline-alerts',
    'audiencias', 0, 'audiencias_producer', 'hearing-reminders',
    'sugerencias', v_sugg);
END
$function$;
COMMENT ON TABLE public.hearings IS 'DEPRECATED: canonical hearings live in work_item_hearings.';