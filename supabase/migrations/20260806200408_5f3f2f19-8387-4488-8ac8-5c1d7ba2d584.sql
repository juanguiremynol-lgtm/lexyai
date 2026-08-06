ALTER TABLE public.workflow_deadline_rules
  DROP CONSTRAINT IF EXISTS workflow_deadline_rules_day_type_check;

ALTER TABLE public.workflow_deadline_rules
  ADD CONSTRAINT workflow_deadline_rules_day_type_check
  CHECK (day_type = ANY (ARRAY['BUSINESS','CALENDAR','MONTHS','YEARS','NONE','UNSPECIFIED']));

ALTER TABLE public.workflow_deadline_rules
  ADD COLUMN IF NOT EXISTS antinomia_group text,
  ADD COLUMN IF NOT EXISTS antinomia_designated_rule_id uuid REFERENCES public.workflow_deadline_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS antinomia_designated_by uuid,
  ADD COLUMN IF NOT EXISTS antinomia_designated_at timestamptz,
  ADD COLUMN IF NOT EXISTS confidence text,
  ADD COLUMN IF NOT EXISTS days_amount_max integer,
  ADD COLUMN IF NOT EXISTS variant_days_amount integer,
  ADD COLUMN IF NOT EXISTS variant_condition text,
  ADD COLUMN IF NOT EXISTS procedure_variant text;

ALTER TABLE public.workflow_deadline_rules
  DROP CONSTRAINT IF EXISTS workflow_deadline_rules_confidence_check;
ALTER TABLE public.workflow_deadline_rules
  ADD CONSTRAINT workflow_deadline_rules_confidence_check
  CHECK (confidence IS NULL OR confidence = ANY (ARRAY['ALTA','MEDIA','BAJA']));

ALTER TABLE public.workflow_deadline_rules
  DROP CONSTRAINT IF EXISTS workflow_deadline_rules_unspecified_never_ratified;
ALTER TABLE public.workflow_deadline_rules
  ADD CONSTRAINT workflow_deadline_rules_unspecified_never_ratified
  CHECK (status <> 'RATIFIED' OR day_type <> 'UNSPECIFIED');

ALTER TABLE public.workflow_deadline_rules
  DROP CONSTRAINT IF EXISTS workflow_deadline_rules_designation_coherent;
ALTER TABLE public.workflow_deadline_rules
  ADD CONSTRAINT workflow_deadline_rules_designation_coherent
  CHECK (antinomia_designated_rule_id IS NULL OR (antinomia_group IS NOT NULL AND antinomia_designated_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_workflow_deadline_rules_antinomia
  ON public.workflow_deadline_rules(antinomia_group) WHERE antinomia_group IS NOT NULL;