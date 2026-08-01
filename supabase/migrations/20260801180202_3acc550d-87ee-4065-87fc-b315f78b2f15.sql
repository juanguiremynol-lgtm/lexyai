-- ============ PART A: normalized global search ============

ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS radicado_digits text
  GENERATED ALWAYS AS (regexp_replace(coalesce(radicado, ''), '[^0-9]', '', 'g')) STORED;

CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public, extensions
AS $$ SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

CREATE INDEX IF NOT EXISTS idx_work_items_radicado_digits ON public.work_items (radicado_digits);
CREATE INDEX IF NOT EXISTS idx_work_items_radicado_digits_trgm ON public.work_items USING gin (radicado_digits gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_work_items_title_trgm ON public.work_items USING gin (public.f_unaccent(lower(coalesce(title, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_work_items_demandantes_trgm ON public.work_items USING gin (public.f_unaccent(lower(coalesce(demandantes, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_work_items_demandados_trgm ON public.work_items USING gin (public.f_unaccent(lower(coalesce(demandados, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_work_items_authority_name_trgm ON public.work_items USING gin (public.f_unaccent(lower(coalesce(authority_name, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_work_items_authority_city_trgm ON public.work_items USING gin (public.f_unaccent(lower(coalesce(authority_city, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clients_name_trgm ON public.clients USING gin (public.f_unaccent(lower(coalesce(name, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_wiel_confirmed_subject_trgm ON public.work_item_email_links USING gin (public.f_unaccent(lower(coalesce(subject, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_wiel_confirmed_sender ON public.work_item_email_links (work_item_id) WHERE link_status = 'CONFIRMED';

CREATE OR REPLACE FUNCTION public.search_work_items_normalized(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  radicado text,
  title text,
  demandantes text,
  demandados text,
  authority_name text,
  authority_city text,
  workflow_type text,
  stage text,
  client_name text,
  matched_fields text[],
  match_rank integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_tokens text[];
  v_token text;
  v_digits text;
  v_qdigits text;
  v_and text[] := ARRAY[]::text[];
  v_rad_exact text[] := ARRAY[]::text[];
  v_rad_part text[] := ARRAY[]::text[];
  v_title text[] := ARRAY[]::text[];
  v_dte text[] := ARRAY[]::text[];
  v_ddo text[] := ARRAY[]::text[];
  v_auth text[] := ARRAY[]::text[];
  v_city text[] := ARRAY[]::text[];
  v_wf text[] := ARRAY[]::text[];
  v_stage text[] := ARRAY[]::text[];
  v_client text[] := ARRAY[]::text[];
  v_demail text[] := ARRAY[]::text[];
  v_lemail text[] := ARRAY[]::text[];
  v_sql text;
BEGIN
  IF p_query IS NULL OR btrim(p_query) = '' THEN RETURN; END IF;

  v_qdigits := regexp_replace(p_query, '[^0-9]', '', 'g');
  v_tokens := regexp_split_to_array(btrim(p_query), '\s+');

  FOREACH v_token IN ARRAY v_tokens LOOP
    CONTINUE WHEN btrim(v_token) = '';
    v_digits := regexp_replace(v_token, '[^0-9]', '', 'g');

    -- Radicado: exact / base(21) / missing leading zero (22) / substring.
    IF length(v_digits) >= 4 THEN
      v_rad_exact := v_rad_exact || format(
        '(b.radicado_digits = %1$L OR (length(%1$L) >= 21 AND left(b.radicado_digits,21) = left(%1$L,21)) OR (length(%1$L) = 22 AND left(b.radicado_digits,21) = left(%2$L,21)))',
        v_digits, '0' || v_digits);
      v_rad_part := v_rad_part || format('(b.radicado_digits LIKE %L)', '%' || v_digits || '%');
      v_client := v_client || format('(regexp_replace(b.client_id_number, ''[^0-9]'', '''', ''g'') LIKE %L)', '%' || v_digits || '%');
    END IF;

    v_title  := v_title  || format('(public.f_unaccent(lower(coalesce(b.title,''''))) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%');
    v_dte    := v_dte    || format('(public.f_unaccent(lower(coalesce(b.demandantes,''''))) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%');
    v_ddo    := v_ddo    || format('(public.f_unaccent(lower(coalesce(b.demandados,''''))) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%');
    v_auth   := v_auth   || format('(public.f_unaccent(lower(coalesce(b.authority_name,''''))) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%');
    v_city   := v_city   || format('(public.f_unaccent(lower(coalesce(b.authority_city,''''))) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%');
    v_wf     := v_wf     || format('(lower(b.workflow_type) LIKE lower(%L))', '%' || v_token || '%');
    v_stage  := v_stage  || format('(lower(coalesce(b.stage,'''')) LIKE lower(%L))', '%' || v_token || '%');
    v_client := v_client || format('(public.f_unaccent(lower(b.client_name)) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%');
    v_demail := v_demail || format('(b.despacho_emails LIKE lower(%L))', '%' || v_token || '%');
    v_lemail := v_lemail || format('(b.email_blob LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%');

    -- AND across tokens: every token must hit at least one field.
    v_and := v_and || format('(%s)', array_to_string(ARRAY[
      CASE WHEN length(v_digits) >= 4 THEN format('(b.radicado_digits LIKE %L)', '%' || v_digits || '%') ELSE 'false' END,
      CASE WHEN length(v_digits) >= 4 THEN format('(regexp_replace(b.client_id_number, ''[^0-9]'', '''', ''g'') LIKE %L)', '%' || v_digits || '%') ELSE 'false' END,
      format('(public.f_unaccent(lower(coalesce(b.title,''''))) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%'),
      format('(public.f_unaccent(lower(coalesce(b.demandantes,''''))) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%'),
      format('(public.f_unaccent(lower(coalesce(b.demandados,''''))) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%'),
      format('(public.f_unaccent(lower(coalesce(b.authority_name,''''))) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%'),
      format('(public.f_unaccent(lower(coalesce(b.authority_city,''''))) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%'),
      format('(lower(b.workflow_type) LIKE lower(%L))', '%' || v_token || '%'),
      format('(lower(coalesce(b.stage,'''')) LIKE lower(%L))', '%' || v_token || '%'),
      format('(public.f_unaccent(lower(b.client_name)) LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%'),
      format('(b.despacho_emails LIKE lower(%L))', '%' || v_token || '%'),
      format('(b.email_blob LIKE public.f_unaccent(lower(%L)))', '%' || v_token || '%')
    ], ' OR '));
  END LOOP;

  IF array_length(v_and, 1) IS NULL THEN RETURN; END IF;

  v_sql := format($q$
    WITH base AS (
      SELECT w.id, w.radicado, w.radicado_digits, w.title, w.demandantes, w.demandados,
             w.authority_name, w.authority_city, w.workflow_type::text AS workflow_type,
             coalesce(w.stage, '')::text AS stage, w.updated_at,
             coalesce(c.name, '') AS client_name,
             coalesce(c.id_number, '') AS client_id_number,
             lower(concat_ws(' ', w.authority_email, w.resolved_email, w.courthouse_email_confirmed,
                             w.courthouse_email_suggested, cd.email::text)) AS despacho_emails,
             coalesce((
               SELECT public.f_unaccent(lower(string_agg(concat_ws(' ', l.subject, l.sender), ' ')))
               FROM public.work_item_email_links l
               WHERE l.work_item_id = w.id AND l.link_status = 'CONFIRMED'
             ), '') AS email_blob
      FROM public.work_items w
      LEFT JOIN public.clients c ON c.id = w.client_id
      LEFT JOIN public.courthouse_directory cd ON cd.id = w.courthouse_directory_id
      WHERE w.deleted_at IS NULL
        AND coalesce(w.lifecycle_state::text, 'ACTIVE') <> 'DELETED'
    )
    SELECT b.id, b.radicado, b.title, b.demandantes, b.demandados, b.authority_name,
           b.authority_city, b.workflow_type, b.stage, b.client_name,
           array_remove(ARRAY[
             CASE WHEN %2$s THEN 'radicado' END,
             CASE WHEN (%3$s) AND NOT (%2$s) THEN 'radicado parcial' END,
             CASE WHEN %4$s THEN 'titulo' END,
             CASE WHEN %5$s THEN 'demandante' END,
             CASE WHEN %6$s THEN 'demandado' END,
             CASE WHEN %7$s THEN 'despacho' END,
             CASE WHEN %8$s THEN 'ciudad' END,
             CASE WHEN %9$s THEN 'tipo' END,
             CASE WHEN %10$s THEN 'etapa' END,
             CASE WHEN %11$s THEN 'cliente' END,
             CASE WHEN %12$s THEN 'correo del despacho' END,
             CASE WHEN %13$s THEN 'correo vinculado' END
           ], NULL) AS matched_fields,
           (CASE
              WHEN %14$L <> '' AND b.radicado_digits = %14$L THEN 1
              WHEN %14$L <> '' AND length(%14$L) >= 21 AND left(b.radicado_digits,21) = left(%14$L,21) THEN 2
              WHEN %14$L <> '' AND length(%14$L) = 22 AND left(b.radicado_digits,21) = left(%15$L,21) THEN 2
              WHEN %14$L <> '' AND length(%14$L) >= 4 AND b.radicado_digits LIKE %16$L THEN 3
              WHEN %4$s OR %5$s OR %6$s THEN 4
              ELSE 5
            END)::int AS match_rank,
           b.updated_at
    FROM base b
    WHERE %1$s
    ORDER BY match_rank ASC, b.updated_at DESC NULLS LAST
    LIMIT %17$s
  $q$,
    array_to_string(v_and, ' AND '),
    CASE WHEN array_length(v_rad_exact,1) IS NULL THEN 'false' ELSE array_to_string(v_rad_exact, ' OR ') END,
    CASE WHEN array_length(v_rad_part,1) IS NULL THEN 'false' ELSE array_to_string(v_rad_part, ' OR ') END,
    array_to_string(v_title, ' OR '),
    array_to_string(v_dte, ' OR '),
    array_to_string(v_ddo, ' OR '),
    array_to_string(v_auth, ' OR '),
    array_to_string(v_city, ' OR '),
    array_to_string(v_wf, ' OR '),
    array_to_string(v_stage, ' OR '),
    array_to_string(v_client, ' OR '),
    array_to_string(v_demail, ' OR '),
    array_to_string(v_lemail, ' OR '),
    v_qdigits,
    '0' || v_qdigits,
    '%' || v_qdigits || '%',
    greatest(1, least(coalesce(p_limit, 20), 100))
  );

  RETURN QUERY EXECUTE v_sql;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.search_work_items_normalized(text, integer) TO authenticated;

-- ============ PART B: manual override on email links ============

CREATE TABLE IF NOT EXISTS public.email_link_manual_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  organization_id uuid,
  internet_message_id text,
  message_id text,
  subject text,
  sender text,
  received_at timestamptz,
  message_radicados text[] NOT NULL DEFAULT ARRAY[]::text[],
  previous_suggested_work_item_id uuid,
  chosen_work_item_id uuid NOT NULL,
  chosen_radicado text,
  override_despite_conflict boolean NOT NULL DEFAULT false,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.email_link_manual_overrides TO authenticated;
GRANT ALL ON public.email_link_manual_overrides TO service_role;

ALTER TABLE public.email_link_manual_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS elmo_select ON public.email_link_manual_overrides;
CREATE POLICY elmo_select ON public.email_link_manual_overrides
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS elmo_insert ON public.email_link_manual_overrides;
CREATE POLICY elmo_insert ON public.email_link_manual_overrides
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_elmo_updated_at ON public.email_link_manual_overrides;
CREATE TRIGGER trg_elmo_updated_at BEFORE UPDATE ON public.email_link_manual_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_elmo_user ON public.email_link_manual_overrides (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_elmo_chosen ON public.email_link_manual_overrides (chosen_work_item_id);

CREATE OR REPLACE FUNCTION public.manual_link_email_to_work_item(
  p_link_id uuid,
  p_work_item_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_src public.work_item_email_links%ROWTYPE;
  v_target public.work_items%ROWTYPE;
  v_new_id uuid;
  v_msg_rads text[];
  v_target_base text;
  v_conflict boolean := false;
  v_meta jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_src FROM public.work_item_email_links WHERE id = p_link_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vínculo no encontrado o sin permisos'; END IF;

  SELECT * INTO v_target FROM public.work_items
   WHERE id = p_work_item_id
     AND deleted_at IS NULL
     AND (owner_id = v_uid OR (organization_id IS NOT NULL AND public.is_org_member(organization_id)));
  IF NOT FOUND THEN RAISE EXCEPTION 'Expediente no encontrado o sin permisos'; END IF;

  -- Radicados referenced by the message (persisted by the matcher).
  SELECT coalesce(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_msg_rads
    FROM jsonb_array_elements_text(coalesce(v_src.evidence_meta -> 'body_radicados', '[]'::jsonb)) AS t(x);

  v_target_base := left(regexp_replace(coalesce(v_target.radicado, ''), '[^0-9]', '', 'g'), 21);
  IF array_length(v_msg_rads, 1) IS NOT NULL AND v_target_base <> '' THEN
    v_conflict := NOT EXISTS (
      SELECT 1 FROM unnest(v_msg_rads) AS r
      WHERE left(regexp_replace(r, '[^0-9]', '', 'g'), 21) = v_target_base
    );
  END IF;

  v_meta := coalesce(v_src.evidence_meta, '{}'::jsonb) || jsonb_build_object(
    'manual_override', jsonb_build_object(
      'by_user', v_uid,
      'at', now(),
      'previous_suggested_work_item_id', v_src.work_item_id
    ),
    'override_despite_conflict', v_conflict
  );

  -- Dismiss every sibling suggestion of the same message.
  UPDATE public.work_item_email_links
     SET link_status = 'DISMISSED'
   WHERE user_id = v_uid
     AND link_status = 'SUGGESTED'
     AND id <> p_link_id
     AND (
       (v_src.internet_message_id IS NOT NULL AND internet_message_id = v_src.internet_message_id)
       OR (v_src.internet_message_id IS NULL AND message_id = v_src.message_id)
     );

  IF v_src.work_item_id = p_work_item_id THEN
    UPDATE public.work_item_email_links
       SET link_status = 'CONFIRMED', matched_by = 'MANUAL', confidence = 1.0, evidence_meta = v_meta
     WHERE id = p_link_id
     RETURNING id INTO v_new_id;
  ELSE
    INSERT INTO public.work_item_email_links (
      user_id, organization_id, work_item_id, connection_id, message_id, internet_message_id,
      conversation_id, direction, subject, sender, recipients, received_at, has_attachments,
      attachment_names, web_link, matched_by, matched_value, confidence, evidence_type,
      evidence_subtype, memorial_subtype, low_content, evidence_meta, link_status
    ) VALUES (
      v_uid, v_target.organization_id, p_work_item_id, v_src.connection_id, v_src.message_id,
      v_src.internet_message_id, v_src.conversation_id, v_src.direction, v_src.subject, v_src.sender,
      v_src.recipients, v_src.received_at, v_src.has_attachments, v_src.attachment_names,
      v_src.web_link, 'MANUAL', coalesce(v_target.radicado, v_src.matched_value), 1.0,
      v_src.evidence_type, v_src.evidence_subtype, v_src.memorial_subtype, v_src.low_content,
      v_meta, 'CONFIRMED'
    )
    ON CONFLICT (message_id, work_item_id) DO UPDATE
      SET link_status = 'CONFIRMED', matched_by = 'MANUAL', confidence = 1.0,
          evidence_meta = EXCLUDED.evidence_meta
    RETURNING id INTO v_new_id;

    -- The previously suggested row for the source WI is no longer valid.
    UPDATE public.work_item_email_links
       SET link_status = 'DISMISSED'
     WHERE id = p_link_id AND link_status <> 'CONFIRMED';
  END IF;

  INSERT INTO public.email_link_manual_overrides (
    user_id, organization_id, internet_message_id, message_id, subject, sender, received_at,
    message_radicados, previous_suggested_work_item_id, chosen_work_item_id, chosen_radicado,
    override_despite_conflict, signals
  ) VALUES (
    v_uid, v_target.organization_id, v_src.internet_message_id, v_src.message_id, v_src.subject,
    v_src.sender, v_src.received_at, v_msg_rads, v_src.work_item_id, p_work_item_id,
    v_target.radicado, v_conflict,
    jsonb_build_object(
      'matched_by', v_src.matched_by,
      'confidence', v_src.confidence,
      'match_signals', coalesce(v_src.evidence_meta -> 'match_signals', '[]'::jsonb),
      'evidence_type', v_src.evidence_type,
      'evidence_subtype', v_src.evidence_subtype
    )
  );

  RETURN v_new_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.manual_link_email_to_work_item(uuid, uuid) TO authenticated;