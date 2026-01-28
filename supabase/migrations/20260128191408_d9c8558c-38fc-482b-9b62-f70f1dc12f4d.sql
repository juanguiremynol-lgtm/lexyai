-- Add critical deadline tracking columns to work_item_publicaciones
ALTER TABLE work_item_publicaciones 
ADD COLUMN IF NOT EXISTS fecha_fijacion TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS fecha_desfijacion TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS despacho TEXT,
ADD COLUMN IF NOT EXISTS tipo_publicacion TEXT;

-- Index for efficient deadline queries
CREATE INDEX IF NOT EXISTS idx_publicaciones_desfijacion 
ON work_item_publicaciones(fecha_desfijacion DESC) 
WHERE fecha_desfijacion IS NOT NULL;

-- Critical documentation
COMMENT ON COLUMN work_item_publicaciones.fecha_desfijacion IS 
  'CRITICAL: Legal términos begin the business day AFTER this date';
COMMENT ON COLUMN work_item_publicaciones.fecha_fijacion IS 
  'When the estado was posted on the bulletin board';
COMMENT ON COLUMN work_item_publicaciones.despacho IS 
  'Court/authority name that issued the publication';
COMMENT ON COLUMN work_item_publicaciones.tipo_publicacion IS 
  'Type of publication (Estado, Edicto, Auto, etc.)';