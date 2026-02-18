
-- ═══════════════════════════════════════════════════════════════════
-- A) RPC: Upsert actuaciones with explicit sources[] array merge
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_upsert_work_item_acts(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec jsonb;
  inserted_count int := 0;
  skipped_count int := 0;
  updated_count int := 0;
  errors text[] := '{}';
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(records)
  LOOP
    BEGIN
      INSERT INTO work_item_acts (
        owner_id, organization_id, work_item_id, workflow_type,
        description, act_date, act_date_raw, event_date, event_summary,
        source, source_platform, sources, hash_fingerprint, scrape_date,
        despacho, date_source, date_confidence, raw_schema_version, raw_data
      ) VALUES (
        (rec->>'owner_id')::uuid,
        (rec->>'organization_id')::uuid,
        (rec->>'work_item_id')::uuid,
        rec->>'workflow_type',
        rec->>'description',
        (rec->>'act_date')::date,
        rec->>'act_date_raw',
        (rec->>'event_date')::date,
        rec->>'event_summary',
        rec->>'source',
        rec->>'source_platform',
        ARRAY(SELECT jsonb_array_elements_text(rec->'sources')),
        rec->>'hash_fingerprint',
        rec->>'scrape_date',
        rec->>'despacho',
        rec->>'date_source',
        rec->>'date_confidence',
        rec->>'raw_schema_version',
        rec->'raw_data'
      )
      ON CONFLICT (work_item_id, hash_fingerprint) DO UPDATE SET
        sources = (
          SELECT array_agg(DISTINCT s ORDER BY s)
          FROM unnest(
            work_item_acts.sources || ARRAY(SELECT jsonb_array_elements_text(rec->'sources'))
          ) AS s
        ),
        scrape_date = COALESCE((rec->>'scrape_date'), work_item_acts.scrape_date),
        updated_at = now()
      WHERE NOT (
        work_item_acts.sources @> ARRAY(SELECT jsonb_array_elements_text(rec->'sources'))
      );

      IF FOUND THEN
        -- Check if it was an insert or update by seeing if xmax = 0
        -- Simple approach: if the row existed, it's an update; else insert
        IF EXISTS (
          SELECT 1 FROM work_item_acts
          WHERE work_item_id = (rec->>'work_item_id')::uuid
            AND hash_fingerprint = rec->>'hash_fingerprint'
            AND created_at < now() - interval '1 second'
        ) THEN
          updated_count := updated_count + 1;
        ELSE
          inserted_count := inserted_count + 1;
        END IF;
      ELSE
        skipped_count := skipped_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      errors := errors || SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted_count', inserted_count,
    'updated_count', updated_count,
    'skipped_count', skipped_count,
    'errors', to_jsonb(errors)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- B) RPC: Upsert publicaciones with explicit sources[] array merge
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_upsert_work_item_publicaciones(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec jsonb;
  inserted_count int := 0;
  skipped_count int := 0;
  updated_count int := 0;
  errors text[] := '{}';
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(records)
  LOOP
    BEGIN
      INSERT INTO work_item_publicaciones (
        work_item_id, organization_id, source, title, annotation,
        pdf_url, entry_url, pdf_available, published_at, fecha_fijacion,
        tipo_publicacion, hash_fingerprint, raw_data, date_source,
        date_confidence, raw_schema_version,
        sources
      ) VALUES (
        (rec->>'work_item_id')::uuid,
        (rec->>'organization_id')::uuid,
        rec->>'source',
        rec->>'title',
        rec->>'annotation',
        rec->>'pdf_url',
        rec->>'entry_url',
        COALESCE((rec->>'pdf_available')::boolean, false),
        (rec->>'published_at')::timestamptz,
        (rec->>'fecha_fijacion')::timestamptz,
        rec->>'tipo_publicacion',
        rec->>'hash_fingerprint',
        rec->'raw_data',
        rec->>'date_source',
        rec->>'date_confidence',
        rec->>'raw_schema_version',
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(rec->'sources')), ARRAY[rec->>'source'])
      )
      ON CONFLICT (work_item_id, hash_fingerprint) DO UPDATE SET
        sources = (
          SELECT array_agg(DISTINCT s ORDER BY s)
          FROM unnest(
            COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) || 
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(rec->'sources')), ARRAY[rec->>'source'])
          ) AS s
        ),
        updated_at = now()
      WHERE NOT (
        COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) @> 
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(rec->'sources')), ARRAY[rec->>'source'])
      );

      IF FOUND THEN
        IF EXISTS (
          SELECT 1 FROM work_item_publicaciones
          WHERE work_item_id = (rec->>'work_item_id')::uuid
            AND hash_fingerprint = rec->>'hash_fingerprint'
            AND created_at < now() - interval '1 second'
        ) THEN
          updated_count := updated_count + 1;
        ELSE
          inserted_count := inserted_count + 1;
        END IF;
      ELSE
        skipped_count := skipped_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      errors := errors || SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted_count', inserted_count,
    'updated_count', updated_count,
    'skipped_count', skipped_count,
    'errors', to_jsonb(errors)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- C) Drop the trigger-based approach (it was incomplete/fragile)
-- ═══════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_merge_act_sources ON public.work_item_acts;
DROP FUNCTION IF EXISTS public.merge_act_sources();

-- ═══════════════════════════════════════════════════════════════════
-- D) Add sources[] column to publicaciones if not present
-- ═══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_item_publicaciones'
      AND column_name = 'sources'
  ) THEN
    ALTER TABLE public.work_item_publicaciones
      ADD COLUMN sources text[] DEFAULT ARRAY[]::text[];
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- E) Add orchestrator canary toggle per-org in atenia_ai_config
-- ═══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'atenia_ai_config'
      AND column_name = 'use_orchestrator_sync'
  ) THEN
    ALTER TABLE public.atenia_ai_config
      ADD COLUMN use_orchestrator_sync boolean DEFAULT false;
    
    COMMENT ON COLUMN public.atenia_ai_config.use_orchestrator_sync IS
      'Per-org canary toggle for orchestrator sync. When true, this org uses orchestrateSync() instead of legacy inline providers.';
  END IF;
END $$;

-- Grant execute to service_role (edge functions run as service_role)
GRANT EXECUTE ON FUNCTION public.rpc_upsert_work_item_acts(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_work_item_publicaciones(jsonb) TO service_role;
