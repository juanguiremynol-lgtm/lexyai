-- Add cpnu_confirmed flag to lock fields after CPNU verification
ALTER TABLE public.monitored_processes 
ADD COLUMN IF NOT EXISTS cpnu_confirmed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS cpnu_confirmed_at timestamp with time zone;

-- Add comment for documentation
COMMENT ON COLUMN public.monitored_processes.cpnu_confirmed IS 'Whether the process info has been verified by CPNU consultation';
COMMENT ON COLUMN public.monitored_processes.cpnu_confirmed_at IS 'Timestamp when CPNU confirmation occurred';