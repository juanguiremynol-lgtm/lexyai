-- ============================================================
-- Iteration 20 — GCP→Supabase bridge integrity
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bridge_inventory_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  radicado text,
  provider_key text NOT NULL,
  row_kind text NOT NULL DEFAULT 'ACT',           -- ACT | PUB
  provider_count integer NOT NULL DEFAULT 0,
  local_count integer NOT NULL DEFAULT 0,
  missing_count integer NOT NULL DEFAULT 0,
  recovered_count integer NOT NULL DEFAULT 0,
  -- IN_SYNC | GAP | PROVIDER_NO_ROWS | TRANSFER_FAILED | PROVIDER_UNAVAILABLE
  transfer_state text NOT NULL DEFAULT 'IN_SYNC',
  missing_fingerprints jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  first_gap_at timestamptz,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bridge_inventory_ledger_unique UNIQUE (work_item_id, provider_key, row_kind)
);

CREATE INDEX IF NOT EXISTS idx_bridge_ledger_state ON public.bridge_inventory_ledger(transfer_state, first_gap_at);
CREATE INDEX IF NOT EXISTS idx_bridge_ledger_wi ON public.bridge_inventory_ledger(work_item_id);

GRANT SELECT ON public.bridge_inventory_ledger TO authenticated;
GRANT ALL ON public.bridge_inventory_ledger TO service_role;
ALTER TABLE public.bridge_inventory_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read bridge ledger"
  ON public.bridge_inventory_ledger FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE TRIGGER trg_bridge_ledger_updated_at
  BEFORE UPDATE ON public.bridge_inventory_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- Per-radicado, per-provider source health (GCP-emitted signals)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_source_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
  radicado text NOT NULL,
  provider_key text NOT NULL,
  last_run_at timestamptz,
  last_row_emitted_at timestamptz,
  consecutive_empty_runs integer NOT NULL DEFAULT 0,
  -- NULL | PROVIDER_JOB_FAILED | PROVIDER_NEVER_COMPLETES | PROVIDER_UNKNOWN_PROCESS
  terminal_state text,
  coverage_suspect boolean NOT NULL DEFAULT false,
  coverage_suspect_note text,
  parse_mismatch_count integer NOT NULL DEFAULT 0,
  parse_mismatch_note text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_source_health_unique UNIQUE (radicado, provider_key)
);

CREATE INDEX IF NOT EXISTS idx_source_health_suspect ON public.provider_source_health(coverage_suspect) WHERE coverage_suspect;
CREATE INDEX IF NOT EXISTS idx_source_health_terminal ON public.provider_source_health(terminal_state) WHERE terminal_state IS NOT NULL;

GRANT SELECT ON public.provider_source_health TO authenticated;
GRANT ALL ON public.provider_source_health TO service_role;
ALTER TABLE public.provider_source_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read source health"
  ON public.provider_source_health FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY "Members read source health of their work items"
  ON public.provider_source_health FOR SELECT TO authenticated
  USING (
    work_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.work_items wi
      WHERE wi.id = provider_source_health.work_item_id
        AND wi.organization_id = public.get_user_organization_id()
    )
  );

CREATE TRIGGER trg_source_health_updated_at
  BEFORE UPDATE ON public.provider_source_health
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- OCR provenance on ingested rows
-- ------------------------------------------------------------
ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS origen_texto text,
  ADD COLUMN IF NOT EXISTS requiere_revision_manual boolean NOT NULL DEFAULT false;

ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS origen_texto text,
  ADD COLUMN IF NOT EXISTS requiere_revision_manual boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- Admin summary: gaps open for more than 24h
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bridge_gap_summary(_min_hours integer DEFAULT 24)
RETURNS TABLE (
  work_item_id uuid,
  radicado text,
  provider_key text,
  row_kind text,
  provider_count integer,
  local_count integer,
  missing_count integer,
  transfer_state text,
  hours_open numeric,
  last_checked_at timestamptz,
  last_error text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.work_item_id, b.radicado, b.provider_key, b.row_kind,
         b.provider_count, b.local_count, b.missing_count, b.transfer_state,
         ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(b.first_gap_at, b.last_checked_at))) / 3600.0, 1),
         b.last_checked_at, b.last_error
    FROM public.bridge_inventory_ledger b
   WHERE b.transfer_state IN ('GAP','TRANSFER_FAILED','PROVIDER_UNAVAILABLE')
     AND b.first_gap_at IS NOT NULL
     AND b.first_gap_at < now() - make_interval(hours => GREATEST(_min_hours, 0))
     AND public.is_platform_admin()
   ORDER BY b.missing_count DESC, b.first_gap_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.bridge_gap_summary(integer) TO authenticated;