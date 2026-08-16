-- ITER59 — one work item, two provider streams (base-21 identity, 23-digit key)

ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS source_radicado text,
  ADD COLUMN IF NOT EXISTS recurso_consecutivo text,
  ADD COLUMN IF NOT EXISTS instancia_grado text;

ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS source_radicado text,
  ADD COLUMN IF NOT EXISTS recurso_consecutivo text,
  ADD COLUMN IF NOT EXISTS instancia_grado text;

COMMENT ON COLUMN public.work_item_acts.recurso_consecutivo IS
  'ITER59 — last two digits of the 23-digit radicacion: 00 origin file, 01+ recurso. The 21-digit base is the process identity (iteration 4.2).';

-- ── identity helpers (SQL mirror of _shared/recursoStreams.ts) ──
CREATE OR REPLACE FUNCTION public.radicado_base21(p_rad text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN length(regexp_replace(COALESCE(p_rad,''), '\D', '', 'g')) IN (21,23)
              THEN left(regexp_replace(p_rad, '\D', '', 'g'), 21) END
$$;

CREATE OR REPLACE FUNCTION public.radicado_consecutivo(p_rad text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN length(regexp_replace(COALESCE(p_rad,''), '\D', '', 'g')) = 23
              THEN substr(regexp_replace(p_rad, '\D', '', 'g'), 22, 2) END
$$;

CREATE OR REPLACE FUNCTION public.radicado_instancia_grado(p_rad text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN COALESCE(public.radicado_consecutivo(p_rad),'00') = '00'
              THEN 'PRIMERA' ELSE 'SEGUNDA' END
$$;

-- Merge key: a recurso stream resolves to the work item holding the same base-21.
CREATE OR REPLACE FUNCTION public.work_item_id_for_radicacion(p_rad text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT w.id FROM public.work_items w
   WHERE w.deleted_at IS NULL
     AND public.radicado_base21(w.radicado) IS NOT NULL
     AND public.radicado_base21(w.radicado) = public.radicado_base21(p_rad)
   ORDER BY (COALESCE(public.radicado_consecutivo(w.radicado),'00') = '00') DESC, w.created_at
   LIMIT 1
$$;

-- ── backfill: everything we hold today came from the origin stream ──
UPDATE public.work_item_acts a
   SET source_radicado = w.radicado,
       recurso_consecutivo = COALESCE(public.radicado_consecutivo(w.radicado), '00'),
       instancia_grado = public.radicado_instancia_grado(w.radicado)
  FROM public.work_items w
 WHERE w.id = a.work_item_id AND a.source_radicado IS NULL;

UPDATE public.work_item_publicaciones p
   SET source_radicado = w.radicado,
       recurso_consecutivo = COALESCE(public.radicado_consecutivo(w.radicado), '00'),
       instancia_grado = public.radicado_instancia_grado(w.radicado)
  FROM public.work_items w
 WHERE w.id = p.work_item_id AND p.source_radicado IS NULL;

ALTER TABLE public.work_item_acts
  ADD CONSTRAINT work_item_acts_instancia_grado_chk
  CHECK (instancia_grado IS NULL OR instancia_grado IN ('PRIMERA','SEGUNDA')) NOT VALID;
ALTER TABLE public.work_item_publicaciones
  ADD CONSTRAINT work_item_pubs_instancia_grado_chk
  CHECK (instancia_grado IS NULL OR instancia_grado IN ('PRIMERA','SEGUNDA')) NOT VALID;

-- ── fingerprints: the recurso consecutivo discriminates ONLY when non-00 ──
DROP FUNCTION IF EXISTS public.canon_act_fingerprint(uuid, date, text, text);
CREATE FUNCTION public.canon_act_fingerprint(
  p_work_item_id uuid, p_act_date date, p_raw_title text, p_party_hint text,
  p_recurso text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public','pg_temp' AS $function$
DECLARE wi_short text; date_str text; v_title text; v_party text; v_suffix text; v_rec text; v_payload text;
BEGIN
  wi_short := COALESCE(left(p_work_item_id::text, 8), 'noscope');
  date_str := public.canon_normalize_date(p_act_date::text);
  v_title := public.canon_normalize_title(public.canon_strip_title_noise(p_raw_title));
  v_party := public.canon_extract_party(NULL, p_party_hint);
  v_suffix := CASE WHEN v_party = '' THEN '' ELSE '|p:'||v_party END;
  v_rec := CASE WHEN COALESCE(lpad(NULLIF(p_recurso,''),2,'0'),'00') = '00' THEN ''
                ELSE '|r:'||lpad(p_recurso,2,'0') END;
  v_payload := 'act|'||wi_short||'|'||date_str||'|'||v_title||v_suffix||v_rec;
  RETURN 'wi_'||wi_short||'_'||public.canon_simple_hash(v_payload);
END; $function$;

DROP FUNCTION IF EXISTS public.canon_pub_fingerprint(uuid, text, text, text, text);
CREATE FUNCTION public.canon_pub_fingerprint(
  p_work_item_id uuid, p_pub_date text, p_tipo text, p_raw_title text, p_party_hint text,
  p_recurso text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public','pg_temp' AS $function$
DECLARE wi_short text; date_str text; v_title text; v_party text; v_suffix text; v_rec text; v_payload text;
BEGIN
  wi_short := COALESCE(left(p_work_item_id::text, 8), 'noscope');
  date_str := public.canon_normalize_date(p_pub_date);
  v_title := public.canon_normalize_title(public.canon_strip_title_noise(p_raw_title));
  v_party := public.canon_extract_party(NULL, p_party_hint);
  v_suffix := CASE WHEN v_party = '' THEN '' ELSE '|p:'||v_party END;
  v_rec := CASE WHEN COALESCE(lpad(NULLIF(p_recurso,''),2,'0'),'00') = '00' THEN ''
                ELSE '|r:'||lpad(p_recurso,2,'0') END;
  v_payload := 'pub|'||wi_short||'|'||date_str||'|'||v_title||v_suffix||v_rec;
  RETURN 'pub_'||wi_short||'_'||public.canon_simple_hash(v_payload);
END; $function$;

-- ── structural dedupe must not collapse two courts' identical titles ──
DROP INDEX IF EXISTS public.idx_acts_dedupe_structural;
CREATE UNIQUE INDEX idx_acts_dedupe_structural ON public.work_item_acts
  (work_item_id,
   canon_normalize_title(canon_strip_title_noise(description)),
   act_date,
   canon_extract_party(NULL::text, (raw_data ->> 'parte'::text)),
   COALESCE(recurso_consecutivo, '00'))
  WHERE (is_archived = false);

DROP INDEX IF EXISTS public.idx_pubs_dedupe_structural;
CREATE UNIQUE INDEX idx_pubs_dedupe_structural ON public.work_item_publicaciones
  (work_item_id,
   canon_normalize_title(canon_strip_title_noise(title)),
   COALESCE(((published_at AT TIME ZONE 'UTC'::text))::date, '1900-01-01'::date),
   canon_extract_party(title, (raw_data ->> 'parte'::text)),
   COALESCE(recurso_consecutivo, '00'))
  WHERE (is_archived = false);

CREATE INDEX IF NOT EXISTS idx_acts_instancia ON public.work_item_acts (work_item_id, instancia_grado);
CREATE INDEX IF NOT EXISTS idx_pubs_instancia ON public.work_item_publicaciones (work_item_id, instancia_grado);

-- ── persistence RPCs carry the stream columns ──
DO $$
DECLARE d text; n int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace
   WHERE n2.nspname='public' AND p.proname='rpc_upsert_work_item_acts';

  n := (length(d) - length(replace(d, 'fecha_registro_source, inicia_termino,', ''))) / length('fecha_registro_source, inicia_termino,');
  IF n <> 1 THEN RAISE EXCEPTION 'acts column-list anchor found % times', n; END IF;
  d := replace(d, 'fecha_registro_source, inicia_termino,',
                  'fecha_registro_source, inicia_termino, source_radicado, recurso_consecutivo, instancia_grado,');

  n := (length(d) - length(replace(d, 'v_incoming_inicia_termino,
            now(), now(), v_content_hash', ''))) / length('v_incoming_inicia_termino,
            now(), now(), v_content_hash');
  IF n <> 1 THEN RAISE EXCEPTION 'acts values anchor found % times', n; END IF;
  d := replace(d, 'v_incoming_inicia_termino,
            now(), now(), v_content_hash',
    'v_incoming_inicia_termino,
            NULLIF(rec->>''source_radicado'',''''),
            COALESCE(NULLIF(rec->>''recurso_consecutivo'',''''),''00''),
            COALESCE(NULLIF(rec->>''instancia_grado'',''''),''PRIMERA''),
            now(), now(), v_content_hash');
  EXECUTE d;

  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace
   WHERE n2.nspname='public' AND p.proname='rpc_upsert_work_item_publicaciones';

  d := replace(d, 'date_confidence, raw_schema_version, sources, detected_at, last_seen_at, content_hash',
                  'date_confidence, raw_schema_version, sources, detected_at, last_seen_at, content_hash, source_radicado, recurso_consecutivo, instancia_grado');
  d := replace(d, 'now(), now(), v_content_hash
        );',
    'now(), now(), v_content_hash,
          NULLIF(rec->>''source_radicado'',''''),
          COALESCE(NULLIF(rec->>''recurso_consecutivo'',''''),''00''),
          COALESCE(NULLIF(rec->>''instancia_grado'',''''),''PRIMERA'')
        );');
  d := replace(d, 'AND canon_normalize_title(COALESCE(tipo_publicacion, '''')) = canon_normalize_title(COALESCE(rec->>''tipo_publicacion'', ''''))',
                  'AND canon_normalize_title(COALESCE(tipo_publicacion, '''')) = canon_normalize_title(COALESCE(rec->>''tipo_publicacion'', ''''))
          AND COALESCE(recurso_consecutivo,''00'') = COALESCE(NULLIF(rec->>''recurso_consecutivo'',''''),''00'')');
  IF d NOT LIKE '%source_radicado%' THEN RAISE EXCEPTION 'pubs rpc patch did not apply'; END IF;
  EXECUTE d;
END $$;

-- ── ITER58 detector retires itself once the recurso stream flows ──
CREATE OR REPLACE FUNCTION public.work_item_appellate_blindspot(p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  w public.work_items%ROWTYPE;
  v_provider text;
  v_date date; v_desc text; v_act uuid;
  v_pubs_after int := 0; v_acts_after int := 0;
  v_segunda_acts int := 0; v_segunda_pubs int := 0;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(w.lifecycle_state::text,'ACTIVE') <> 'ACTIVE' THEN RETURN NULL; END IF;

  v_provider := public.estados_provider_for_workflow(w.workflow_type::text);

  SELECT a.id, COALESCE(a.act_date,a.event_date), left(COALESCE(a.description,''),200)
    INTO v_act, v_date, v_desc
    FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id
     AND a.is_archived IS NOT TRUE
     AND public.act_is_apelacion_concedida(a.description, a.act_type)
     AND COALESCE(a.act_date,a.event_date) IS NOT NULL
   ORDER BY COALESCE(a.act_date,a.event_date) DESC
   LIMIT 1;

  IF v_date IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_pubs_after
    FROM public.work_item_publicaciones p
   WHERE p.work_item_id = p_work_item_id
     AND p.is_archived IS NOT TRUE
     AND public.pub_matches_provider(p.source, v_provider)
     AND COALESCE(p.fecha_fijacion::date, p.published_at::date) >= v_date;

  SELECT count(*) INTO v_acts_after
    FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id
     AND a.is_archived IS NOT TRUE
     AND COALESCE(a.act_date,a.event_date) > v_date;

  -- ITER59 — activity from the recurso stream IS the second instance made
  -- visible. The alert must retire itself, not keep firing on a matter we see.
  SELECT count(*) INTO v_segunda_acts
    FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id AND a.is_archived IS NOT TRUE
     AND COALESCE(a.instancia_grado,'PRIMERA') = 'SEGUNDA';
  SELECT count(*) INTO v_segunda_pubs
    FROM public.work_item_publicaciones p
   WHERE p.work_item_id = p_work_item_id AND p.is_archived IS NOT TRUE
     AND COALESCE(p.instancia_grado,'PRIMERA') = 'SEGUNDA';

  RETURN jsonb_build_object(
    'work_item_id', p_work_item_id,
    'organization_id', w.organization_id,
    'owner_id', w.owner_id,
    'radicado', w.radicado,
    'despacho_origen', w.authority_name,
    'workflow_type', w.workflow_type::text,
    'estados_provider', v_provider,
    'apelacion_act_id', v_act,
    'apelacion_date', v_date,
    'apelacion_description', v_desc,
    'dias_sin_estados', (CURRENT_DATE - v_date),
    'pubs_after', v_pubs_after,
    'acts_after', v_acts_after,
    'segunda_instancia_acts', v_segunda_acts,
    'segunda_instancia_pubs', v_segunda_pubs,
    'segunda_instancia_visible', (v_segunda_acts + v_segunda_pubs) > 0,
    'blindspot', (v_pubs_after = 0 AND (v_segunda_acts + v_segunda_pubs) = 0 AND (CURRENT_DATE - v_date) >= 15)
  );
END;
$function$;