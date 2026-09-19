-- Client WhatsApp notices: consent, approval queue, immutable send log.
-- Nothing sends without per-message approval. No computed term/deadline ever enters a draft.

CREATE TABLE public.client_wa_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  consent_method text NOT NULL,
  consent_note text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_wa_phone_e164 CHECK (phone_e164 ~ '^[1-9][0-9]{7,14}$')
);
CREATE UNIQUE INDEX uq_client_wa_consent_active
  ON public.client_wa_consent (client_id) WHERE revoked_at IS NULL;

CREATE TABLE public.client_wa_source_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);

CREATE TABLE public.client_wa_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  consent_id uuid NOT NULL REFERENCES public.client_wa_consent(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  fact_date date NOT NULL,
  fact_text text NOT NULL,
  body_text text NOT NULL,
  edited_body_text text,
  status text NOT NULL DEFAULT 'PENDING',
  discard_reason text,
  approved_by uuid,
  approved_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_wa_draft_status CHECK (status IN ('PENDING','APPROVED','SENT','DISCARDED','EXPIRED','FAILED')),
  CONSTRAINT chk_wa_draft_kind CHECK (source_kind IN ('ACTUACION','ESTADO')),
  UNIQUE (source_table, source_id, client_id)
);
CREATE INDEX idx_client_wa_drafts_pending ON public.client_wa_drafts (organization_id, status, created_at DESC);

-- Evidence of what the client was told. Never deleted by cleanup jobs.
CREATE TABLE public.client_wa_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  client_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  phone_e164 text NOT NULL,
  template_name text NOT NULL,
  body_text text NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  wa_message_id text,
  delivery_status text NOT NULL DEFAULT 'ACCEPTED',
  provider_response jsonb,
  error_text text
);
CREATE INDEX idx_client_wa_sends_org ON public.client_wa_sends (organization_id, sent_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.client_wa_consent TO authenticated;
GRANT SELECT, UPDATE ON public.client_wa_drafts TO authenticated;
GRANT SELECT ON public.client_wa_sends TO authenticated;
GRANT SELECT ON public.client_wa_source_blocklist TO authenticated;
GRANT ALL ON public.client_wa_consent TO service_role;
GRANT ALL ON public.client_wa_drafts TO service_role;
GRANT ALL ON public.client_wa_sends TO service_role;
GRANT ALL ON public.client_wa_source_blocklist TO service_role;

ALTER TABLE public.client_wa_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_wa_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_wa_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_wa_source_blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read consent" ON public.client_wa_consent
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "org members record consent" ON public.client_wa_consent
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(organization_id) AND granted_by = auth.uid());
CREATE POLICY "org members revoke consent" ON public.client_wa_consent
  FOR UPDATE TO authenticated USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "org members read drafts" ON public.client_wa_drafts
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "org members decide drafts" ON public.client_wa_drafts
  FOR UPDATE TO authenticated USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "org members read sends" ON public.client_wa_sends
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));

CREATE POLICY "authenticated read blocklist" ON public.client_wa_source_blocklist
  FOR SELECT TO authenticated USING (true);

-- Structural guard. A fact that fails any rule is never drafted.
CREATE OR REPLACE FUNCTION public.client_wa_candidates(_org uuid, _lookback_days int DEFAULT 7)
RETURNS TABLE (
  source_kind text, source_table text, source_id uuid, work_item_id uuid,
  client_id uuid, consent_id uuid, radicado text, caratula text,
  fact_date date, fact_text text, reject_reason text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pend AS (
    SELECT DISTINCT r.work_item_id
    FROM external_sync_runs r
    JOIN external_sync_run_attempts t ON t.sync_run_id = r.id
    WHERE t.error_code = 'PENDING_UPSTREAM'
      AND r.started_at > now() - interval '2 days'
  ),
  cand AS (
    SELECT 'ACTUACION'::text AS source_kind, 'work_item_acts'::text AS source_table,
           a.id AS source_id, a.work_item_id, w.client_id, w.radicado,
           COALESCE(w.title, w.radicado) AS caratula,
           a.act_date AS fact_date, a.description AS fact_text
    FROM work_item_acts a
    JOIN work_items w ON w.id = a.work_item_id
    WHERE w.organization_id = _org AND w.deleted_at IS NULL AND a.is_archived = false
      AND a.detected_at > now() - make_interval(days => _lookback_days)
    UNION ALL
    SELECT 'ESTADO', 'work_item_publicaciones', p.id, p.work_item_id, w.client_id, w.radicado,
           COALESCE(w.title, w.radicado), p.fecha_fijacion::date, COALESCE(p.title, p.annotation)
    FROM work_item_publicaciones p
    JOIN work_items w ON w.id = p.work_item_id
    WHERE w.organization_id = _org AND w.deleted_at IS NULL AND COALESCE(p.is_archived, false) = false
      AND p.detected_at > now() - make_interval(days => _lookback_days)
  )
  SELECT c.source_kind, c.source_table, c.source_id, c.work_item_id, c.client_id, cs.id,
         c.radicado, c.caratula, c.fact_date, c.fact_text,
         CASE
           WHEN c.client_id IS NULL THEN 'SIN_CLIENTE_VINCULADO'
           WHEN cs.id IS NULL THEN 'SIN_CONSENTIMIENTO_VIGENTE'
           WHEN c.fact_date IS NULL THEN 'SIN_FECHA_DEL_PROVEEDOR'
           WHEN COALESCE(btrim(c.fact_text), '') = '' THEN 'SIN_TEXTO_DEL_PROVEEDOR'
           WHEN bl.id IS NOT NULL THEN 'DOCUMENTO_EN_LISTA_DE_BLOQUEO'
           WHEN pend.work_item_id IS NOT NULL THEN 'CANAL_PENDING_UPSTREAM'
           ELSE NULL
         END
  FROM cand c
  LEFT JOIN client_wa_consent cs
    ON cs.client_id = c.client_id AND cs.revoked_at IS NULL
  LEFT JOIN client_wa_source_blocklist bl
    ON bl.source_table = c.source_table AND bl.source_id = c.source_id
  LEFT JOIN pend ON pend.work_item_id = c.work_item_id;
$$;

GRANT EXECUTE ON FUNCTION public.client_wa_candidates(uuid, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.client_wa_generate_drafts(_org uuid, _lookback_days int DEFAULT 7)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inserted int;
BEGIN
  IF NOT public.is_org_member(_org) THEN
    RAISE EXCEPTION 'not a member of this organization';
  END IF;

  UPDATE client_wa_drafts SET status = 'EXPIRED'
  WHERE organization_id = _org AND status = 'PENDING' AND expires_at < now();

  WITH ok AS (
    SELECT * FROM public.client_wa_candidates(_org, _lookback_days) WHERE reject_reason IS NULL
  ), ins AS (
    INSERT INTO client_wa_drafts (
      organization_id, client_id, work_item_id, consent_id, source_kind,
      source_table, source_id, fact_date, fact_text, body_text
    )
    SELECT _org, o.client_id, o.work_item_id, o.consent_id, o.source_kind,
           o.source_table, o.source_id, o.fact_date, o.fact_text,
           CASE WHEN o.source_kind = 'ACTUACION'
             THEN 'Se registró una actuación en su proceso el ' || to_char(o.fact_date, 'DD/MM/YYYY') || ': ' || btrim(o.fact_text)
             ELSE 'Se publicó un estado el ' || to_char(o.fact_date, 'DD/MM/YYYY') || ': ' || btrim(o.fact_text)
           END
    FROM ok o
    ON CONFLICT (source_table, source_id, client_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO inserted FROM ins;

  RETURN inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_wa_generate_drafts(uuid, int) TO authenticated, service_role;