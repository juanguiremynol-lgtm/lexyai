BEGIN;

CREATE TABLE public.judicial_reparto_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  detected_process_id uuid REFERENCES public.detected_processes(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('OUTLOOK', 'PDF')),
  source_key text NOT NULL CHECK (source_key ~ '^(pdf|mail):[0-9a-f]{64}$'),
  message_id text,
  message_subject text,
  message_sender text,
  message_received_at timestamptz,
  message_url text,
  pdf_name text,
  pdf_path text,
  pdf_sha256 text CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_stored_at timestamptz,
  suggestions jsonb NOT NULL DEFAULT '{}',
  kind text CHECK (kind IN ('RECEPCION', 'REPARTO')),
  external_reference text CHECK (length(external_reference) <= 120),
  radicado text CHECK (radicado ~ '^[0-9]{23}$'),
  authority_name text CHECK (length(authority_name) <= 240),
  event_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (owner_id, source_key),
  CHECK (source <> 'OUTLOOK' OR message_id IS NOT NULL),
  CHECK (
    (pdf_sha256 IS NOT NULL AND source_key = 'pdf:' || pdf_sha256)
    OR (pdf_sha256 IS NULL AND source = 'OUTLOOK' AND source_key LIKE 'mail:%')
  ),
  CHECK (pdf_path IS NULL OR pdf_path = owner_id::text || '/' || id::text || '/' || pdf_sha256 || '.pdf'),
  CHECK ((pdf_path IS NULL) = (pdf_sha256 IS NULL)),
  CHECK (pdf_stored_at IS NULL OR pdf_path IS NOT NULL),
  CHECK ((confirmed_at IS NULL AND work_item_id IS NULL AND kind IS NULL)
      OR (confirmed_at IS NOT NULL AND work_item_id IS NOT NULL AND kind IS NOT NULL))
);

CREATE INDEX judicial_reparto_imports_item
  ON public.judicial_reparto_imports (work_item_id, confirmed_at DESC)
  WHERE work_item_id IS NOT NULL;
CREATE INDEX judicial_reparto_imports_reference
  ON public.judicial_reparto_imports (owner_id, external_reference)
  WHERE confirmed_at IS NOT NULL AND external_reference IS NOT NULL;
CREATE INDEX judicial_reparto_imports_draft
  ON public.judicial_reparto_imports (owner_id, created_at DESC)
  WHERE work_item_id IS NULL;

ALTER TABLE public.judicial_reparto_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.judicial_reparto_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.judicial_reparto_imports TO authenticated;
GRANT ALL ON public.judicial_reparto_imports TO service_role;
CREATE POLICY judicial_reparto_owner_read ON public.judicial_reparto_imports
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND (SELECT public.mcp_access_level()) = 'first_party');

-- The delete and its storage receipt are separate systems. Keep the object path
-- after the case transaction commits so a failed Storage request stays retryable.
CREATE TABLE public.judicial_reparto_pdf_purges (
  pdf_path text PRIMARY KEY,
  work_item_id uuid,
  owner_id uuid NOT NULL,
  organization_id uuid,
  queued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX judicial_reparto_pdf_purges_by_item ON public.judicial_reparto_pdf_purges (work_item_id);
CREATE INDEX judicial_reparto_pdf_purges_by_owner ON public.judicial_reparto_pdf_purges (owner_id);
CREATE INDEX judicial_reparto_pdf_purges_by_age ON public.judicial_reparto_pdf_purges (queued_at, pdf_path);
ALTER TABLE public.judicial_reparto_pdf_purges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.judicial_reparto_pdf_purges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.judicial_reparto_pdf_purges TO service_role;

CREATE FUNCTION public.queue_judicial_reparto_pdf_purge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.judicial_reparto_pdf_purges (pdf_path, work_item_id, owner_id, organization_id)
  VALUES (OLD.pdf_path, OLD.work_item_id, OLD.owner_id, OLD.organization_id)
  ON CONFLICT (pdf_path) DO NOTHING;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.queue_judicial_reparto_pdf_purge() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER queue_judicial_reparto_pdf_purge
  AFTER DELETE ON public.judicial_reparto_imports
  FOR EACH ROW WHEN (OLD.pdf_path IS NOT NULL)
  EXECUTE FUNCTION public.queue_judicial_reparto_pdf_purge();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('judicial-reparto', 'judicial-reparto', false, 10485760, ARRAY['application/pdf']);

CREATE POLICY judicial_reparto_pdf_owner_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'judicial-reparto'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.judicial_reparto_imports AS proof
      WHERE proof.owner_id = (SELECT auth.uid())
        AND proof.source_key = 'pdf:' || left(storage.filename(objects.name), 64)
        AND proof.pdf_path = objects.name
        AND proof.pdf_stored_at IS NOT NULL
    )
  );

CREATE FUNCTION public.find_judicial_reparto_matches(p_radicado text, p_reference text)
RETURNS TABLE (
  id uuid,
  title text,
  radicado text,
  workflow_type text,
  lifecycle_state text,
  matched_by text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT w.id, w.title, w.radicado, w.workflow_type::text,
         CASE WHEN w.deleted_at IS NOT NULL THEN 'DELETED' ELSE w.lifecycle_state::text END,
         CASE WHEN w.radicado_digits = p_radicado OR w.radicado = p_radicado
              THEN 'RADICADO' ELSE 'REFERENCIA' END
  FROM public.work_items AS w
  WHERE w.owner_id = (SELECT auth.uid())
    AND (SELECT public.mcp_access_level()) = 'first_party'
    AND (
      (p_radicado ~ '^[0-9]{23}$' AND (w.radicado_digits = p_radicado OR w.radicado = p_radicado))
      OR EXISTS (
        SELECT 1 FROM public.judicial_reparto_imports AS proof
        WHERE proof.owner_id = w.owner_id AND proof.work_item_id = w.id
          AND proof.confirmed_at IS NOT NULL
          AND proof.external_reference = upper(btrim(p_reference))
      )
    )
  ORDER BY CASE WHEN w.radicado_digits = p_radicado OR w.radicado = p_radicado THEN 0 ELSE 1 END,
           w.created_at DESC, w.id
  LIMIT 20;
$function$;

CREATE FUNCTION public.confirm_judicial_reparto(
  p_import_id uuid, p_work_item_id uuid, p_confirmed boolean, p_kind text,
  p_reference text, p_radicado text, p_authority text, p_event_on date,
  p_workflow_type text, p_title text, p_client_id uuid, p_demandantes text, p_demandados text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_owner uuid := auth.uid();
  v_proof public.judicial_reparto_imports%ROWTYPE;
  v_item public.work_items%ROWTYPE;
  v_created boolean := false;
  v_result jsonb;
  v_digits text := nullif(btrim(p_radicado), '');
  v_reference text := nullif(upper(btrim(p_reference)), '');
  v_authority text := nullif(btrim(p_authority), '');
  v_key text := 'reparto:' || p_import_id::text;
BEGIN
  IF v_owner IS NULL OR public.mcp_access_level() IS DISTINCT FROM 'first_party' THEN
    RAISE EXCEPTION 'Se requiere una sesión propia de Andrómeda' USING ERRCODE = '42501';
  END IF;
  IF p_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirma que el comprobante corresponde a una presentación judicial real' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mcp-radicado:' || v_owner::text, 0));
  SELECT * INTO v_proof FROM public.judicial_reparto_imports
    WHERE id = p_import_id AND owner_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Importación no encontrada' USING ERRCODE = '42501';
  END IF;
  IF v_proof.pdf_path IS NOT NULL AND v_proof.pdf_stored_at IS NULL THEN
    RAISE EXCEPTION 'Vuelve a importar el PDF para completar su almacenamiento' USING ERRCODE = '22023';
  END IF;
  IF v_proof.work_item_id IS NOT NULL THEN
    IF p_work_item_id IS NOT NULL AND p_work_item_id <> v_proof.work_item_id THEN
      RAISE EXCEPTION 'El comprobante ya pertenece a otro expediente' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('work_item_id', v_proof.work_item_id, 'created', false, 'replayed', true);
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('RECEPCION', 'REPARTO') THEN
    RAISE EXCEPTION 'Selecciona el tipo de comprobante' USING ERRCODE = '22023';
  END IF;
  IF v_digits IS NOT NULL AND (v_digits !~ '^[0-9]{23}$' OR v_digits = repeat('0', 23)) THEN
    RAISE EXCEPTION 'El radicado judicial debe tener 23 dígitos' USING ERRCODE = '22023';
  END IF;
  IF length(v_reference) > 120 OR length(v_authority) > 240 OR length(btrim(p_title)) > 180
     OR length(btrim(p_demandantes)) > 500 OR length(btrim(p_demandados)) > 500 THEN
    RAISE EXCEPTION 'Revisa la longitud de los datos del comprobante' USING ERRCODE = '22023';
  END IF;
  IF p_event_on > (now() AT TIME ZONE 'America/Bogota')::date OR p_event_on < DATE '1990-01-01' THEN
    RAISE EXCEPTION 'La fecha del comprobante no es válida' USING ERRCODE = '22023';
  END IF;

  IF p_work_item_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.find_judicial_reparto_matches(v_digits, v_reference)) THEN
      RAISE EXCEPTION 'Ya hay un expediente con ese radicado o referencia. Revisa las coincidencias antes de crear.'
        USING ERRCODE = '23505';
    END IF;
    IF p_workflow_type IS NULL OR p_workflow_type NOT IN ('CGP', 'EJECUTIVO', 'CPACA', 'LABORAL', 'TUTELA') THEN
      RAISE EXCEPTION 'Selecciona el tipo de proceso judicial' USING ERRCODE = '22023';
    END IF;
    IF nullif(btrim(p_title), '') IS NULL THEN
      RAISE EXCEPTION 'Escribe un nombre para el expediente' USING ERRCODE = '22023';
    END IF;
    v_result := public.mcp_create_work_item(
      p_workflow_type, NULL, v_digits, btrim(p_title), p_client_id,
      nullif(btrim(p_demandantes), ''), nullif(btrim(p_demandados), ''), v_authority, NULL, v_key
    );
    SELECT * INTO STRICT v_item FROM public.work_items
      WHERE id = (v_result #>> '{work_item,id}')::uuid AND owner_id = v_owner;
    v_created := true;
  ELSE
    SELECT * INTO v_item FROM public.work_items
      WHERE id = p_work_item_id AND owner_id = v_owner FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Expediente no encontrado' USING ERRCODE = '42501';
    END IF;
    IF v_item.lifecycle_state::text IS DISTINCT FROM 'ACTIVE' OR v_item.deleted_at IS NOT NULL
       OR v_item.workflow_type::text IN ('PETICION', 'GOV_PROCEDURE') THEN
      RAISE EXCEPTION 'Selecciona un expediente judicial activo de tu cartera' USING ERRCODE = '22023';
    END IF;
    IF v_digits IS NOT NULL AND nullif(btrim(v_item.radicado), '') IS NOT NULL
       AND regexp_replace(v_item.radicado, '[^0-9]', '', 'g') <> v_digits THEN
      RAISE EXCEPTION 'El radicado del comprobante no coincide con este expediente o instancia' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.find_judicial_reparto_matches(v_digits, v_reference))
       AND NOT EXISTS (
         SELECT 1 FROM public.find_judicial_reparto_matches(v_digits, v_reference) AS matched
         WHERE matched.id = v_item.id
       ) THEN
      RAISE EXCEPTION 'El comprobante coincide con otro expediente. Revisa la selección.' USING ERRCODE = '23505';
    END IF;
    IF v_digits IS NOT NULL AND v_reference IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.find_judicial_reparto_matches(NULL, v_reference) AS matched
      WHERE matched.id <> v_item.id
    ) THEN
      RAISE EXCEPTION 'La referencia y el radicado corresponden a expedientes distintos. Revisa el comprobante.'
        USING ERRCODE = '23505';
    END IF;
    IF v_digits IS NOT NULL AND nullif(btrim(v_item.radicado), '') IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.find_judicial_reparto_matches(v_digits, NULL) AS matched
        WHERE matched.id <> v_item.id
      ) THEN
        RAISE EXCEPTION 'El radicado ya corresponde a otro expediente de tu cartera' USING ERRCODE = '23505';
      END IF;
      PERFORM public.mcp_assign_work_item_radicado(v_item.id, v_digits, v_item.updated_at, v_key);
    END IF;
    IF p_kind = 'REPARTO' AND v_authority IS NOT NULL AND nullif(btrim(v_item.authority_name), '') IS NULL THEN
      UPDATE public.work_items SET authority_name = v_authority WHERE id = v_item.id;
    END IF;
  END IF;

  UPDATE public.judicial_reparto_imports
    SET work_item_id = v_item.id, organization_id = v_item.organization_id,
        kind = p_kind, external_reference = v_reference,
        radicado = v_digits, authority_name = v_authority, event_on = p_event_on, confirmed_at = now()
    WHERE id = v_proof.id;

  IF v_proof.detected_process_id IS NOT NULL AND v_digits IS NOT NULL THEN
    UPDATE public.detected_processes
      SET status = CASE WHEN v_created THEN 'CREATED' ELSE 'MATCHED_EXISTING' END,
          created_work_item_id = v_item.id
      WHERE id = v_proof.detected_process_id AND user_id = v_owner AND status = 'PENDING'
        AND regexp_replace(radicado, '[^0-9]', '', 'g') = v_digits;
  END IF;

  RETURN jsonb_build_object('work_item_id', v_item.id, 'created', v_created, 'replayed', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.find_judicial_reparto_matches(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_judicial_reparto_matches(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_judicial_reparto(uuid, uuid, boolean, text, text, text, text, date, text, text, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_judicial_reparto(uuid, uuid, boolean, text, text, text, text, date, text, text, uuid, text, text)
  TO authenticated;

COMMIT;
