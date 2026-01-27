-- Create work_item_publicaciones table for storing court publications metadata
CREATE TABLE IF NOT EXISTS public.work_item_publicaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'publicaciones-procesales',
  title text NOT NULL,
  annotation text,
  pdf_url text,
  published_at timestamptz,
  hash_fingerprint text NOT NULL,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for efficient queries
CREATE INDEX idx_work_item_publicaciones_work_item_id ON public.work_item_publicaciones(work_item_id);
CREATE INDEX idx_work_item_publicaciones_org_id ON public.work_item_publicaciones(organization_id);
CREATE INDEX idx_work_item_publicaciones_published_at ON public.work_item_publicaciones(work_item_id, published_at DESC);
CREATE UNIQUE INDEX idx_work_item_publicaciones_dedupe ON public.work_item_publicaciones(work_item_id, hash_fingerprint);

-- Enable Row Level Security
ALTER TABLE public.work_item_publicaciones ENABLE ROW LEVEL SECURITY;

-- RLS policy: Org members can read publications for their org's work items
CREATE POLICY "Org members can view publications"
  ON public.work_item_publicaciones
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- RLS policy: Org admins or platform admins can insert (typically via Edge function service role)
CREATE POLICY "Org admins can insert publications"
  ON public.work_item_publicaciones
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_admin(organization_id) OR public.is_platform_admin()
  );

-- RLS policy: Org admins can update their org's publications
CREATE POLICY "Org admins can update publications"
  ON public.work_item_publicaciones
  FOR UPDATE
  TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- RLS policy: Org admins can delete their org's publications
CREATE POLICY "Org admins can delete publications"
  ON public.work_item_publicaciones
  FOR DELETE
  TO authenticated
  USING (public.is_org_admin(organization_id));

-- Add comment for documentation
COMMENT ON TABLE public.work_item_publicaciones IS 'Stores court publication metadata (estados electrónicos, edictos, PDFs) synced from external Publicaciones API for registered work items.';
COMMENT ON COLUMN public.work_item_publicaciones.hash_fingerprint IS 'Computed from stable fields (pdf_url + title + published_at) to prevent duplicates on repeated syncs.';
COMMENT ON COLUMN public.work_item_publicaciones.source IS 'Data source identifier, defaults to publicaciones-procesales.';