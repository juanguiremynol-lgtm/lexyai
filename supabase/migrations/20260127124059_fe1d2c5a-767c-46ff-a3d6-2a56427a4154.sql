-- Add FK constraint to ensure organization_id integrity in work_item_publicaciones
-- This ensures organization_id always references a valid organization

-- First, check if the FK already exists and add if not
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'work_item_publicaciones_organization_id_fkey'
    AND table_name = 'work_item_publicaciones'
  ) THEN
    ALTER TABLE public.work_item_publicaciones
    ADD CONSTRAINT work_item_publicaciones_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create a trigger to auto-set organization_id from parent work_item on insert
-- This provides defense-in-depth even if Edge Function sets it correctly
CREATE OR REPLACE FUNCTION public.set_publicacion_org_from_work_item()
RETURNS TRIGGER AS $$
BEGIN
  -- Always derive organization_id from the parent work_item
  SELECT organization_id INTO NEW.organization_id
  FROM public.work_items
  WHERE id = NEW.work_item_id;
  
  -- If work_item not found, fail the insert
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'work_item_id % does not exist or has no organization_id', NEW.work_item_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_set_publicacion_org ON public.work_item_publicaciones;

CREATE TRIGGER trg_set_publicacion_org
BEFORE INSERT ON public.work_item_publicaciones
FOR EACH ROW
EXECUTE FUNCTION public.set_publicacion_org_from_work_item();