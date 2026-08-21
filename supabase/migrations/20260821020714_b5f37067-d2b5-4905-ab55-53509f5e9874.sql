-- Z3: derived titles with explicit provenance
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS title_source text;

CREATE OR REPLACE FUNCTION public.derive_work_item_title(
  _demandantes text, _demandados text, _radicado text
) RETURNS TABLE(title text, title_source text)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  a text; b text; a_n int; b_n int; extra text := '';
BEGIN
  a := NULLIF(btrim(split_part(COALESCE(_demandantes,''), '|', 1)), '');
  b := NULLIF(btrim(split_part(COALESCE(_demandados,''), '|', 1)), '');
  a_n := CASE WHEN COALESCE(_demandantes,'') = '' THEN 0
              ELSE array_length(string_to_array(_demandantes,'|'),1) END;
  b_n := CASE WHEN COALESCE(_demandados,'') = '' THEN 0
              ELSE array_length(string_to_array(_demandados,'|'),1) END;

  IF a IS NULL AND b IS NULL THEN
    RETURN QUERY SELECT _radicado, 'RADICADO'::text;
    RETURN;
  END IF;

  IF COALESCE(b_n,0) > 1 THEN
    extra := ' y otros';
  END IF;

  IF a IS NOT NULL AND b IS NOT NULL THEN
    RETURN QUERY SELECT initcap(a) || ' vs. ' || initcap(b) || extra, 'DERIVED_PARTIES'::text;
  ELSIF a IS NOT NULL THEN
    RETURN QUERY SELECT initcap(a) || CASE WHEN COALESCE(a_n,0) > 1 THEN ' y otros' ELSE '' END,
                        'DERIVED_PARTIES'::text;
  ELSE
    RETURN QUERY SELECT initcap(b) || extra, 'DERIVED_PARTIES'::text;
  END IF;
END;
$$;

-- One-off backfill: only matters with no usable title. Titles the lawyer typed
-- are never overwritten, and soft-deleted matters are left untouched.
WITH cand AS (
  SELECT w.id, d.title AS new_title, d.title_source
  FROM public.work_items w
  CROSS JOIN LATERAL public.derive_work_item_title(w.demandantes, w.demandados, w.radicado) d
  WHERE w.deleted_at IS NULL
    AND (w.title IS NULL OR btrim(w.title) = '' OR w.title = w.radicado)
)
UPDATE public.work_items w
SET title = cand.new_title, title_source = cand.title_source
FROM cand WHERE cand.id = w.id;

-- Z2: daily exposure refresh at 09:10 UTC
SELECT cron.schedule(
  'sync-detalle-exposicion-daily',
  '10 9 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/sync-detalle-exposicion',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{"source":"cron"}'::jsonb
  );
  $cron$
);