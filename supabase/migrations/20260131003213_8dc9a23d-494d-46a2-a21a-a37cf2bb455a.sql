-- Add columns for daily rate limiting and enhanced audit trail
-- 1. Add last_inference_date column to work_items for daily rate limiting
ALTER TABLE public.work_items 
ADD COLUMN IF NOT EXISTS last_inference_date date;

-- 2. Add index for efficient rate limit checking
CREATE INDEX IF NOT EXISTS idx_work_items_last_inference_date 
ON public.work_items (id, last_inference_date);

-- 3. Add audit columns to work_item_stage_suggestions for compliance
ALTER TABLE public.work_item_stage_suggestions
ADD COLUMN IF NOT EXISTS applied_by_user_id uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS applied_at timestamptz,
ADD COLUMN IF NOT EXISTS audit_log_id uuid;

-- 4. Create enum for stage change source if not exists
DO $$ BEGIN
    CREATE TYPE stage_change_source AS ENUM (
        'MANUAL_USER',           -- User directly changed stage (not from suggestion)
        'SUGGESTION_APPLIED',    -- User accepted a system suggestion
        'SUGGESTION_OVERRIDE',   -- User chose different stage when reviewing suggestion
        'IMPORT_INITIAL'         -- Initial stage set during import
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 5. Add stage change source tracking to work_items
ALTER TABLE public.work_items
ADD COLUMN IF NOT EXISTS last_stage_change_source text,
ADD COLUMN IF NOT EXISTS last_stage_change_at timestamptz,
ADD COLUMN IF NOT EXISTS last_stage_change_by_user_id uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS last_stage_suggestion_id uuid;

-- 6. Create comprehensive stage change audit table for compliance
CREATE TABLE IF NOT EXISTS public.work_item_stage_audit (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    actor_user_id uuid NOT NULL REFERENCES auth.users(id),
    
    -- Stage change details
    previous_stage text,
    previous_cgp_phase text,
    new_stage text,
    new_cgp_phase text,
    
    -- Source tracking for compliance verification
    change_source text NOT NULL, -- 'MANUAL_USER', 'SUGGESTION_APPLIED', 'SUGGESTION_OVERRIDE'
    suggestion_id uuid REFERENCES public.work_item_stage_suggestions(id),
    suggestion_confidence numeric,
    
    -- Audit metadata
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    ip_address text,
    user_agent text,
    
    -- Timestamps
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.work_item_stage_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Org members can read their org's audit records
CREATE POLICY "Org members can read stage audit"
ON public.work_item_stage_audit
FOR SELECT
USING (public.is_org_member(organization_id));

-- Only system/authenticated users can insert (via edge functions or frontend)
CREATE POLICY "Authenticated users can insert stage audit"
ON public.work_item_stage_audit
FOR INSERT
TO authenticated
WITH CHECK (actor_user_id = auth.uid());

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_work_item_stage_audit_work_item
ON public.work_item_stage_audit (work_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_item_stage_audit_org
ON public.work_item_stage_audit (organization_id, created_at DESC);

-- 7. Create function to check daily rate limit (in user's timezone)
CREATE OR REPLACE FUNCTION public.check_inference_rate_limit(
    p_work_item_id uuid,
    p_timezone text DEFAULT 'America/Bogota'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_last_inference_date date;
    v_today date;
    v_can_run boolean;
BEGIN
    -- Get today in the specified timezone
    v_today := (now() AT TIME ZONE p_timezone)::date;
    
    -- Get last inference date for this work item
    SELECT last_inference_date INTO v_last_inference_date
    FROM work_items
    WHERE id = p_work_item_id;
    
    -- Check if inference can run (null = never run, or different day)
    v_can_run := v_last_inference_date IS NULL OR v_last_inference_date < v_today;
    
    RETURN jsonb_build_object(
        'can_run', v_can_run,
        'last_run_date', v_last_inference_date,
        'today', v_today,
        'timezone', p_timezone
    );
END;
$$;

-- 8. Create function to record inference run (updates rate limit)
CREATE OR REPLACE FUNCTION public.record_inference_run(
    p_work_item_id uuid,
    p_timezone text DEFAULT 'America/Bogota'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_today date;
BEGIN
    v_today := (now() AT TIME ZONE p_timezone)::date;
    
    UPDATE work_items
    SET last_inference_date = v_today
    WHERE id = p_work_item_id;
    
    RETURN FOUND;
END;
$$;