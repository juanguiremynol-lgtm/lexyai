-- Shared, fenced circuit for one public provider. No judicial data is changed.
CREATE TABLE IF NOT EXISTS public.public_provider_breakers (
  provider text PRIMARY KEY,
  generation bigint NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'CLOSED' CHECK (state IN ('CLOSED','OPEN','PROBE')),
  consecutive_transient integer NOT NULL DEFAULT 0,
  retry_at timestamptz,
  probe_token uuid,
  probe_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.public_provider_breakers FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.acquire_samai_estados_breaker()
RETURNS TABLE(allowed boolean, generation bigint, probe_token uuid, retry_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.public_provider_breakers%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 INSERT INTO public.public_provider_breakers(provider) VALUES('samai_estados') ON CONFLICT DO NOTHING;
 SELECT * INTO b FROM public.public_provider_breakers WHERE provider='samai_estados' FOR UPDATE;
 IF b.state='CLOSED' THEN RETURN QUERY SELECT true,b.generation,NULL::uuid,NULL::timestamptz; RETURN; END IF;
 IF b.state='OPEN' AND b.retry_at>now() THEN RETURN QUERY SELECT false,b.generation,NULL::uuid,b.retry_at; RETURN; END IF;
 IF b.state='PROBE' AND b.probe_expires_at>now() THEN RETURN QUERY SELECT false,b.generation,NULL::uuid,b.probe_expires_at; RETURN; END IF;
 UPDATE public.public_provider_breakers SET state='PROBE',generation=b.generation+1,
  probe_token=gen_random_uuid(),probe_expires_at=now()+interval '130 seconds',updated_at=now()
 WHERE provider='samai_estados' RETURNING * INTO b;
 RETURN QUERY SELECT true,b.generation,b.probe_token,b.probe_expires_at;
END $$;

CREATE OR REPLACE FUNCTION public.finish_samai_estados_breaker(_generation bigint,_probe_token uuid,_outcome text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.public_provider_breakers%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 IF _outcome NOT IN ('VALID_RESPONSE','TRANSIENT_FAILURE','OTHER_FAILURE') THEN RAISE EXCEPTION 'invalid outcome'; END IF;
 SELECT * INTO b FROM public.public_provider_breakers WHERE provider='samai_estados' FOR UPDATE;
 IF NOT FOUND OR b.generation<>_generation THEN RETURN false; END IF;
 IF b.state='PROBE' THEN
  IF b.probe_token IS DISTINCT FROM _probe_token OR b.probe_expires_at<=now() THEN RETURN false; END IF;
  IF _outcome='VALID_RESPONSE' THEN
   UPDATE public.public_provider_breakers SET state='CLOSED',generation=generation+1,consecutive_transient=0,
    retry_at=NULL,probe_token=NULL,probe_expires_at=NULL,updated_at=now() WHERE provider='samai_estados';
  ELSIF _outcome='TRANSIENT_FAILURE' THEN
   UPDATE public.public_provider_breakers SET state='OPEN',generation=generation+1,
    retry_at=now()+interval '15 minutes',probe_token=NULL,probe_expires_at=NULL,updated_at=now() WHERE provider='samai_estados';
  ELSE
   -- Inconclusive probe: preserve the established circuit briefly without
   -- claiming that a timeout or case error proves another session rejection.
   UPDATE public.public_provider_breakers SET state='OPEN',generation=generation+1,
    retry_at=now()+interval '130 seconds',probe_token=NULL,probe_expires_at=NULL,updated_at=now() WHERE provider='samai_estados';
  END IF;
  RETURN true;
 END IF;
 IF b.state<>'CLOSED' OR _probe_token IS NOT NULL THEN RETURN false; END IF;
 IF _outcome='VALID_RESPONSE' THEN
  UPDATE public.public_provider_breakers SET consecutive_transient=0,updated_at=now() WHERE provider='samai_estados';
 ELSIF _outcome='TRANSIENT_FAILURE' THEN
  UPDATE public.public_provider_breakers SET consecutive_transient=consecutive_transient+1,
   state=CASE WHEN consecutive_transient+1>=2 THEN 'OPEN' ELSE 'CLOSED' END,
   generation=CASE WHEN consecutive_transient+1>=2 THEN generation+1 ELSE generation END,
   retry_at=CASE WHEN consecutive_transient+1>=2 THEN now()+interval '15 minutes' ELSE NULL END,
   updated_at=now() WHERE provider='samai_estados';
 END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.peek_samai_estados_breaker()
RETURNS TABLE(paused boolean,retry_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT CASE WHEN b.state='OPEN' THEN b.retry_at>now()
  WHEN b.state='PROBE' THEN b.probe_expires_at>now() ELSE false END,
  CASE WHEN b.state='OPEN' THEN b.retry_at WHEN b.state='PROBE' THEN b.probe_expires_at ELSE NULL END
 FROM public.public_provider_breakers b WHERE b.provider='samai_estados';
END $$;

-- If a claim raced with opening the breaker, return it without consuming an
-- attempt. The lease token fences a late worker after reclamation.
CREATE OR REPLACE FUNCTION public.defer_public_monitor_for_breaker(_run_id uuid,_work_item_id uuid,_lease_token uuid,_retry_at timestamptz,_error_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 IF _error_code NOT IN ('PROVIDER_BREAKER_OPEN','PROVIDER_BREAKER_UNAVAILABLE','PROVIDER_BREAKER_LEASE_LOST') THEN RAISE EXCEPTION 'invalid breaker error'; END IF;
 UPDATE public.estados_monitor_run_items SET status='PENDING',attempts=greatest(attempts-1,0),
  claimed_at=NULL,lease_token=NULL,next_attempt_at=greatest(now()+interval '5 seconds',least(_retry_at,now()+interval '30 minutes')),
  error_code=_error_code
 WHERE run_id=_run_id AND work_item_id=_work_item_id AND status='CLAIMED' AND lease_token=_lease_token;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;

REVOKE ALL ON FUNCTION public.acquire_samai_estados_breaker() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_samai_estados_breaker(bigint,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.peek_samai_estados_breaker() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_public_monitor_for_breaker(uuid,uuid,uuid,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_samai_estados_breaker() TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_samai_estados_breaker(bigint,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.peek_samai_estados_breaker() TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_public_monitor_for_breaker(uuid,uuid,uuid,timestamptz,text) TO service_role;
