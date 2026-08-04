-- =====================================================================
-- ITERATION 13
-- 1) Legacy table disambiguation
-- 2) Publicaciones per-row persistence bucket ledger
-- 3) Discovery classification fix (historical = sweep AND pre-enrollment)
--    + anexos counter for Icarus/Andromeda reconciliation
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) LEGACY TABLE
-- Verified: all 599 rows of public.actuaciones are represented in
-- public.work_item_acts (match by work_item_id + normalized text).
-- No data is deleted; the table is frozen and dropped from the API surface.
-- ---------------------------------------------------------------------
ALTER TABLE IF EXISTS public.actuaciones RENAME TO actuaciones_legacy_20260131;

COMMENT ON TABLE public.actuaciones_legacy_20260131 IS
  'FROZEN 2026-01-31. Superseded by public.work_item_acts (single canonical actuaciones table). Read-only historical copy: last write 2026-01-31, 599 rows, all represented in work_item_acts. DO NOT read from this table in application code, RPCs, reports or audits.';

COMMENT ON TABLE public.work_item_acts IS
  'CANONICAL actuaciones table. Single source of truth for judicial acts (all workflow types). The legacy table public.actuaciones_legacy_20260131 is frozen and must never be queried.';

COMMENT ON TABLE public.work_item_publicaciones IS
  'CANONICAL estados/publicaciones table. Legally binding court notifications. Never mixed with work_item_acts.';

REVOKE ALL ON public.actuaciones_legacy_20260131 FROM anon;
REVOKE ALL ON public.actuaciones_legacy_20260131 FROM authenticated;
GRANT ALL ON public.actuaciones_legacy_20260131 TO service_role;

-- ---------------------------------------------------------------------
-- 3a) DISCOVERY CLASSIFICATION
-- Iteration 8.2 rule: HISTORICO_DETECTADO requires BOTH an explicit sweep
-- run AND a legal date earlier than the work item's enrollment date.
-- Anything else detected in a daily run is news.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.classify_discovery(
  p_legal_date date,
  p_detected_at timestamptz,
  p_run_mode text,
  p_enrolled_on date
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_sweep boolean := COALESCE(upper(p_run_mode), 'DAILY') IN ('SWEEP', 'FULL_SWEEP', 'HISTORICAL', 'BACKFILL', 'IMPORT');
  v_recent boolean;
  v_pre_enrollment boolean;
BEGIN
  v_recent := p_legal_date IS NOT NULL AND NOT public.is_historico_by_legal_date(p_legal_date);
  IF v_recent THEN
    RETURN 'NOVEDAD';
  END IF;

  -- A row with no legal date at all cannot be proven historical.
  IF p_legal_date IS NULL THEN
    RETURN CASE WHEN v_sweep THEN 'HISTORICO_DETECTADO' ELSE 'NOVEDAD' END;
  END IF;

  v_pre_enrollment := p_enrolled_on IS NOT NULL AND p_legal_date < p_enrolled_on;

  IF v_sweep AND v_pre_enrollment THEN
    RETURN 'HISTORICO_DETECTADO';
  END IF;

  -- Old legal date but posterior to enrollment (or detected in a daily run):
  -- the court registered it late — that is NEWS for the lawyer.
  RETURN 'ACTUACION_RETROACTIVA';
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_act_discovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text := CASE WHEN public.is_backfill_source(NEW.source, NEW.ingest_run_mode)
                      THEN 'SWEEP' ELSE COALESCE(NEW.ingest_run_mode, 'DAILY') END;
  v_enrolled date;
BEGIN
  SELECT (created_at AT TIME ZONE 'America/Bogota')::date INTO v_enrolled
  FROM work_items WHERE id = NEW.work_item_id;

  IF NEW.discovery_type IS NULL THEN
    NEW.discovery_type := public.classify_discovery(
      NEW.act_date, COALESCE(NEW.detected_at, now()), v_mode, v_enrolled);
  END IF;
  NEW.is_retroactive := (NEW.discovery_type = 'ACTUACION_RETROACTIVA');
  IF NEW.act_date IS NOT NULL THEN
    NEW.retro_gap_days := GREATEST(0, (COALESCE(NEW.detected_at, now()) AT TIME ZONE 'America/Bogota')::date - NEW.act_date);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_pub_discovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_legal date := COALESCE(NEW.fecha_fijacion::date, NEW.fecha_desfijacion::date, NEW.published_at::date);
  v_mode text := CASE WHEN public.is_backfill_source(NEW.source, NEW.ingest_run_mode)
                      THEN 'SWEEP' ELSE COALESCE(NEW.ingest_run_mode, 'DAILY') END;
  v_enrolled date;
BEGIN
  SELECT (created_at AT TIME ZONE 'America/Bogota')::date INTO v_enrolled
  FROM work_items WHERE id = NEW.work_item_id;

  IF NEW.discovery_type IS NULL THEN
    NEW.discovery_type := public.classify_discovery(
      v_legal, COALESCE(NEW.detected_at, now()), v_mode, v_enrolled);
  END IF;
  NEW.is_retroactive := (NEW.discovery_type = 'ACTUACION_RETROACTIVA');
  IF v_legal IS NOT NULL THEN
    NEW.retro_gap_days := GREATEST(0, (COALESCE(NEW.detected_at, now()) AT TIME ZONE 'America/Bogota')::date - v_legal);
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3b) ANEXOS COUNTER — reconciles Icarus (files in the digital index)
-- with Andromeda (actuaciones). Counts attachment metadata, not rows.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_anexos_nuevos(
  p_organization_id uuid,
  p_since timestamptz
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT SUM(GREATEST(0, COALESCE((a.raw_data->>'anexos_count')::int, 0)))
       FROM work_item_acts a
      WHERE a.organization_id = p_organization_id
        AND a.detected_at >= p_since
        AND COALESCE(a.is_archived, false) = false), 0)
  + COALESCE(
    (SELECT COUNT(*)
       FROM work_item_publicaciones p
      WHERE p.organization_id = p_organization_id
        AND p.detected_at >= p_since
        AND COALESCE(p.is_archived, false) = false
        AND COALESCE(p.pdf_available, false) = true), 0);
$function$;

GRANT EXECUTE ON FUNCTION public.count_anexos_nuevos(uuid, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) PUBLICACIONES PERSISTENCE BUCKET LEDGER
-- Every parsed row lands in exactly one bucket; unique_violation is
-- captured separately; nothing vanishes silently.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_upsert_work_item_publicaciones(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec jsonb;
  parsed_count int := 0;
  inserted_count int := 0;
  skipped_count int := 0;
  updated_count int := 0;
  changed_count int := 0;
  structural_count int := 0;
  rejected_count int := 0;
  error_count int := 0;
  unique_violation_count int := 0;
  errors text[] := '{}';
  outcomes jsonb := '[]'::jsonb;
  v_content_hash text;
  v_existing record;
  v_sources text[];
  v_records jsonb;
  v_is_samai boolean;
  v_fecha_fijacion timestamptz;
  v_fecha_providencia timestamptz;
  v_published_at timestamptz;
  v_structural_date date;
  v_reason text;
  v_structural_hit boolean;
  v_enriched boolean;
BEGIN
  IF jsonb_typeof(records) = 'string' THEN
    BEGIN
      v_records := (records #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'parsed_count', 0, 'inserted_count', 0, 'updated_count', 0, 'skipped_count', 0,
        'structural_count', 0, 'rejected_count', 0, 'error_count', 1, 'unique_violation_count', 0,
        'changed_count', 0, 'errors', jsonb_build_array('records parameter is a non-parseable string: ' || SQLERRM),
        'outcomes', jsonb_build_array(jsonb_build_object('bucket','ERROR','reason',SQLERRM))
      );
    END;
  ELSIF jsonb_typeof(records) = 'object' THEN
    v_records := jsonb_build_array(records);
  ELSIF jsonb_typeof(records) = 'array' THEN
    v_records := records;
  ELSE
    RETURN jsonb_build_object(
      'parsed_count', 0, 'inserted_count', 0, 'updated_count', 0, 'skipped_count', 0,
      'structural_count', 0, 'rejected_count', 0, 'error_count', 1, 'unique_violation_count', 0,
      'changed_count', 0, 'errors', jsonb_build_array('records parameter has unexpected type: ' || jsonb_typeof(records)),
      'outcomes', jsonb_build_array(jsonb_build_object('bucket','ERROR','reason','unexpected records parameter type'))
    );
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(v_records)
  LOOP
    parsed_count := parsed_count + 1;
    v_structural_hit := false;
    v_enriched := false;
    BEGIN
      v_is_samai := (rec->>'source') = 'samai_estados';
      v_fecha_providencia := NULLIF(rec->>'fecha_providencia','')::timestamptz;
      IF v_is_samai THEN
        v_fecha_fijacion := NULL;
        IF v_fecha_providencia IS NULL THEN
          v_fecha_providencia := NULLIF(rec->>'fecha_fijacion','')::timestamptz;
        END IF;
      ELSE
        v_fecha_fijacion := NULLIF(rec->>'fecha_fijacion','')::timestamptz;
      END IF;
      v_published_at := NULLIF(rec->>'published_at','')::timestamptz;
      v_structural_date := COALESCE((v_published_at AT TIME ZONE 'UTC')::date, DATE '1900-01-01');

      v_content_hash := encode(sha256(convert_to(
        COALESCE(rec->>'fecha_fijacion', '') || '|' ||
        COALESCE(rec->>'fecha_providencia', '') || '|' ||
        COALESCE(rec->>'title', '') || '|' ||
        COALESCE(rec->>'tipo_publicacion', '') || '|' ||
        COALESCE(rec->>'pdf_url', '') || '|' ||
        COALESCE(rec->>'annotation', ''), 'UTF8')), 'hex');

      v_sources := safe_jsonb_to_text_array(rec->'sources');
      IF array_length(v_sources, 1) IS NULL AND rec->>'source' IS NOT NULL THEN
        v_sources := ARRAY[rec->>'source'];
      END IF;

      SELECT id, content_hash, pdf_url, fecha_fijacion, fecha_providencia, source, sources
      INTO v_existing
      FROM work_item_publicaciones
      WHERE work_item_id = (rec->>'work_item_id')::uuid
        AND hash_fingerprint = rec->>'hash_fingerprint';

      IF v_existing.id IS NULL THEN
        SELECT id, content_hash, pdf_url, fecha_fijacion, fecha_providencia, source, sources
        INTO v_existing
        FROM work_item_publicaciones
        WHERE work_item_id = (rec->>'work_item_id')::uuid
          AND is_archived = false
          AND canon_normalize_title(canon_strip_title_noise(title)) = canon_normalize_title(canon_strip_title_noise(rec->>'title'))
          AND COALESCE((published_at AT TIME ZONE 'UTC')::date, DATE '1900-01-01') = v_structural_date
          AND canon_normalize_title(COALESCE(tipo_publicacion, '')) = canon_normalize_title(COALESCE(rec->>'tipo_publicacion', ''))
        LIMIT 1;
        v_structural_hit := v_existing.id IS NOT NULL;
      END IF;

      IF v_existing.id IS NULL THEN
        INSERT INTO work_item_publicaciones (
          work_item_id, organization_id, source, title, annotation,
          pdf_url, entry_url, pdf_available, published_at, fecha_fijacion,
          fecha_providencia, tipo_publicacion, hash_fingerprint, raw_data, date_source,
          date_confidence, raw_schema_version, sources, detected_at, last_seen_at, content_hash
        ) VALUES (
          (rec->>'work_item_id')::uuid, (rec->>'organization_id')::uuid,
          rec->>'source', rec->>'title', rec->>'annotation', rec->>'pdf_url', rec->>'entry_url',
          COALESCE((rec->>'pdf_available')::boolean, false), v_published_at, v_fecha_fijacion,
          v_fecha_providencia, rec->>'tipo_publicacion', rec->>'hash_fingerprint', rec->'raw_data',
          rec->>'date_source', rec->>'date_confidence', rec->>'raw_schema_version', v_sources,
          now(), now(), v_content_hash
        );
        inserted_count := inserted_count + 1;
        outcomes := outcomes || jsonb_build_array(jsonb_build_object(
          'bucket','INSERTED','title',rec->>'title','fingerprint',rec->>'hash_fingerprint'));
      ELSE
        UPDATE work_item_publicaciones SET
          pdf_url = COALESCE(pdf_url, rec->>'pdf_url'),
          entry_url = COALESCE(entry_url, rec->>'entry_url'),
          annotation = COALESCE(annotation, rec->>'annotation'),
          fecha_fijacion = COALESCE(fecha_fijacion, v_fecha_fijacion),
          fecha_providencia = COALESCE(fecha_providencia, v_fecha_providencia),
          raw_data = COALESCE(rec->'raw_data', raw_data),
          sources = (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(
            COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) || v_sources) AS s),
          last_seen_at = now(), updated_at = now()
        WHERE id = v_existing.id;

        v_enriched := (v_existing.pdf_url IS NULL AND NULLIF(rec->>'pdf_url','') IS NOT NULL)
                   OR (v_existing.fecha_fijacion IS NULL AND v_fecha_fijacion IS NOT NULL)
                   OR (v_existing.fecha_providencia IS NULL AND v_fecha_providencia IS NOT NULL);

        IF COALESCE(v_existing.source,'') <> COALESCE(rec->>'source','')
           OR NOT (COALESCE(v_existing.sources, ARRAY[]::text[]) @> v_sources) THEN
          updated_count := updated_count + 1;
          v_reason := 'matched existing row from source ' || COALESCE(v_existing.source, 'unknown');
          outcomes := outcomes || jsonb_build_array(jsonb_build_object(
            'bucket','SKIPPED_CROSS_SOURCE','title',rec->>'title','fingerprint',rec->>'hash_fingerprint','reason',v_reason));
        ELSIF v_enriched THEN
          updated_count := updated_count + 1;
          outcomes := outcomes || jsonb_build_array(jsonb_build_object(
            'bucket','ENRICHED','title',rec->>'title','fingerprint',rec->>'hash_fingerprint',
            'reason','existing row completed with newly available fields'));
        ELSE
          skipped_count := skipped_count + 1;
          IF v_structural_hit THEN
            structural_count := structural_count + 1;
          END IF;
          outcomes := outcomes || jsonb_build_array(jsonb_build_object(
            'bucket', CASE WHEN v_structural_hit THEN 'SKIPPED_DUPLICATE_STRUCTURAL' ELSE 'SKIPPED_DUPLICATE' END,
            'title',rec->>'title','fingerprint',rec->>'hash_fingerprint',
            'reason','fingerprint or structural key already present'));
        END IF;
      END IF;

    EXCEPTION
      WHEN unique_violation THEN
        -- The row exists: a concurrent writer won the race. Not a loss.
        unique_violation_count := unique_violation_count + 1;
        skipped_count := skipped_count + 1;
        structural_count := structural_count + 1;
        outcomes := outcomes || jsonb_build_array(jsonb_build_object(
          'bucket','SKIPPED_DUPLICATE_STRUCTURAL','title',rec->>'title',
          'fingerprint',rec->>'hash_fingerprint','reason','unique_violation: ' || SQLERRM,
          'sqlstate',SQLSTATE));
      WHEN raise_exception THEN
        -- Explicit guard trigger rejection.
        rejected_count := rejected_count + 1;
        errors := errors || SQLERRM;
        outcomes := outcomes || jsonb_build_array(jsonb_build_object(
          'bucket','REJECTED_TRIGGER','title',rec->>'title','fingerprint',rec->>'hash_fingerprint',
          'reason',SQLERRM,'sqlstate',SQLSTATE));
      WHEN OTHERS THEN
        error_count := error_count + 1;
        errors := errors || SQLERRM;
        outcomes := outcomes || jsonb_build_array(jsonb_build_object(
          'bucket','ERROR','title',rec->>'title','fingerprint',rec->>'hash_fingerprint',
          'reason',SQLERRM,'sqlstate',SQLSTATE));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'parsed_count', parsed_count,
    'inserted_count', inserted_count,
    'updated_count', updated_count,
    'skipped_count', skipped_count,
    'structural_count', structural_count,
    'rejected_count', rejected_count,
    'error_count', error_count,
    'unique_violation_count', unique_violation_count,
    'changed_count', changed_count,
    'errors', to_jsonb(errors),
    'outcomes', outcomes
  );
END;
$function$;