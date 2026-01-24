-- Add ticker settings to organizations table
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS show_estados_ticker BOOLEAN NOT NULL DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN public.organizations.show_estados_ticker IS 'Whether to show the live estados ticker in the UI';

-- Create an index on work_item_acts for efficient ticker queries
CREATE INDEX IF NOT EXISTS idx_work_item_acts_created_at_desc 
ON public.work_item_acts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_item_acts_act_date_desc 
ON public.work_item_acts(act_date DESC NULLS LAST);