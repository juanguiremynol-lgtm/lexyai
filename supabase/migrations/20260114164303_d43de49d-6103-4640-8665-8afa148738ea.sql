-- =============================================================================
-- CPACA (Contencioso Administrativo) - Database Schema Extension
-- =============================================================================

-- 1. Create CPACA-related enums
CREATE TYPE cpaca_medio_control AS ENUM (
  'NULIDAD_RESTABLECIMIENTO',
  'NULIDAD_SIMPLE',
  'REPARACION_DIRECTA',
  'CONTROVERSIAS_CONTRACTUALES',
  'NULIDAD_ELECTORAL',
  'REPETICION',
  'OTRO'
);

CREATE TYPE cpaca_phase AS ENUM (
  'PRECONTENCIOSO',
  'DEMANDA_POR_RADICAR',
  'DEMANDA_RADICADA',
  'AUTO_ADMISORIO',
  'NOTIFICACION_TRASLADOS',
  'TRASLADO_DEMANDA',
  'REFORMA_DEMANDA',
  'TRASLADO_EXCEPCIONES',
  'AUDIENCIA_INICIAL',
  'AUDIENCIA_PRUEBAS',
  'ALEGATOS_SENTENCIA',
  'RECURSOS',
  'EJECUCION_CUMPLIMIENTO',
  'ARCHIVADO'
);

CREATE TYPE cpaca_estado_caducidad AS ENUM (
  'EN_TERMINO',
  'RIESGO',
  'VENCIDO',
  'NO_APLICA'
);

CREATE TYPE cpaca_estado_conciliacion AS ENUM (
  'PENDIENTE',
  'PROGRAMADA',
  'CELEBRADA_SIN_ACUERDO',
  'CON_ACUERDO',
  'CONSTANCIA_EXPEDIDA'
);

-- 2. Create CPACA Processes table
CREATE TABLE public.cpaca_processes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  monitored_process_id UUID REFERENCES public.monitored_processes(id) ON DELETE SET NULL,
  
  -- Identification
  radicado VARCHAR(50),
  titulo VARCHAR(500),
  descripcion TEXT,
  medio_de_control cpaca_medio_control NOT NULL DEFAULT 'OTRO',
  medio_de_control_custom VARCHAR(200),
  
  -- Pre-requisites
  conciliacion_requisito BOOLEAN NOT NULL DEFAULT false,
  agotamiento_via_gubernativa BOOLEAN NOT NULL DEFAULT false,
  acto_administrativo_fecha DATE,
  acto_administrativo_notificacion_fecha DATE,
  
  -- Court information
  despacho_nombre VARCHAR(300),
  despacho_ciudad VARCHAR(100),
  despacho_email VARCHAR(200),
  juez_ponente VARCHAR(200),
  
  -- Parties
  demandantes TEXT,
  demandados TEXT,
  
  -- Phase/Status
  phase cpaca_phase NOT NULL DEFAULT 'PRECONTENCIOSO',
  
  -- Conciliation tracking
  estado_conciliacion cpaca_estado_conciliacion DEFAULT 'PENDIENTE',
  fecha_radicacion_conciliacion DATE,
  fecha_limite_conciliacion DATE, -- Calculated: +3 months from radicacion
  
  -- Caducidad tracking
  fecha_hecho_danoso DATE, -- For Reparación Directa
  fecha_evento_caducidad_base DATE,
  fecha_vencimiento_caducidad DATE, -- Calculated
  estado_caducidad cpaca_estado_caducidad DEFAULT 'NO_APLICA',
  
  -- Key process dates
  fecha_radicacion_demanda DATE,
  fecha_auto_admisorio DATE,
  fecha_auto_inadmision DATE,
  fecha_auto_rechazo DATE,
  
  -- Notification dates (Art. 199 CPACA)
  fecha_envio_notificacion_electronica DATE,
  fecha_constancia_acceso DATE,
  fecha_inicio_termino DATE, -- Calculated: 2 business days + next day
  
  -- Traslado demanda
  prorroga_traslado_demanda BOOLEAN NOT NULL DEFAULT false,
  fecha_vencimiento_traslado_demanda DATE, -- Calculated
  fecha_contestacion_demanda DATE,
  
  -- Reforma demanda
  fecha_vencimiento_reforma DATE, -- Calculated
  fecha_presentacion_reforma DATE,
  
  -- Excepciones
  fecha_notificacion_excepciones DATE,
  fecha_vencimiento_traslado_excepciones DATE, -- Calculated
  fecha_respuesta_excepciones DATE,
  
  -- Audiencias
  fecha_audiencia_inicial DATE,
  hora_audiencia_inicial TIME,
  lugar_audiencia_inicial VARCHAR(300),
  link_audiencia_inicial VARCHAR(500),
  
  fecha_audiencia_pruebas DATE,
  hora_audiencia_pruebas TIME,
  lugar_audiencia_pruebas VARCHAR(300),
  link_audiencia_pruebas VARCHAR(500),
  
  fecha_audiencia_juzgamiento DATE,
  hora_audiencia_juzgamiento TIME,
  
  -- Sentencia
  fecha_sentencia DATE,
  sentencia_favorable BOOLEAN,
  fecha_notificacion_sentencia DATE,
  fecha_vencimiento_apelacion_sentencia DATE, -- Calculated
  
  -- Autos
  fecha_notificacion_auto DATE,
  fecha_vencimiento_apelacion_auto DATE, -- Calculated
  
  -- Resources/Appeals
  fecha_interposicion_recurso DATE,
  tipo_recurso VARCHAR(100),
  fecha_resolucion_recurso DATE,
  
  -- Execution
  fecha_ejecutoria DATE,
  fecha_inicio_ejecucion DATE,
  
  -- Notes
  notas TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 3. Create indexes
CREATE INDEX idx_cpaca_processes_owner_id ON public.cpaca_processes(owner_id);
CREATE INDEX idx_cpaca_processes_client_id ON public.cpaca_processes(client_id);
CREATE INDEX idx_cpaca_processes_phase ON public.cpaca_processes(phase);
CREATE INDEX idx_cpaca_processes_radicado ON public.cpaca_processes(radicado);
CREATE INDEX idx_cpaca_processes_estado_caducidad ON public.cpaca_processes(estado_caducidad);

-- 4. Enable RLS
ALTER TABLE public.cpaca_processes ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS policies
CREATE POLICY "Users can view their own CPACA processes"
  ON public.cpaca_processes
  FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own CPACA processes"
  ON public.cpaca_processes
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own CPACA processes"
  ON public.cpaca_processes
  FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own CPACA processes"
  ON public.cpaca_processes
  FOR DELETE
  USING (auth.uid() = owner_id);

-- 6. Create updated_at trigger
CREATE TRIGGER update_cpaca_processes_updated_at
  BEFORE UPDATE ON public.cpaca_processes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Create CPACA-specific alert rules table extension
-- (We'll use the existing alert_rules table with entity_type = 'CPACA')

-- 8. Create Colombian holidays table for term calculations (if not exists)
CREATE TABLE IF NOT EXISTS public.colombian_holidays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  is_judicial_vacation BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert 2024-2026 Colombian holidays
INSERT INTO public.colombian_holidays (holiday_date, name, is_judicial_vacation) VALUES
-- 2024
('2024-01-01', 'Año Nuevo', false),
('2024-01-08', 'Día de los Reyes Magos', false),
('2024-03-25', 'Día de San José', false),
('2024-03-28', 'Jueves Santo', false),
('2024-03-29', 'Viernes Santo', false),
('2024-05-01', 'Día del Trabajo', false),
('2024-05-13', 'Ascensión del Señor', false),
('2024-06-03', 'Corpus Christi', false),
('2024-06-10', 'Sagrado Corazón', false),
('2024-07-01', 'San Pedro y San Pablo', false),
('2024-07-20', 'Día de la Independencia', false),
('2024-08-07', 'Batalla de Boyacá', false),
('2024-08-19', 'La Asunción', false),
('2024-10-14', 'Día de la Raza', false),
('2024-11-04', 'Todos los Santos', false),
('2024-11-11', 'Independencia de Cartagena', false),
('2024-12-25', 'Navidad', false),
-- 2025
('2025-01-01', 'Año Nuevo', false),
('2025-01-06', 'Día de los Reyes Magos', false),
('2025-03-24', 'Día de San José', false),
('2025-04-17', 'Jueves Santo', false),
('2025-04-18', 'Viernes Santo', false),
('2025-05-01', 'Día del Trabajo', false),
('2025-06-02', 'Ascensión del Señor', false),
('2025-06-23', 'Corpus Christi', false),
('2025-06-30', 'Sagrado Corazón', false),
('2025-06-30', 'San Pedro y San Pablo', false),
('2025-07-20', 'Día de la Independencia', false),
('2025-08-07', 'Batalla de Boyacá', false),
('2025-08-18', 'La Asunción', false),
('2025-10-13', 'Día de la Raza', false),
('2025-11-03', 'Todos los Santos', false),
('2025-11-17', 'Independencia de Cartagena', false),
('2025-12-08', 'Inmaculada Concepción', false),
('2025-12-25', 'Navidad', false),
-- 2026
('2026-01-01', 'Año Nuevo', false),
('2026-01-12', 'Día de los Reyes Magos', false),
('2026-03-23', 'Día de San José', false),
('2026-04-02', 'Jueves Santo', false),
('2026-04-03', 'Viernes Santo', false),
('2026-05-01', 'Día del Trabajo', false),
('2026-05-18', 'Ascensión del Señor', false),
('2026-06-08', 'Corpus Christi', false),
('2026-06-15', 'Sagrado Corazón', false),
('2026-06-29', 'San Pedro y San Pablo', false),
('2026-07-20', 'Día de la Independencia', false),
('2026-08-07', 'Batalla de Boyacá', false),
('2026-08-17', 'La Asunción', false),
('2026-10-12', 'Día de la Raza', false),
('2026-11-02', 'Todos los Santos', false),
('2026-11-16', 'Independencia de Cartagena', false),
('2026-12-08', 'Inmaculada Concepción', false),
('2026-12-25', 'Navidad', false)
ON CONFLICT (holiday_date) DO NOTHING;

-- Enable RLS on holidays
ALTER TABLE public.colombian_holidays ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read holidays
CREATE POLICY "Everyone can read holidays"
  ON public.colombian_holidays
  FOR SELECT
  TO authenticated
  USING (true);