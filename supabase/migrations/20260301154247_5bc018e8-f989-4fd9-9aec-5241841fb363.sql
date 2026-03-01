-- Fix 1: auto_generate_hearing_flow — cast workflow_type enum to text
CREATE OR REPLACE FUNCTION public.auto_generate_hearing_flow()
RETURNS TRIGGER AS $$
DECLARE
  flow_id UUID;
  tenant_config RECORD;
BEGIN
  BEGIN
    IF NEW.workflow_type::text IN ('PETICION', 'TUTELA') THEN
      RETURN NEW;
    END IF;

    SELECT * INTO tenant_config FROM hearing_tenant_config
    WHERE organization_id = NEW.organization_id;

    IF tenant_config IS NULL OR tenant_config.auto_generate_hearing_flow = true THEN
      SELECT id INTO flow_id FROM hearing_flow_templates
      WHERE jurisdiction = NEW.workflow_type::text
        AND is_default = true AND is_active = true
      ORDER BY process_subtype NULLS LAST
      LIMIT 1;

      IF flow_id IS NOT NULL THEN
        INSERT INTO work_item_hearings (
          organization_id, work_item_id, hearing_type_id, status, flow_order, created_by
        )
        SELECT
          NEW.organization_id, NEW.id, fts.hearing_type_id,
          'planned', fts.step_order, NEW.owner_id
        FROM hearing_flow_template_steps fts
        WHERE fts.flow_template_id = flow_id
        ORDER BY fts.step_order;
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] auto_generate_hearing_flow failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    BEGIN
      INSERT INTO trigger_error_log (trigger_name, table_name, error_message, sqlstate, work_item_id)
      VALUES ('auto_generate_hearing_flow', 'work_items', SQLERRM, SQLSTATE, NEW.id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;