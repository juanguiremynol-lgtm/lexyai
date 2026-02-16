-- Update trial plan with proper beta limits
UPDATE public.subscription_plans 
SET 
  display_name = 'Beta Trial',
  max_clients = 10,
  max_filings = 25,
  trial_days = 90,
  features = '["Hasta 10 clientes", "Hasta 25 procesos judiciales", "Monitoreo de procesos", "Alertas de actuaciones", "Búsqueda global", "Acceso por 3 meses"]'::jsonb
WHERE name = 'trial';

-- Mark paid plans as inactive during beta (don't delete, keep for future)
UPDATE public.subscription_plans
SET active = false
WHERE name IN ('basic', 'standard', 'business', 'unlimited');