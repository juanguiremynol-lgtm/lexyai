-- Function to merge sources[] arrays on conflict, preserving provenance additively.
-- Called via upsert trigger or directly.
CREATE OR REPLACE FUNCTION public.merge_act_sources()
RETURNS TRIGGER AS $$
BEGIN
  -- If row already exists (UPDATE path of upsert), merge sources
  IF OLD.sources IS NOT NULL AND NEW.sources IS NOT NULL THEN
    -- Combine both arrays and deduplicate
    SELECT ARRAY(
      SELECT DISTINCT unnest 
      FROM unnest(OLD.sources || NEW.sources) AS unnest
      ORDER BY unnest
    ) INTO NEW.sources;
  END IF;
  
  -- Also update scrape_date to latest
  IF OLD.scrape_date IS NOT NULL AND NEW.scrape_date IS NOT NULL THEN
    NEW.scrape_date = GREATEST(OLD.scrape_date, NEW.scrape_date);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to work_item_acts for ON CONFLICT UPDATE path
DROP TRIGGER IF EXISTS trg_merge_act_sources ON public.work_item_acts;
CREATE TRIGGER trg_merge_act_sources
  BEFORE UPDATE ON public.work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION public.merge_act_sources();