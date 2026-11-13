-- Keep the attachment worker's network budget below its three-minute lease.
-- The previous command is exactly recoverable by stripping the fixed prefix
-- from net.http_post; never copy its authenticated headers into logs or Git.
DO $configure$
DECLARE
  j cron.job%rowtype; after_j cron.job%rowtype;
  before_call constant text := 'net.http_post(';
  after_call constant text := 'net.http_post(timeout_milliseconds := 90000, ';
  new_command text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('attachment-worker-cron-budget',0));
  SELECT * INTO j FROM cron.job WHERE jobname='process-estado-attachments';
  -- New databases without this optional job do not need to create one.
  IF NOT FOUND THEN RETURN; END IF;
  IF strpos(j.command,after_call)>0 THEN RETURN; END IF;
  IF j.schedule<>'*/6 * * * *' OR j.command !~ 'process-estado-attachments-queue'
      OR j.command !~ 'estado_attachment_queue' OR j.command !~ 'next_retry_at'
      OR j.command ~* 'timeout_milliseconds'
      OR array_length(string_to_array(j.command,before_call),1)<>2 THEN
    RAISE EXCEPTION 'Unexpected attachment schedule or command; refusing automatic alteration';
  END IF;
  new_command := replace(j.command,before_call,after_call);
  IF replace(new_command,after_call,before_call) IS DISTINCT FROM j.command THEN
    RAISE EXCEPTION 'Unable to recover original command exactly';
  END IF;
  PERFORM cron.alter_job(j.jobid,command=>new_command);
  SELECT * INTO STRICT after_j FROM cron.job WHERE jobid=j.jobid;
  IF to_jsonb(after_j)-'command' IS DISTINCT FROM to_jsonb(j)-'command'
      OR after_j.command IS DISTINCT FROM new_command THEN
    RAISE EXCEPTION 'Cron scheduling properties or command changed unexpectedly';
  END IF;
END $configure$;
