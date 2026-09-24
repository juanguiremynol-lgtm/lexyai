DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.alert_lifecycle_maintenance'::regproc);
  src := replace(src, 'SET status = ''EXPIRED'', dismissed_at', 'SET status = ''DISMISSED'', dismissed_at');
  EXECUTE src;
END
$do$;