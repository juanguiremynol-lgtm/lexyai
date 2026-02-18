-- Fix type cast for scrape_date in rpc_upsert_work_item_acts
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
        (rec->>'scrape_date')::date,
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
        scrape_date = COALESCE((rec->>'scrape_date')::date, work_item_acts.scrape_date),
        updated_at = now()
      WHERE NOT (
        work_item_acts.sources @> ARRAY(SELECT jsonb_array_elements_text(rec->'sources'))
      );

      IF FOUND THEN
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