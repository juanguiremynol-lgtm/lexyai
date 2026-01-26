-- Step 1: Add PENAL_906 to workflow_type enum
ALTER TYPE public.workflow_type ADD VALUE IF NOT EXISTS 'PENAL_906';