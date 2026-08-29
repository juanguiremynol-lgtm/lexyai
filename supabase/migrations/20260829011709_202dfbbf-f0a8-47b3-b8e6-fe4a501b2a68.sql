CREATE TABLE public.manual_court_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  work_item_id uuid references public.work_items(id) on delete set null,
  radicado text,
  despacho_prefix text,
  despacho_label text,
  scope text not null check (scope in ('MATTER','DESPACHO')),
  finding_kind text not null check (finding_kind in (
    'CORTE_VERIFICADA_SIN_PUBLICACION',
    'DESPACHO_NO_PUBLICA_ESTADOS',
    'PROCESO_PRIVADO',
    'RADICADO_EXISTE_SIN_ACTUACIONES'
  )),
  -- IT2 / S3: provenance is pinned. A human portal check can never be read as
  -- evidence the system observed, and never feeds the derived despacho_profiles.
  provenance text not null default 'VERIFICACION_MANUAL_PORTAL'
    check (provenance = 'VERIFICACION_MANUAL_PORTAL'),
  source_detail text not null,
  verified_on date not null,
  verified_by text not null,
  note text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

COMMENT ON TABLE public.manual_court_findings IS
  'IT2 — findings established by a human checking the Rama Judicial portals. Read-only evidence for display and for notice copy. It MUST NOT be written into despacho_profiles or any derived table, and MUST NOT produce a pause, a term or a state change.';

CREATE INDEX manual_court_findings_wi_idx ON public.manual_court_findings(work_item_id);
CREATE INDEX manual_court_findings_prefix_idx ON public.manual_court_findings(despacho_prefix);

GRANT SELECT ON public.manual_court_findings TO authenticated;
GRANT ALL ON public.manual_court_findings TO service_role;

ALTER TABLE public.manual_court_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read manual court findings"
  ON public.manual_court_findings FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT om.organization_id FROM public.organization_memberships om WHERE om.user_id = auth.uid()
    )
  );

CREATE POLICY "platform admins manage manual court findings"
  ON public.manual_court_findings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()));

CREATE TRIGGER manual_court_findings_touch
  BEFORE UPDATE ON public.manual_court_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();