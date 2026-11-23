-- Apply after import-judicial-reparto is deployed. The manual purge already
-- removes files synchronously. This runs only for a durable pending receipt.
DO $release$
BEGIN
  IF to_regclass('public.judicial_reparto_pdf_purges') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración de comprobantes de reparto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CRON_SERVICE_KEY') THEN
    RAISE EXCEPTION 'Faltan las credenciales técnicas existentes del programador';
  END IF;
  PERFORM cron.schedule('judicial-reparto-pdf-retry', '25 16 * * *', $job$
    SELECT net.http_post(
      url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1), '/')
        || '/functions/v1/import-judicial-reparto?maintenance=purge-pdfs',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SERVICE_KEY' LIMIT 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    )
    WHERE EXISTS (SELECT 1 FROM public.judicial_reparto_pdf_purges);
  $job$);
END;
$release$;
