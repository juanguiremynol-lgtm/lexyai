-- ============================================================
-- Iteration 40 — LABORAL rules from verified primary sources
-- ============================================================

-- 1. Richer rule semantics ------------------------------------------------
ALTER TABLE public.workflow_deadline_rules
  ADD COLUMN IF NOT EXISTS bound_party text,
  ADD COLUMN IF NOT EXISTS consequence text,
  ADD COLUMN IF NOT EXISTS is_judge_side boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'NO_VERIFICADA';

ALTER TABLE public.workflow_deadline_rules
  DROP CONSTRAINT IF EXISTS workflow_deadline_rules_verification_state_check;
ALTER TABLE public.workflow_deadline_rules
  ADD CONSTRAINT workflow_deadline_rules_verification_state_check
  CHECK (verification_state IN ('VERIFICADA_FUENTE_PRIMARIA', 'PENDIENTE_FUENTE_PRIMARIA', 'NO_VERIFICADA'));

-- A rule may only be ratified when its source was actually verified.
-- Rules ratified in earlier iterations were checked against primary sources by
-- the platform owner; record that before enforcing the invariant.
UPDATE public.workflow_deadline_rules
   SET verification_state = 'VERIFICADA_FUENTE_PRIMARIA'
 WHERE status = 'RATIFIED';

ALTER TABLE public.workflow_deadline_rules
  DROP CONSTRAINT IF EXISTS workflow_deadline_rules_ratified_needs_source;
ALTER TABLE public.workflow_deadline_rules
  ADD CONSTRAINT workflow_deadline_rules_ratified_needs_source
  CHECK (status <> 'RATIFIED' OR verification_state = 'VERIFICADA_FUENTE_PRIMARIA');

-- 2. New anchor: TIC electronic personal notification (Ley 2452 arts. 208/209)
ALTER TABLE public.workflow_deadline_rules
  DROP CONSTRAINT IF EXISTS workflow_deadline_rules_anchor_type_check;
ALTER TABLE public.workflow_deadline_rules
  ADD CONSTRAINT workflow_deadline_rules_anchor_type_check
  CHECK (anchor_type IN (
    'ANCHOR_AUDIENCIA',
    'ANCHOR_ACTO',
    'ANCHOR_NOTIFICACION',
    'ANCHOR_NOTIFICACION_TIC',
    'ANCHOR_EJECUTORIA',
    'ANCHOR_ORAL_EN_AUDIENCIA'
  ));

-- 3. Terms measured in months / years (Ley 2452 art. 324)
ALTER TABLE public.workflow_deadline_rules
  DROP CONSTRAINT IF EXISTS workflow_deadline_rules_day_type_check;
ALTER TABLE public.workflow_deadline_rules
  ADD CONSTRAINT workflow_deadline_rules_day_type_check
  CHECK (day_type IN ('BUSINESS', 'CALENDAR', 'MONTHS', 'YEARS', 'NONE'));

-- 4. REGLAS_FALTANTES — the register of terms we know exist but cannot verify
CREATE TABLE IF NOT EXISTS public.workflow_missing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type text NOT NULL,
  regimen text,
  /* Stable key, mirrors deadline_type so the UI can look it up by term. */
  deadline_type text NOT NULL,
  label text NOT NULL,
  /* Where the rule is expected to live, when we know it. */
  expected_citation text,
  /* Why it is not modelled: source unavailable, text not published, etc. */
  reason text NOT NULL,
  kind text NOT NULL DEFAULT 'PROCESAL',
  /* What the previous, unverified guess said — kept for the audit trail. */
  retired_guess jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_type, deadline_type)
);

ALTER TABLE public.workflow_missing_rules
  DROP CONSTRAINT IF EXISTS workflow_missing_rules_kind_check;
ALTER TABLE public.workflow_missing_rules
  ADD CONSTRAINT workflow_missing_rules_kind_check
  CHECK (kind IN ('PROCESAL', 'SUSTANCIAL'));

GRANT SELECT ON public.workflow_missing_rules TO authenticated;
GRANT ALL ON public.workflow_missing_rules TO service_role;

ALTER TABLE public.workflow_missing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "missing_rules_select_authenticated"
  ON public.workflow_missing_rules FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "missing_rules_admin_write"
  ON public.workflow_missing_rules FOR ALL TO authenticated
  USING (
    is_platform_admin_check(auth.uid())
    OR has_role(auth.uid(), 'owner'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    is_platform_admin_check(auth.uid())
    OR has_role(auth.uid(), 'owner'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  );

CREATE TRIGGER trg_workflow_missing_rules_updated_at
  BEFORE UPDATE ON public.workflow_missing_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_workflow_missing_rules_workflow
  ON public.workflow_missing_rules (workflow_type, regimen);