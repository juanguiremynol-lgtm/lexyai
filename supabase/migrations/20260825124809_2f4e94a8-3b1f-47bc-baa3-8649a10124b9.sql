REVOKE ALL ON FUNCTION public.detect_stale_monitoring(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_stale_monitoring(integer) TO service_role;

REVOKE ALL ON FUNCTION public.supersede_work_item_alerts_on_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_work_item_alerts_on_delete() TO service_role;

REVOKE ALL ON FUNCTION public.alert_lifecycle_maintenance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_lifecycle_maintenance() TO service_role;