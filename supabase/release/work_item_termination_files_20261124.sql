-- Extends the existing due-only maintenance window instead of scheduling another job.
DO $release$
DECLARE
  v_job bigint;
  v_command text;
  v_condition text := 'WHERE EXISTS (SELECT 1 FROM public.judicial_reparto_pdf_purges)';
BEGIN
  SELECT jobid, command INTO STRICT v_job, v_command FROM cron.job
    WHERE jobname = 'judicial-reparto-pdf-retry' AND active;
  IF strpos(v_command, 'import-judicial-reparto?maintenance=purge-pdfs') = 0
     OR strpos(v_command, v_condition) = 0 THEN
    RAISE EXCEPTION 'El programador de comprobantes no coincide con la ruta esperada';
  END IF;
  IF strpos(v_command, 'public.work_item_termination_files') = 0 THEN
    PERFORM cron.alter_job(v_job, command := replace(
      v_command, v_condition, v_condition || ' OR EXISTS (SELECT 1 FROM public.work_item_termination_files)'
    ));
  END IF;
END;
$release$;
