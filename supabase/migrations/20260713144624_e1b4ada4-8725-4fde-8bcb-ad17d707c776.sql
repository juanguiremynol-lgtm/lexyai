
-- 1. Add scraper zip-signal columns
ALTER TABLE public.work_item_sources
  ADD COLUMN IF NOT EXISTS zip_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zip_extraction_status text,
  ADD COLUMN IF NOT EXISTS zip_extraction_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS zip_last_checked_at timestamptz;

ALTER TABLE public.work_item_sources
  DROP CONSTRAINT IF EXISTS work_item_sources_zip_extraction_status_check;

ALTER TABLE public.work_item_sources
  ADD CONSTRAINT work_item_sources_zip_extraction_status_check
  CHECK (zip_extraction_status IS NULL OR zip_extraction_status IN
    ('ok', 'no_pdfs', 'radicado_not_found', 'download_failed'));

-- 2. Trigger function: emit user + admin notifications on failure transitions
CREATE OR REPLACE FUNCTION public.notify_pp_zip_extraction_gap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_radicado text;
  v_org_id uuid;
  v_title text;
  v_body text;
  v_type text;
  v_dedupe_owner text;
  v_dedupe_admin text;
  v_today text;
BEGIN
  -- Only fire on failure statuses
  IF NEW.zip_extraction_status IS NULL
     OR NEW.zip_extraction_status NOT IN ('no_pdfs','radicado_not_found','download_failed') THEN
    RETURN NEW;
  END IF;

  -- Only fire on transitions (INSERT or status change)
  IF TG_OP = 'UPDATE'
     AND OLD.zip_extraction_status IS NOT DISTINCT FROM NEW.zip_extraction_status THEN
    RETURN NEW;
  END IF;

  -- Fetch work_item context
  SELECT owner_id, radicado, organization_id
    INTO v_owner_id, v_radicado, v_org_id
  FROM public.work_items
  WHERE id = NEW.work_item_id;

  IF v_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_today := to_char(now(), 'YYYY-MM-DD');
  v_type := 'PP_ZIP_EXTRACTION_GAP';

  CASE NEW.zip_extraction_status
    WHEN 'no_pdfs' THEN
      v_title := 'Posible actuación no capturada';
      v_body := format(
        'El portal publicó un archivo comprimido para el radicado %s pero no se pudieron extraer los PDFs internos. Puede haber una actuación reciente no registrada.',
        coalesce(v_radicado, '(sin radicado)')
      );
    WHEN 'radicado_not_found' THEN
      v_title := 'Radicado no encontrado en publicación';
      v_body := format(
        'El archivo comprimido del portal fue procesado pero ninguno de los PDFs internos menciona el radicado %s. Puede tratarse de ausencia genuina o de un fallo de reconocimiento.',
        coalesce(v_radicado, '(sin radicado)')
      );
    WHEN 'download_failed' THEN
      v_title := 'Fallo al descargar publicación';
      v_body := format(
        'No fue posible descargar el archivo comprimido del portal para el radicado %s. Se reintentará automáticamente.',
        coalesce(v_radicado, '(sin radicado)')
      );
  END CASE;

  v_dedupe_owner := format('pp_zip_gap:%s:%s:%s', NEW.zip_extraction_status, NEW.id, v_today);
  v_dedupe_admin := format('pp_zip_gap_admin:%s:%s:%s', NEW.zip_extraction_status, NEW.id, v_today);

  -- Owner notification
  PERFORM public.insert_notification(
    p_audience_scope := 'USER',
    p_user_id := v_owner_id,
    p_category := 'WORK_ITEM_ALERTS',
    p_type := v_type,
    p_title := v_title,
    p_body := v_body,
    p_severity := 'warning',
    p_metadata := jsonb_build_object(
      'source_id', NEW.id,
      'work_item_id', NEW.work_item_id,
      'radicado', v_radicado,
      'zip_extraction_status', NEW.zip_extraction_status,
      'details', NEW.zip_extraction_details
    ),
    p_dedupe_key := v_dedupe_owner,
    p_deep_link := '/app/work-items/' || NEW.work_item_id::text,
    p_work_item_id := NEW.work_item_id
  );

  -- Platform admin notification
  PERFORM public.insert_notification(
    p_audience_scope := 'SUPER_ADMIN',
    p_user_id := NULL,
    p_category := 'OPS_INCIDENTS',
    p_type := v_type,
    p_title := format('[pp-scraper] %s (%s)', v_title, NEW.zip_extraction_status),
    p_body := v_body,
    p_severity := 'warning',
    p_metadata := jsonb_build_object(
      'source_id', NEW.id,
      'work_item_id', NEW.work_item_id,
      'organization_id', v_org_id,
      'owner_id', v_owner_id,
      'radicado', v_radicado,
      'zip_extraction_status', NEW.zip_extraction_status,
      'details', NEW.zip_extraction_details
    ),
    p_dedupe_key := v_dedupe_admin,
    p_deep_link := '/app/work-items/' || NEW.work_item_id::text,
    p_work_item_id := NEW.work_item_id
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the scraper write on notification failure
  RAISE WARNING 'notify_pp_zip_extraction_gap failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_pp_zip_gap ON public.work_item_sources;
CREATE TRIGGER trg_notify_pp_zip_gap
  AFTER INSERT OR UPDATE OF zip_extraction_status ON public.work_item_sources
  FOR EACH ROW EXECUTE FUNCTION public.notify_pp_zip_extraction_gap();
