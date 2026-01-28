-- Add SAMAI-specific columns to work_items table
ALTER TABLE public.work_items
ADD COLUMN IF NOT EXISTS ponente text,
ADD COLUMN IF NOT EXISTS origen text,
ADD COLUMN IF NOT EXISTS clase_proceso text,
ADD COLUMN IF NOT EXISTS etapa text,
ADD COLUMN IF NOT EXISTS ubicacion_expediente text,
ADD COLUMN IF NOT EXISTS formato_expediente text,
ADD COLUMN IF NOT EXISTS tipo_proceso text,
ADD COLUMN IF NOT EXISTS subclase_proceso text,
ADD COLUMN IF NOT EXISTS tipo_recurso text,
ADD COLUMN IF NOT EXISTS naturaleza_proceso text,
ADD COLUMN IF NOT EXISTS asunto text,
ADD COLUMN IF NOT EXISTS medida_cautelar text,
ADD COLUMN IF NOT EXISTS ministerio_publico text,
ADD COLUMN IF NOT EXISTS fecha_radicado date,
ADD COLUMN IF NOT EXISTS fecha_presenta_demanda date,
ADD COLUMN IF NOT EXISTS fecha_para_sentencia date,
ADD COLUMN IF NOT EXISTS fecha_sentencia text,
ADD COLUMN IF NOT EXISTS total_sujetos_procesales integer DEFAULT 0;

-- Add SAMAI-specific columns to actuaciones table  
ALTER TABLE public.actuaciones
ADD COLUMN IF NOT EXISTS fecha_registro timestamp with time zone,
ADD COLUMN IF NOT EXISTS estado text,
ADD COLUMN IF NOT EXISTS anexos_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS indice text;

-- Add comments to document these fields
COMMENT ON COLUMN public.work_items.ponente IS 'Judge/Ponente from SAMAI - e.g. "JUEZ 3 ADMINISTRATIVO ORAL DE MEDELLIN"';
COMMENT ON COLUMN public.work_items.origen IS 'Origin court from SAMAI - e.g. "Juzgado 003 Administrativo DE MEDELLIN"';
COMMENT ON COLUMN public.work_items.clase_proceso IS 'Process class from SAMAI - e.g. "ACCION DE NULIDAD"';
COMMENT ON COLUMN public.work_items.etapa IS 'Current stage from SAMAI - e.g. "Admisión"';
COMMENT ON COLUMN public.work_items.ubicacion_expediente IS 'Physical file location from SAMAI - e.g. "Archivo"';
COMMENT ON COLUMN public.work_items.formato_expediente IS 'File format from SAMAI - e.g. "Híbrido por digitalizar"';
COMMENT ON COLUMN public.work_items.tipo_proceso IS 'Process type from SAMAI - e.g. "ORDINARIO"';
COMMENT ON COLUMN public.work_items.ministerio_publico IS 'Public ministry representative from SAMAI sujetos';
COMMENT ON COLUMN public.work_items.total_sujetos_procesales IS 'Total number of procedural subjects (sujetos) from provider';
COMMENT ON COLUMN public.actuaciones.fecha_registro IS 'Registration date/time from SAMAI (fechaRegistro)';
COMMENT ON COLUMN public.actuaciones.estado IS 'Actuacion status from SAMAI - e.g. "REGISTRADA", "CLASIFICADA"';
COMMENT ON COLUMN public.actuaciones.anexos_count IS 'Number of attachments (anexos) from SAMAI';
COMMENT ON COLUMN public.actuaciones.indice IS 'Index/order number from SAMAI - e.g. "00001"';