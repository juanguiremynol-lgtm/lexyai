-- AUDIT FINDING 14 — the assistant read `notes`, appended in JS and wrote the
-- whole field back. Two notes written seconds apart lost one of them. The
-- append happens inside a single UPDATE statement, and it runs as the caller
-- (SECURITY INVOKER) so RLS still decides which matters can be annotated.
CREATE OR REPLACE FUNCTION public.append_work_item_note(_work_item uuid, _entry text)
RETURNS text
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  UPDATE public.work_items
     SET notes = CASE
                   WHEN coalesce(btrim(notes), '') = '' THEN _entry
                   ELSE btrim(notes) || E'\n\n' || _entry
                 END,
         updated_at = now()
   WHERE id = _work_item
   RETURNING notes;
$$;

REVOKE ALL ON FUNCTION public.append_work_item_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_work_item_note(uuid, text) TO authenticated, service_role;