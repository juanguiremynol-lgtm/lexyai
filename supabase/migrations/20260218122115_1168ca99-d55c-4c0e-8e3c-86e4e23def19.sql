-- Add new observation kinds for alert-to-Atenia-AI pipeline
ALTER TYPE public.observation_kind ADD VALUE IF NOT EXISTS 'ALERT_CREATED';
ALTER TYPE public.observation_kind ADD VALUE IF NOT EXISTS 'ADMIN_NOTIFICATION';
ALTER TYPE public.observation_kind ADD VALUE IF NOT EXISTS 'DIAGNOSTIC_ESCALATION';