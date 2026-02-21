
-- 1) Trigger function that rejects UPDATE/DELETE for ALL roles
CREATE OR REPLACE FUNCTION public.prevent_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'document_signature_events is append-only; % is not permitted', tg_op
    USING ERRCODE = '42501';
END;
$$;

-- 2) Attach trigger
DROP TRIGGER IF EXISTS trg_prevent_event_mutation ON public.document_signature_events;

CREATE TRIGGER trg_prevent_event_mutation
BEFORE UPDATE OR DELETE ON public.document_signature_events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_event_mutation();

-- 3) ENABLE ALWAYS so it cannot be bypassed
ALTER TABLE public.document_signature_events
ENABLE ALWAYS TRIGGER trg_prevent_event_mutation;
