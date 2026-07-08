
-- 1) Provenance columns on canonical hearings table
ALTER TABLE public.work_item_hearings
  ADD COLUMN IF NOT EXISTS auto_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_act_id uuid,
  ADD COLUMN IF NOT EXISTS extraction_method text,
  ADD COLUMN IF NOT EXISTS time_inferred boolean,
  ADD COLUMN IF NOT EXISTS discovery_type text;

COMMENT ON TABLE public.work_item_hearings IS
  'CANONICAL hearings table for UI (Audiencias tab). Auto-extracted from acts by sync-by-work-item. Legacy public.hearings is deprecated.';

-- 2) Dedupe safety for auto-extracted rows
CREATE UNIQUE INDEX IF NOT EXISTS uq_wih_auto_wi_time
  ON public.work_item_hearings (work_item_id, scheduled_at)
  WHERE auto_detected = true AND scheduled_at IS NOT NULL;

-- 3) Migrate the 2 legacy rows for WI 7b038fac (Medellín, rad 05001400301120240210000)
--    status remap: 'scheduled' -> 'scheduled', 'suspended' -> 'cancelled'
INSERT INTO public.work_item_hearings (
  organization_id, work_item_id, custom_name, status,
  scheduled_at, auto_detected, source_act_id, extraction_method,
  time_inferred, discovery_type
)
SELECT
  h.organization_id,
  h.work_item_id,
  h.title,
  CASE h.status
    WHEN 'scheduled' THEN 'scheduled'
    WHEN 'suspended' THEN 'cancelled'
    WHEN 'superseded' THEN 'cancelled'
    WHEN 'past' THEN 'held'
    ELSE 'scheduled'
  END,
  h.scheduled_at,
  COALESCE(h.auto_detected, true),
  h.source_act_id,
  COALESCE(h.extraction_method, 'act_regex_v1_legacy_migration'),
  COALESCE(h.time_inferred, false),
  COALESCE(h.discovery_type, CASE WHEN h.scheduled_at >= now() THEN 'NOVEDAD' ELSE 'HISTORICO_DETECTADO' END)
FROM public.hearings h
WHERE h.work_item_id = '7b038fac-f82a-4619-8c10-fe1fe22b8d57'
  AND NOT EXISTS (
    SELECT 1 FROM public.work_item_hearings w
    WHERE w.work_item_id = h.work_item_id AND w.scheduled_at = h.scheduled_at
  );

-- 4) Backfill the 23-oct-2026 hearing detected in WI 31a847d9 (CGP)
INSERT INTO public.work_item_hearings (
  organization_id, work_item_id, custom_name, status,
  scheduled_at, auto_detected, extraction_method, time_inferred, discovery_type
)
SELECT
  wi.organization_id,
  wi.id,
  'Audiencia Inicial e Instrucción y Juzgamiento',
  'scheduled',
  -- 2026-10-23 09:00 America/Bogota = 14:00 UTC
  '2026-10-23 14:00:00+00'::timestamptz,
  true,
  'act_regex_v2_backfill',
  false,
  'NOVEDAD'
FROM public.work_items wi
WHERE wi.id = '31a847d9-5679-430e-b077-c178cda7bf66'
  AND NOT EXISTS (
    SELECT 1 FROM public.work_item_hearings w
    WHERE w.work_item_id = wi.id
      AND w.scheduled_at = '2026-10-23 14:00:00+00'::timestamptz
  );
