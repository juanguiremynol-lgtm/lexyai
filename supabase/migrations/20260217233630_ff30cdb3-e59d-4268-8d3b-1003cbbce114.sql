-- Add archive and soft-delete columns to system_email_messages
ALTER TABLE public.system_email_messages
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Index for efficient filtering by folder state
CREATE INDEX IF NOT EXISTS idx_sem_archived ON public.system_email_messages (is_archived) WHERE is_archived = true;
CREATE INDEX IF NOT EXISTS idx_sem_deleted ON public.system_email_messages (deleted_at) WHERE deleted_at IS NOT NULL;

-- Auto hard-delete emails in trash older than 30 days (cron will call this)
CREATE OR REPLACE FUNCTION public.purge_trashed_emails()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.system_email_messages
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
