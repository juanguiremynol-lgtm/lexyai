-- Iter26 parity: the email-borne actuación was the last writer still minting
-- its own md5 identity. One formula, one place.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='apply_email_evidence_effects';
  d := replace(d,
    'md5(''EMAIL_ACT:'' || COALESCE(l.internet_message_id, l.id::text))',
    'public.canon_act_fingerprint(l.work_item_id, v_trigger, v_marker || '' — '' || COALESCE(l.subject,''(sin asunto)''), NULL)');
  EXECUTE d;
END $$;

-- One-time restamp of the single live row minted under the old formula.
ALTER TABLE public.work_item_acts DISABLE TRIGGER USER;
UPDATE public.work_item_acts a
   SET hash_fingerprint = public.canon_act_fingerprint(a.work_item_id, a.act_date, a.description, a.raw_data->>'parte')
 WHERE a.is_archived = false
   AND a.source = 'email'
   AND a.hash_fingerprint IS DISTINCT FROM
       public.canon_act_fingerprint(a.work_item_id, a.act_date, a.description, a.raw_data->>'parte');
ALTER TABLE public.work_item_acts ENABLE TRIGGER USER;