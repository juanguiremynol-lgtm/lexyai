
ALTER VIEW public.retroactive_actuaciones_v SET (security_invoker = on);
ALTER VIEW public.monitoring_coverage_v SET (security_invoker = on);

ALTER FUNCTION public.unaccent_lower_safe(text) SET search_path = public;
ALTER FUNCTION public.is_term_opening_text(text) SET search_path = public;
ALTER FUNCTION public.classify_discovery(date, timestamptz, text) SET search_path = public;
