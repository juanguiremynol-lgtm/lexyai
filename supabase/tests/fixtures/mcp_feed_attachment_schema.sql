-- Local-only dependencies missing from the reduced authorization fixture.
ALTER TABLE organizations ADD type text;
CREATE FUNCTION fixture_source_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.detected_at := OLD.detected_at;
  RETURN NEW;
END $$;
CREATE TRIGGER fixture_revision BEFORE UPDATE ON work_item_acts FOR EACH ROW EXECUTE FUNCTION fixture_source_revision();
CREATE TRIGGER fixture_revision BEFORE UPDATE ON work_item_publicaciones FOR EACH ROW EXECUTE FUNCTION fixture_source_revision();