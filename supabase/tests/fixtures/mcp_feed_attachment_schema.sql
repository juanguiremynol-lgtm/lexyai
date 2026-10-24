-- Local-only dependencies missing from the reduced authorization fixture.
ALTER TABLE organizations ADD type text;
ALTER TABLE work_item_stage_audit ADD previous_cgp_phase text, ADD new_cgp_phase text, ADD suggestion_id uuid;
CREATE TABLE workflow_stage_transitions(workflow_type text,active boolean,from_stage_code text,to_stage_code text,is_regression_allowed boolean);
GRANT SELECT ON work_item_stage_audit TO authenticated;
CREATE FUNCTION fixture_source_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.detected_at := OLD.detected_at;
  RETURN NEW;
END $$;
CREATE TRIGGER fixture_revision BEFORE UPDATE ON work_item_acts FOR EACH ROW EXECUTE FUNCTION fixture_source_revision();
CREATE TRIGGER fixture_revision BEFORE UPDATE ON work_item_publicaciones FOR EACH ROW EXECUTE FUNCTION fixture_source_revision();