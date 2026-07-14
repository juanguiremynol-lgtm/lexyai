
DO $$
DECLARE
  v_merged INT := 0;
  v_quarantine INT := 0;
  v_null_total INT := 0;
BEGIN
  ALTER TABLE public.work_item_publicaciones DISABLE TRIGGER USER;

  WITH nulls AS (
    SELECT id, work_item_id, pdf_url, entry_url, pdf_available, raw_data,
           canon_normalize_title(canon_strip_title_noise(title)) AS nt,
           canon_normalize_title(COALESCE(tipo_publicacion,''))  AS ntipo
      FROM public.work_item_publicaciones
     WHERE is_archived = false AND published_at IS NULL
  ),
  dated AS (
    SELECT id, work_item_id,
           canon_normalize_title(canon_strip_title_noise(title)) AS nt,
           canon_normalize_title(COALESCE(tipo_publicacion,''))  AS ntipo
      FROM public.work_item_publicaciones
     WHERE is_archived = false AND published_at IS NOT NULL
  ),
  matched AS (
    SELECT n.id AS null_id, n.pdf_url AS null_pdf, n.entry_url AS null_entry,
           n.pdf_available AS null_pdf_available, n.raw_data AS null_raw,
           (array_agg(d.id ORDER BY d.id))[1] AS dated_id,
           COUNT(d.id) AS dated_count
      FROM nulls n
      LEFT JOIN dated d
        ON d.work_item_id = n.work_item_id AND d.nt = n.nt AND d.ntipo = n.ntipo
     GROUP BY n.id, n.pdf_url, n.entry_url, n.pdf_available, n.raw_data
  ),
  mergeable AS (SELECT * FROM matched WHERE dated_count = 1),
  enrich AS (
    UPDATE public.work_item_publicaciones w
       SET pdf_url        = COALESCE(w.pdf_url, m.null_pdf),
           entry_url      = COALESCE(w.entry_url, m.null_entry),
           pdf_available  = (w.pdf_available OR COALESCE(m.null_pdf_available, false)),
           raw_data       = COALESCE(w.raw_data, '{}'::jsonb)
                            || jsonb_build_object(
                                 'null_date_orphan_absorbed',
                                 jsonb_build_object(
                                   'orphan_id', m.null_id,
                                   'orphan_pdf_url', m.null_pdf,
                                   'orphan_entry_url', m.null_entry,
                                   'orphan_raw', m.null_raw,
                                   'merged_at', now()
                                 )
                               ),
           updated_at     = now()
      FROM mergeable m
     WHERE w.id = m.dated_id
    RETURNING w.id
  ),
  archive_orphans AS (
    UPDATE public.work_item_publicaciones w
       SET is_archived     = true,
           archived_at     = now(),
           archived_reason = 'NULL_DATE_ORPHAN_MERGED',
           updated_at      = now()
      FROM mergeable m
     WHERE w.id = m.null_id
    RETURNING w.id
  )
  SELECT (SELECT COUNT(*) FROM archive_orphans) INTO v_merged;

  ALTER TABLE public.work_item_publicaciones ENABLE TRIGGER USER;

  SELECT COUNT(*) INTO v_quarantine
    FROM (
      SELECT n.id, COUNT(d.work_item_id) AS c
        FROM (SELECT id, work_item_id,
                     canon_normalize_title(canon_strip_title_noise(title)) AS nt,
                     canon_normalize_title(COALESCE(tipo_publicacion,''))  AS ntipo
                FROM public.work_item_publicaciones
               WHERE is_archived = false AND published_at IS NULL) n
        LEFT JOIN (SELECT work_item_id,
                          canon_normalize_title(canon_strip_title_noise(title)) AS nt,
                          canon_normalize_title(COALESCE(tipo_publicacion,''))  AS ntipo
                     FROM public.work_item_publicaciones
                    WHERE is_archived = false AND published_at IS NOT NULL) d
          ON d.work_item_id = n.work_item_id AND d.nt = n.nt AND d.ntipo = n.ntipo
       GROUP BY n.id
      HAVING COUNT(d.work_item_id) <> 1
    ) q;

  SELECT COUNT(*) INTO v_null_total
    FROM public.work_item_publicaciones
   WHERE is_archived = false AND published_at IS NULL;

  RAISE NOTICE 'NULL-date orphan consolidation: merged=%, quarantine=%, remaining_null_live=%',
    v_merged, v_quarantine, v_null_total;
END $$;

CREATE OR REPLACE FUNCTION public.guard_pubs_null_date_orphan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_target_id UUID;
  v_dated_count INT;
BEGIN
  IF NEW.published_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.is_archived IS TRUE THEN RETURN NEW; END IF;

  SELECT id, cnt INTO v_target_id, v_dated_count
    FROM (
      SELECT id, COUNT(*) OVER () AS cnt
        FROM public.work_item_publicaciones
       WHERE work_item_id = NEW.work_item_id
         AND is_archived = false
         AND published_at IS NOT NULL
         AND canon_normalize_title(canon_strip_title_noise(title))
             = canon_normalize_title(canon_strip_title_noise(NEW.title))
         AND canon_normalize_title(COALESCE(tipo_publicacion,''))
             = canon_normalize_title(COALESCE(NEW.tipo_publicacion,''))
       LIMIT 1
    ) s;

  IF v_dated_count = 1 THEN
    UPDATE public.work_item_publicaciones w
       SET pdf_url       = COALESCE(w.pdf_url, NEW.pdf_url),
           entry_url     = COALESCE(w.entry_url, NEW.entry_url),
           pdf_available = (w.pdf_available OR COALESCE(NEW.pdf_available, false)),
           raw_data      = COALESCE(w.raw_data, '{}'::jsonb)
                           || jsonb_build_object(
                                'null_date_orphan_absorbed_on_insert',
                                jsonb_build_object(
                                  'orphan_pdf_url', NEW.pdf_url,
                                  'orphan_entry_url', NEW.entry_url,
                                  'orphan_source', NEW.source,
                                  'merged_at', now()
                                )
                              ),
           updated_at    = now()
     WHERE w.id = v_target_id;

    NEW.is_archived     := true;
    NEW.archived_at     := now();
    NEW.archived_reason := 'NULL_DATE_ORPHAN_MERGED_ON_INSERT';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_pubs_null_date_orphan ON public.work_item_publicaciones;
CREATE TRIGGER trg_guard_pubs_null_date_orphan
BEFORE INSERT ON public.work_item_publicaciones
FOR EACH ROW
EXECUTE FUNCTION public.guard_pubs_null_date_orphan();
