-- Add process_type column to monitored_processes to distinguish judicial vs administrative
ALTER TABLE public.monitored_processes 
ADD COLUMN IF NOT EXISTS process_type text NOT NULL DEFAULT 'JUDICIAL';

-- Add administrative-specific fields
ALTER TABLE public.monitored_processes 
ADD COLUMN IF NOT EXISTS autoridad text,
ADD COLUMN IF NOT EXISTS entidad text,
ADD COLUMN IF NOT EXISTS dependencia text,
ADD COLUMN IF NOT EXISTS expediente_administrativo text,
ADD COLUMN IF NOT EXISTS tipo_actuacion text,
ADD COLUMN IF NOT EXISTS correo_autoridad text,
ADD COLUMN IF NOT EXISTS admin_phase text;

-- Create index for efficient querying by process type
CREATE INDEX IF NOT EXISTS idx_monitored_processes_process_type 
ON public.monitored_processes(process_type);

-- Add comment for documentation
COMMENT ON COLUMN public.monitored_processes.process_type IS 'JUDICIAL or ADMINISTRATIVE';
COMMENT ON COLUMN public.monitored_processes.autoridad IS 'Administrative authority name (e.g., Secretaría de Movilidad)';
COMMENT ON COLUMN public.monitored_processes.entidad IS 'Entity handling the case';
COMMENT ON COLUMN public.monitored_processes.dependencia IS 'Specific department/office';
COMMENT ON COLUMN public.monitored_processes.expediente_administrativo IS 'Administrative case number (may differ from radicado)';
COMMENT ON COLUMN public.monitored_processes.tipo_actuacion IS 'Type: policivo, sancionatorio, tránsito, disciplinario, etc.';
COMMENT ON COLUMN public.monitored_processes.correo_autoridad IS 'Official notification email of the authority';
COMMENT ON COLUMN public.monitored_processes.admin_phase IS 'Phase for administrative processes';