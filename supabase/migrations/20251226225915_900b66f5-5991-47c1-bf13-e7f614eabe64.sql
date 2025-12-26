-- =====================================================
-- CGP TERMS ENGINE - Database Schema
-- =====================================================

-- Enum for milestone types
CREATE TYPE public.cgp_milestone_type AS ENUM (
  -- General
  'DEMANDA_RADICADA',
  'AUTO_ADMISORIO_NOTIFICADO',
  'MANDAMIENTO_EJECUTIVO_NOTIFICADO',
  'REQUERIMIENTO_PAGO_NOTIFICADO',
  'TRASLADO_EXCEPCIONES_NOTIFICADO',
  'TRASLADO_DEMANDA_NOTIFICADO',
  'CONTESTACION_PRESENTADA',
  'EXCEPCIONES_PROPUESTAS',
  'EXCEPCIONES_RESUELTAS',
  'RECURSO_REPOSICION_INTERPUESTO',
  'RECURSO_REPOSICION_RESUELTO',
  'RECURSO_APELACION_INTERPUESTO',
  'RECURSO_APELACION_CONCEDIDO',
  'RECURSO_APELACION_RESUELTO',
  'RECURSO_SUPLICA_INTERPUESTO',
  'RECURSO_QUEJA_INTERPUESTO',
  'EXPEDIENTE_AL_DESPACHO',
  'EXPEDIENTE_A_SECRETARIA',
  'AUDIENCIA_PROGRAMADA',
  'AUDIENCIA_CELEBRADA',
  'SENTENCIA_PRIMERA_INSTANCIA',
  'SENTENCIA_SEGUNDA_INSTANCIA',
  'EXPEDIENTE_RECIBIDO_SUPERIOR',
  'ULTIMA_ACTUACION',
  'SILENCIO_DEUDOR',
  'OPOSICION_MONITORIO',
  'EMBARGO_SECUESTRO_PRACTICADO',
  'SENTENCIA_EJECUTORIA',
  'AVALUO_BIENES',
  'CUSTOM'
);

-- Enum for term status
CREATE TYPE public.cgp_term_status AS ENUM (
  'PENDING',
  'RUNNING',
  'PAUSED',
  'EXPIRED',
  'SATISFIED',
  'NOT_APPLICABLE',
  'INTERRUPTED'
);

-- Enum for start rule
CREATE TYPE public.cgp_start_rule AS ENUM (
  'NEXT_DAY_AFTER_NOTIFICATION',
  'SAME_DAY_IN_AUDIENCE',
  'NEXT_DAY_AFTER_LAST_NOTIFICATION',
  'IMMEDIATE'
);

-- Enum for duration unit
CREATE TYPE public.cgp_duration_unit AS ENUM (
  'BUSINESS_DAYS',
  'CALENDAR_DAYS',
  'MONTHS',
  'YEARS'
);

-- Enum for process type
CREATE TYPE public.cgp_process_type AS ENUM (
  'VERBAL',
  'VERBAL_SUMARIO',
  'MONITORIO',
  'EJECUTIVO',
  'EJECUTIVO_HIPOTECARIO',
  'RECURSOS',
  'GENERAL'
);

-- =====================================================
-- Table: cgp_milestones (Hitos procesales)
-- =====================================================
CREATE TABLE public.cgp_milestones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Can be linked to a filing or a monitored process
  filing_id UUID REFERENCES public.filings(id) ON DELETE CASCADE,
  process_id UUID REFERENCES public.monitored_processes(id) ON DELETE CASCADE,
  
  milestone_type public.cgp_milestone_type NOT NULL,
  custom_type_name TEXT, -- For CUSTOM type
  occurred BOOLEAN NOT NULL DEFAULT false,
  event_date DATE,
  event_time TIME,
  in_audience BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Ensure at least one parent is set
  CONSTRAINT cgp_milestones_parent_check CHECK (
    (filing_id IS NOT NULL) OR (process_id IS NOT NULL)
  )
);

-- Enable RLS
ALTER TABLE public.cgp_milestones ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own cgp_milestones"
  ON public.cgp_milestones FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own cgp_milestones"
  ON public.cgp_milestones FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own cgp_milestones"
  ON public.cgp_milestones FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own cgp_milestones"
  ON public.cgp_milestones FOR DELETE
  USING (auth.uid() = owner_id);

-- Indexes
CREATE INDEX idx_cgp_milestones_filing ON public.cgp_milestones(filing_id);
CREATE INDEX idx_cgp_milestones_process ON public.cgp_milestones(process_id);
CREATE INDEX idx_cgp_milestones_type ON public.cgp_milestones(milestone_type);
CREATE INDEX idx_cgp_milestones_occurred ON public.cgp_milestones(occurred, event_date);

-- Trigger for updated_at
CREATE TRIGGER update_cgp_milestones_updated_at
  BEFORE UPDATE ON public.cgp_milestones
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- Table: cgp_term_templates (Plantillas de términos)
-- =====================================================
CREATE TABLE public.cgp_term_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- NULL = system template
  
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  legal_basis TEXT, -- e.g., "Art. 369 CGP"
  
  process_family TEXT NOT NULL DEFAULT 'CGP',
  process_type public.cgp_process_type NOT NULL DEFAULT 'GENERAL',
  
  trigger_milestone_type public.cgp_milestone_type NOT NULL,
  start_rule public.cgp_start_rule NOT NULL DEFAULT 'NEXT_DAY_AFTER_NOTIFICATION',
  
  duration_value INTEGER NOT NULL,
  duration_unit public.cgp_duration_unit NOT NULL DEFAULT 'BUSINESS_DAYS',
  
  -- Alert policy: when to fire alerts relative to due date
  -- Negative = before due, 0 = on due, positive = after due
  alerts_days_before JSONB DEFAULT '[-5, -3, -1, 0]'::jsonb,
  
  -- Pause rules: what causes this term to pause
  pause_on_judicial_suspension BOOLEAN NOT NULL DEFAULT true,
  pause_on_expediente_al_despacho BOOLEAN NOT NULL DEFAULT false,
  pause_on_resource_filed BOOLEAN NOT NULL DEFAULT false,
  
  -- What resolves/satisfies this term
  satisfied_by_milestone_type public.cgp_milestone_type,
  
  -- Consequence summary for UI
  consequence_summary TEXT,
  
  -- Is this a system template (cannot be deleted)
  is_system BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cgp_term_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies (system templates are visible to all, user templates only to owner)
CREATE POLICY "Users can view system templates"
  ON public.cgp_term_templates FOR SELECT
  USING (is_system = true OR owner_id IS NULL OR auth.uid() = owner_id);

CREATE POLICY "Users can create own templates"
  ON public.cgp_term_templates FOR INSERT
  WITH CHECK (auth.uid() = owner_id AND is_system = false);

CREATE POLICY "Users can update own templates"
  ON public.cgp_term_templates FOR UPDATE
  USING (auth.uid() = owner_id AND is_system = false);

CREATE POLICY "Users can delete own templates"
  ON public.cgp_term_templates FOR DELETE
  USING (auth.uid() = owner_id AND is_system = false);

-- Indexes
CREATE INDEX idx_cgp_term_templates_code ON public.cgp_term_templates(code);
CREATE INDEX idx_cgp_term_templates_trigger ON public.cgp_term_templates(trigger_milestone_type);
CREATE INDEX idx_cgp_term_templates_process_type ON public.cgp_term_templates(process_type);

-- Trigger for updated_at
CREATE TRIGGER update_cgp_term_templates_updated_at
  BEFORE UPDATE ON public.cgp_term_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- Table: cgp_term_instances (Términos activos por caso)
-- =====================================================
CREATE TABLE public.cgp_term_instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Parent references
  filing_id UUID REFERENCES public.filings(id) ON DELETE CASCADE,
  process_id UUID REFERENCES public.monitored_processes(id) ON DELETE CASCADE,
  
  -- Template reference
  term_template_id UUID REFERENCES public.cgp_term_templates(id) ON DELETE SET NULL,
  term_template_code TEXT NOT NULL,
  term_name TEXT NOT NULL,
  
  -- Triggering milestone
  trigger_milestone_id UUID REFERENCES public.cgp_milestones(id) ON DELETE SET NULL,
  trigger_date DATE NOT NULL,
  in_audience BOOLEAN NOT NULL DEFAULT false,
  
  -- Calculated dates
  start_date DATE NOT NULL,
  due_date DATE NOT NULL,
  original_due_date DATE NOT NULL, -- Before any pauses
  
  -- Status
  status public.cgp_term_status NOT NULL DEFAULT 'RUNNING',
  pause_reason TEXT,
  paused_at TIMESTAMP WITH TIME ZONE,
  paused_days_accumulated INTEGER DEFAULT 0,
  
  -- Satisfaction
  satisfied_at TIMESTAMP WITH TIME ZONE,
  satisfied_by_milestone_id UUID REFERENCES public.cgp_milestones(id) ON DELETE SET NULL,
  satisfaction_notes TEXT,
  
  -- Computation metadata
  computed_with_suspensions BOOLEAN NOT NULL DEFAULT false,
  last_computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Ensure at least one parent is set
  CONSTRAINT cgp_term_instances_parent_check CHECK (
    (filing_id IS NOT NULL) OR (process_id IS NOT NULL)
  )
);

-- Enable RLS
ALTER TABLE public.cgp_term_instances ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own cgp_term_instances"
  ON public.cgp_term_instances FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own cgp_term_instances"
  ON public.cgp_term_instances FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own cgp_term_instances"
  ON public.cgp_term_instances FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own cgp_term_instances"
  ON public.cgp_term_instances FOR DELETE
  USING (auth.uid() = owner_id);

-- Indexes
CREATE INDEX idx_cgp_term_instances_filing ON public.cgp_term_instances(filing_id);
CREATE INDEX idx_cgp_term_instances_process ON public.cgp_term_instances(process_id);
CREATE INDEX idx_cgp_term_instances_status ON public.cgp_term_instances(status);
CREATE INDEX idx_cgp_term_instances_due_date ON public.cgp_term_instances(due_date);
CREATE INDEX idx_cgp_term_instances_running ON public.cgp_term_instances(status, due_date) WHERE status IN ('RUNNING', 'PENDING');

-- Trigger for updated_at
CREATE TRIGGER update_cgp_term_instances_updated_at
  BEFORE UPDATE ON public.cgp_term_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- Table: cgp_inactivity_tracker (Desistimiento tácito)
-- =====================================================
CREATE TABLE public.cgp_inactivity_tracker (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  filing_id UUID REFERENCES public.filings(id) ON DELETE CASCADE,
  process_id UUID REFERENCES public.monitored_processes(id) ON DELETE CASCADE,
  
  -- Last activity date
  last_activity_date DATE NOT NULL,
  last_activity_description TEXT,
  last_activity_milestone_id UUID REFERENCES public.cgp_milestones(id) ON DELETE SET NULL,
  
  -- Inactivity threshold (in months)
  inactivity_threshold_months INTEGER NOT NULL DEFAULT 12, -- 1 year for regular, 24 for post-sentencia
  
  -- Status
  has_favorable_sentencia BOOLEAN NOT NULL DEFAULT false,
  is_at_risk BOOLEAN NOT NULL DEFAULT false,
  risk_since DATE,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT cgp_inactivity_tracker_parent_check CHECK (
    (filing_id IS NOT NULL) OR (process_id IS NOT NULL)
  )
);

-- Enable RLS
ALTER TABLE public.cgp_inactivity_tracker ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own cgp_inactivity_tracker"
  ON public.cgp_inactivity_tracker FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own cgp_inactivity_tracker"
  ON public.cgp_inactivity_tracker FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own cgp_inactivity_tracker"
  ON public.cgp_inactivity_tracker FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own cgp_inactivity_tracker"
  ON public.cgp_inactivity_tracker FOR DELETE
  USING (auth.uid() = owner_id);

-- Indexes
CREATE INDEX idx_cgp_inactivity_tracker_filing ON public.cgp_inactivity_tracker(filing_id);
CREATE INDEX idx_cgp_inactivity_tracker_process ON public.cgp_inactivity_tracker(process_id);
CREATE INDEX idx_cgp_inactivity_tracker_at_risk ON public.cgp_inactivity_tracker(is_at_risk, risk_since);

-- Trigger for updated_at
CREATE TRIGGER update_cgp_inactivity_tracker_updated_at
  BEFORE UPDATE ON public.cgp_inactivity_tracker
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- Insert initial CGP term templates (MVP catalog)
-- =====================================================

-- RECURSOS (General - applies to all process types)
INSERT INTO public.cgp_term_templates (code, name, description, legal_basis, process_type, trigger_milestone_type, start_rule, duration_value, duration_unit, alerts_days_before, consequence_summary, is_system) VALUES
('REPOSICION_FUERA_AUDIENCIA', 'Recurso de Reposición (fuera de audiencia)', 'Término para interponer recurso de reposición contra auto dictado fuera de audiencia', 'Art. 318 CGP', 'GENERAL', 'AUTO_ADMISORIO_NOTIFICADO', 'NEXT_DAY_AFTER_NOTIFICATION', 3, 'BUSINESS_DAYS', '[-2, -1, 0]', 'Pérdida del derecho a recurrir - el auto queda ejecutoriado', true),

('APELACION_FUERA_AUDIENCIA', 'Recurso de Apelación (fuera de audiencia)', 'Término para interponer recurso de apelación contra auto o sentencia fuera de audiencia', 'Art. 322 CGP', 'GENERAL', 'SENTENCIA_PRIMERA_INSTANCIA', 'NEXT_DAY_AFTER_NOTIFICATION', 3, 'BUSINESS_DAYS', '[-2, -1, 0]', 'Pérdida del derecho a apelar - la providencia queda ejecutoriada', true),

('SUSTENTACION_APELACION_AUTOS', 'Sustentación de Apelación de Autos', 'Término para sustentar la apelación de autos ante el superior', 'Art. 327 CGP', 'GENERAL', 'RECURSO_APELACION_CONCEDIDO', 'NEXT_DAY_AFTER_NOTIFICATION', 3, 'BUSINESS_DAYS', '[-2, -1, 0]', 'Deserción del recurso de apelación', true),

('SUPLICA', 'Recurso de Súplica', 'Término para interponer recurso de súplica contra auto del magistrado sustanciador', 'Art. 331 CGP', 'GENERAL', 'EXPEDIENTE_A_SECRETARIA', 'NEXT_DAY_AFTER_NOTIFICATION', 3, 'BUSINESS_DAYS', '[-2, -1, 0]', 'Pérdida del derecho al recurso de súplica', true),

-- VERBAL SUMARIO
('CONTESTACION_VERBAL_SUMARIO', 'Contestación de Demanda (Verbal Sumario)', 'Término para contestar la demanda en proceso verbal sumario', 'Art. 392 CGP', 'VERBAL_SUMARIO', 'AUTO_ADMISORIO_NOTIFICADO', 'NEXT_DAY_AFTER_NOTIFICATION', 10, 'BUSINESS_DAYS', '[-5, -3, -1, 0]', 'Preclusión de la oportunidad de contestar - se tienen por ciertos los hechos susceptibles de confesión', true),

('TRASLADO_EXCEPCIONES_MERITO_VS', 'Traslado Excepciones de Mérito (Verbal Sumario)', 'Término para que el demandante solicite pruebas contra excepciones de mérito', 'Art. 370 CGP', 'VERBAL_SUMARIO', 'TRASLADO_EXCEPCIONES_NOTIFICADO', 'NEXT_DAY_AFTER_NOTIFICATION', 3, 'BUSINESS_DAYS', '[-2, -1, 0]', 'Preclusión de la oportunidad de pedir pruebas contra excepciones', true),

-- MONITORIO
('REQUERIMIENTO_PAGO_MONITORIO', 'Requerimiento de Pago (Monitorio)', 'Término para que el deudor pague, proponga excepciones o guarde silencio', 'Art. 421 CGP', 'MONITORIO', 'REQUERIMIENTO_PAGO_NOTIFICADO', 'NEXT_DAY_AFTER_NOTIFICATION', 10, 'BUSINESS_DAYS', '[-5, -3, -1, 0]', 'Si guarda silencio: sentencia condenatoria sin más trámite. Si paga: terminación. Si se opone: conversión a verbal sumario', true),

('TRASLADO_OPOSICION_MONITORIO', 'Traslado de Oposición (Monitorio)', 'Término para que el demandante pida pruebas adicionales después de oposición', 'Art. 421 CGP', 'MONITORIO', 'OPOSICION_MONITORIO', 'NEXT_DAY_AFTER_NOTIFICATION', 5, 'BUSINESS_DAYS', '[-3, -1, 0]', 'Preclusión de la oportunidad de pedir pruebas adicionales', true),

-- EJECUTIVO
('MANDAMIENTO_PAGO_EJECUTIVO', 'Plazo para Pagar (Ejecutivo)', 'Término para que el ejecutado pague la suma líquida ordenada', 'Art. 427 CGP', 'EJECUTIVO', 'MANDAMIENTO_EJECUTIVO_NOTIFICADO', 'NEXT_DAY_AFTER_NOTIFICATION', 5, 'BUSINESS_DAYS', '[-3, -1, 0]', 'Continúa el proceso - posibilidad de embargo y remate', true),

('EXCEPCIONES_MERITO_EJECUTIVO', 'Excepciones de Mérito (Ejecutivo)', 'Término para proponer excepciones de mérito contra el mandamiento de pago', 'Art. 442 CGP', 'EJECUTIVO', 'MANDAMIENTO_EJECUTIVO_NOTIFICADO', 'NEXT_DAY_AFTER_NOTIFICATION', 10, 'BUSINESS_DAYS', '[-5, -3, -1, 0]', 'Preclusión de la oportunidad de proponer excepciones de mérito', true),

('TRASLADO_EXCEPCIONES_EJECUTIVO', 'Traslado de Excepciones (Ejecutivo)', 'Término para que el ejecutante se pronuncie sobre las excepciones', 'Art. 443 CGP', 'EJECUTIVO', 'TRASLADO_EXCEPCIONES_NOTIFICADO', 'NEXT_DAY_AFTER_NOTIFICATION', 10, 'BUSINESS_DAYS', '[-5, -3, -1, 0]', 'Preclusión de la oportunidad de controvertir excepciones', true),

('AVALUO_BIENES', 'Avalúo de Bienes', 'Término para realizar avalúo de bienes embargados/secuestrados', 'Art. 444 CGP', 'EJECUTIVO', 'EMBARGO_SECUESTRO_PRACTICADO', 'NEXT_DAY_AFTER_NOTIFICATION', 20, 'BUSINESS_DAYS', '[-10, -5, -3, -1, 0]', 'Posible demora en la ejecución', true),

-- DURACION MAXIMA DEL PROCESO
('DURACION_MAXIMA_1_INSTANCIA', 'Duración Máxima 1ª Instancia', 'Término máximo de duración del proceso en primera o única instancia', 'Art. 121 CGP', 'GENERAL', 'AUTO_ADMISORIO_NOTIFICADO', 'NEXT_DAY_AFTER_NOTIFICATION', 1, 'YEARS', '[-90, -30, -15, 0, 15]', 'Riesgo de pérdida de competencia del juez - alegar antes de sentencia', true),

('DURACION_MAXIMA_2_INSTANCIA', 'Duración Máxima 2ª Instancia', 'Término máximo de duración del proceso en segunda instancia', 'Art. 121 CGP', 'GENERAL', 'EXPEDIENTE_RECIBIDO_SUPERIOR', 'NEXT_DAY_AFTER_NOTIFICATION', 6, 'MONTHS', '[-60, -30, -15, 0]', 'Riesgo de pérdida de competencia del magistrado - alegar antes de sentencia', true),

-- TERMINOS DEL JUEZ
('AUTO_10_DIAS', 'Término para dictar Auto', 'Término para que el juez dicte auto fuera de audiencia', 'Art. 120 CGP', 'GENERAL', 'EXPEDIENTE_AL_DESPACHO', 'NEXT_DAY_AFTER_NOTIFICATION', 10, 'BUSINESS_DAYS', '[-5, -3, 0, 5, 10]', 'Mora judicial - posibilidad de queja disciplinaria', true),

('SENTENCIA_40_DIAS', 'Término para dictar Sentencia', 'Término para que el juez dicte sentencia fuera de audiencia', 'Art. 120 CGP', 'GENERAL', 'EXPEDIENTE_AL_DESPACHO', 'NEXT_DAY_AFTER_NOTIFICATION', 40, 'BUSINESS_DAYS', '[-20, -10, -5, 0, 10]', 'Mora judicial - posibilidad de queja disciplinaria', true);

-- =====================================================
-- Add default email for Lex et Litterae to profiles
-- =====================================================
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS default_alert_email TEXT DEFAULT 'gr@lexetlit.com';