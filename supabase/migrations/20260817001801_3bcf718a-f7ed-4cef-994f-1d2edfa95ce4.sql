-- ITER63 — declared sync vocabulary + canonical multi-source representation.

CREATE TABLE IF NOT EXISTS public.sync_vocabulary (
  domain text NOT NULL,
  value text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, value)
);
GRANT SELECT ON public.sync_vocabulary TO authenticated;
GRANT ALL ON public.sync_vocabulary TO service_role;
ALTER TABLE public.sync_vocabulary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_vocabulary readable by authenticated"
  ON public.sync_vocabulary FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.sync_vocabulary_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  raw_value text NOT NULL,
  source_table text NOT NULL,
  work_item_id uuid,
  observed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sync_vocabulary_violations TO authenticated;
GRANT ALL ON public.sync_vocabulary_violations TO service_role;
ALTER TABLE public.sync_vocabulary_violations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_vocabulary_violations readable by authenticated"
  ON public.sync_vocabulary_violations FOR SELECT TO authenticated USING (true);

INSERT INTO public.sync_vocabulary(domain, value, description) VALUES
  ('provider','cpnu','CPNU (Rama Judicial) — actuaciones'),
  ('provider','samai','SAMAI (Consejo de Estado) — actuaciones'),
  ('provider','publicaciones','Publicaciones Procesales — estados'),
  ('provider','samai_estados','SAMAI Estados — estados'),
  ('provider','none','No provider was contacted (caller-side rejection)'),
  ('provider','unknown','Provider not recoverable (legacy rows only)'),
  ('status','success',''), ('status','error',''), ('status','empty',''),
  ('status','skipped',''), ('status','partial',''),
  ('status','pending_upstream',''), ('status','rejected','')
ON CONFLICT DO NOTHING;

ALTER TABLE public.work_item_sync_timeline
  ADD COLUMN IF NOT EXISTS providers text[] NOT NULL DEFAULT '{}';

-- Canonicalise a raw provider expression into a stable, sorted token array.
CREATE OR REPLACE FUNCTION public.canon_provider_tokens(_raw text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  tok text;
  out_arr text[] := '{}';
  mapped text;
BEGIN
  IF _raw IS NULL OR btrim(_raw) = '' THEN RETURN '{}'; END IF;
  FOREACH tok IN ARRAY regexp_split_to_array(lower(btrim(_raw)), '[+,/|]') LOOP
    tok := btrim(tok);
    CONTINUE WHEN tok = '';
    mapped := CASE tok
      WHEN 'pp' THEN 'publicaciones'
      WHEN 'publicaciones_procesales' THEN 'publicaciones'
      WHEN 'estados' THEN 'publicaciones'
      WHEN 'cpnu_api' THEN 'cpnu'
      WHEN 'samai_api' THEN 'samai'
      WHEN 'samaiestados' THEN 'samai_estados'
      -- ITER48: the tutelas provider never existed; its data came from CPNU.
      WHEN 'tutelas' THEN 'cpnu'
      WHEN 'tutelas_api' THEN 'cpnu'
      WHEN 'tutelas-api' THEN 'cpnu'
      ELSE tok
    END;
    IF NOT (mapped = ANY(out_arr)) THEN out_arr := out_arr || mapped; END IF;
  END LOOP;
  RETURN (SELECT coalesce(array_agg(t ORDER BY t), '{}') FROM unnest(out_arr) t);
END;
$$;

-- Trigger: canonicalise provider/providers and quarantine undeclared values.
CREATE OR REPLACE FUNCTION public.canon_sync_timeline_provider()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  toks text[];
  bad text;
BEGIN
  toks := public.canon_provider_tokens(NEW.provider);
  IF array_length(toks,1) IS NULL THEN
    toks := ARRAY['unknown'];
  END IF;

  SELECT t INTO bad FROM unnest(toks) t
  WHERE NOT EXISTS (SELECT 1 FROM public.sync_vocabulary v
                    WHERE v.domain='provider' AND v.value=t)
  LIMIT 1;

  IF bad IS NOT NULL THEN
    INSERT INTO public.sync_vocabulary_violations(domain, raw_value, source_table, work_item_id)
    VALUES ('provider', NEW.provider, 'work_item_sync_timeline', NEW.work_item_id);
    NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) || jsonb_build_object('provider_raw', NEW.provider);
    toks := ARRAY['unknown'];
    NEW.error_code := coalesce(NEW.error_code, 'PROVIDER_UNDECLARED');
  ELSIF NEW.provider IS DISTINCT FROM array_to_string(toks, '+') THEN
    NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) || jsonb_build_object('provider_raw', NEW.provider);
  END IF;

  NEW.providers := toks;
  NEW.provider := array_to_string(toks, '+');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_canon_sync_timeline_provider ON public.work_item_sync_timeline;
CREATE TRIGGER trg_canon_sync_timeline_provider
BEFORE INSERT OR UPDATE OF provider ON public.work_item_sync_timeline
FOR EACH ROW EXECUTE FUNCTION public.canon_sync_timeline_provider();

-- A row may feed provider health only when it names exactly one real provider.
CREATE OR REPLACE FUNCTION public.timeline_row_is_provider_attributable(_providers text[], _provider text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT coalesce(array_length(_providers,1),0) >= 1
     AND NOT ('unknown' = ANY(coalesce(_providers,'{}')))
     AND NOT ('none' = ANY(coalesce(_providers,'{}')));
$$;