-- Add work_item_id and organization_id to hearings table
-- Keep filing_id and cpaca_process_id as deprecated nullable fields during transition

-- Add new columns
ALTER TABLE public.hearings 
ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_hearings_work_item_id ON public.hearings(work_item_id);
CREATE INDEX IF NOT EXISTS idx_hearings_organization_id ON public.hearings(organization_id);
CREATE INDEX IF NOT EXISTS idx_hearings_scheduled_at ON public.hearings(scheduled_at);

-- Create function to get user's organization_id
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Drop existing RLS policies if they exist (to recreate with proper organization_id scoping)
DROP POLICY IF EXISTS "Users can view own hearings" ON public.hearings;
DROP POLICY IF EXISTS "Users can create own hearings" ON public.hearings;
DROP POLICY IF EXISTS "Users can update own hearings" ON public.hearings;
DROP POLICY IF EXISTS "Users can delete own hearings" ON public.hearings;

-- Enable RLS
ALTER TABLE public.hearings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies using organization_id
CREATE POLICY "Users can view hearings in their organization" 
ON public.hearings 
FOR SELECT 
USING (
  organization_id = public.get_user_organization_id()
  OR owner_id = auth.uid()
);

CREATE POLICY "Users can create hearings in their organization" 
ON public.hearings 
FOR INSERT 
WITH CHECK (
  (organization_id = public.get_user_organization_id() OR organization_id IS NULL)
  AND owner_id = auth.uid()
);

CREATE POLICY "Users can update hearings in their organization" 
ON public.hearings 
FOR UPDATE 
USING (
  organization_id = public.get_user_organization_id()
  OR owner_id = auth.uid()
);

CREATE POLICY "Users can delete hearings in their organization" 
ON public.hearings 
FOR DELETE 
USING (
  organization_id = public.get_user_organization_id()
  OR owner_id = auth.uid()
);